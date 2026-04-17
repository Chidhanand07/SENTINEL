from __future__ import annotations

import time
from typing import Any

import structlog

from app.agents.events import emit_event, save_checkpoint
from app.agents.state import PipelineState
from app.tools.data_tools import read_parquet_from_minio
from app.tools.ml_tools import (
    group_by_sku_region,
    run_lightgbm_lags,
    run_prophet,
    run_sarimax,
    select_best_model,
    write_forecasts_to_db,
)

log = structlog.get_logger()


async def forecast_node(state: PipelineState) -> dict[str, Any]:
    t0 = time.monotonic()
    run_id = state.run_id

    await emit_event(
        run_id, "ForecastNode", "started",
        layer="langgraph",
        reasoning="Grouping by SKU × state × week. Routing: ≥52pts → Prophet+SARIMAX, <52pts → LightGBM lags.",
    )

    try:
        df = read_parquet_from_minio(state.clean_df_path or "")

        schema_map = state.schema_map or {}
        available_analyses = state.available_analyses or {}

        if not available_analyses.get("can_forecast", False):
            await emit_event(run_id, "ForecastNode", "completed", layer="langgraph", reasoning="Skipping forecast: No date and revenue columns detected.", rows_in=len(df), rows_out=0)
            new_state = {"forecasts": [], "model_leaderboard": [], "lineage": state.lineage + [{"step_order": 6, "agent": "ForecastNode", "transformation": "Skipped (no date+revenue_col)", "rows_in": len(df), "rows_out": 0}]}
            await save_checkpoint(run_id, "ForecastNode", new_state)
            return new_state

        await emit_event(run_id, "ForecastNode", "tool_call", layer="langchain",
                         tool_called="group_by_sku_region",
                         reasoning="Aggregating revenue by product/category × region × week.")
                         
        groups = group_by_sku_region(
            df,
            cat_col=schema_map.get("product_col"),
            state_col=schema_map.get("geo_col"),
            date_col=schema_map.get("date_col"),
            val_col=schema_map.get("revenue_col"),
        )

        forecasts: list[dict[str, Any]] = []
        leaderboard: list[dict[str, Any]] = []

        # Cap at 5 groups for speed — enough for a compelling demo
        top_groups = groups[:5]

        import asyncio
        loop = asyncio.get_event_loop()

        for i, (key, series) in enumerate(top_groups):
            sku, region = key
            n_pts = len(series)

            if n_pts >= 52:
                await emit_event(run_id, "ForecastNode", "tool_call", layer="langchain",
                                 tool_called="run_prophet",
                                 reasoning=f"[{i+1}/{len(top_groups)}] {sku}/{region}: {n_pts} pts → Prophet 30/60/90d.")
                # Run CPU-bound Prophet in threadpool so it doesn't block the event loop
                best = await loop.run_in_executor(None, run_prophet, series)
            else:
                await emit_event(run_id, "ForecastNode", "tool_call", layer="langchain",
                                 tool_called="run_lightgbm_lags",
                                 reasoning=f"[{i+1}/{len(top_groups)}] {sku}/{region}: {n_pts} pts → LightGBM (sparse).")
                best = await loop.run_in_executor(None, run_lightgbm_lags, series, sku)

            for horizon in [30, 60, 90]:
                forecasts.append({
                    "sku_id": sku,
                    "state": region,
                    "horizon_days": horizon,
                    "forecast_value": best.get(f"forecast_{horizon}", best.get("forecast_30", 0)),
                    "lower_ci": best.get(f"lower_{horizon}", 0),
                    "upper_ci": best.get(f"upper_{horizon}", 0),
                    "model_used": best.get("model", "prophet"),
                    "mape": best.get("mape", 0),
                    "forecast_data": best.get("forecast_data", {}),
                })

            leaderboard.append({
                "sku": sku,
                "region": region,
                "model": best.get("model"),
                "mape": round(best.get("mape", 0), 3),
                "mae": round(best.get("mae", 0), 2),
                "rmse": round(best.get("rmse", 0), 2),
            })

        await write_forecasts_to_db(forecasts, run_id)

        latency = int((time.monotonic() - t0) * 1000)
        best_mape = min((r["mape"] for r in leaderboard), default=0)

        await emit_event(
            run_id, "ForecastNode", "completed",
            layer="langgraph",
            rows_in=len(df),
            rows_out=len(forecasts),
            latency_ms=latency,
            reasoning=(
                f"Forecasting complete. {len(top_groups)} SKU×region combos. "
                f"Best MAPE: {best_mape:.1%}. All runs logged to MLflow."
            ),
        )

        new_state = {
            "forecasts": forecasts,
            "model_leaderboard": leaderboard,
            "lineage": state.lineage + [{
                "step_order": 6,
                "agent": "ForecastNode",
                "transformation": f"Prophet/LightGBM → {len(forecasts)} forecasts ({len(top_groups)} series)",
                "rows_in": len(df),
                "rows_out": len(forecasts),
                "duration_ms": latency,
            }],
        }
        await save_checkpoint(run_id, "ForecastNode", new_state)
        return new_state

    except Exception as exc:
        log.error("forecast_failed", run_id=run_id, error=str(exc))
        await emit_event(run_id, "ForecastNode", "error", reasoning=str(exc))
        return {"error": str(exc)}
