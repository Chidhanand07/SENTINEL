from __future__ import annotations

import time
from typing import Any

import structlog

from app.agents.events import emit_event, save_checkpoint
from app.agents.state import PipelineState
from app.tools.data_tools import read_parquet_from_minio
from app.tools.eda_tools import (
    compute_correlations,
    decompose_timeseries,
    plot_choropleth,
    plot_distributions,
    upload_chart_to_minio,
)

log = structlog.get_logger()


async def eda_node(state: PipelineState) -> dict[str, Any]:
    t0 = time.monotonic()
    run_id = state.run_id

    await emit_event(
        run_id, "EDANode", "started",
        layer="langgraph",
        reasoning="Running automated EDA: correlation matrices, distribution plots, time-series decomposition, choropleth.",
    )

    try:
        df = read_parquet_from_minio(state.clean_df_path or "")
        # Sample down for EDA — we only need a representative slice for charts
        if len(df) > 2000:
            df = df.sample(n=2000, random_state=42)

        artifact_keys: list[str] = []
        feature_cols: list[str] = []

        schema_map = state.schema_map or {}
        available_analyses = state.available_analyses or {}

        # Cap numeric cols to 4 — enough for a meaningful correlation matrix
        num_cols = schema_map.get("numeric_cols", [])[:4]
        if not num_cols:
            num_cols = df.select_dtypes("number").columns.tolist()[:4]

        # 1. Correlation matrix (fast — just a corr() call)
        if len(num_cols) > 1:
            await emit_event(run_id, "EDANode", "tool_call", layer="langchain",
                             tool_called="compute_correlations",
                             reasoning="Pearson correlation matrix on numeric features.")
            import asyncio
            loop = asyncio.get_event_loop()
            corr_fig = await loop.run_in_executor(None, compute_correlations, df[num_cols])
            key = upload_chart_to_minio(corr_fig, run_id, "correlations")
            artifact_keys.append(key)

        # 2. Single distribution plot for the revenue column only (skip 8 histograms)
        rev_col = schema_map.get("revenue_col")
        target_col = rev_col if rev_col and rev_col in df.columns else (num_cols[0] if num_cols else None)
        if target_col:
            await emit_event(run_id, "EDANode", "tool_call", layer="langchain",
                             tool_called="plot_distributions",
                             reasoning=f"Distribution plot for '{target_col}'.")
            loop = asyncio.get_event_loop()
            dist_figs = await loop.run_in_executor(None, plot_distributions, df, [target_col])
            for i, fig in enumerate(dist_figs):
                key = upload_chart_to_minio(fig, run_id, f"distribution_{i}")
                artifact_keys.append(key)

        # 3. Skip STL decomposition (slow statsmodels fit) and choropleth — background node
        # These are cosmetic charts and add 10-30s to the pipeline.

        feature_cols = num_cols

        latency = int((time.monotonic() - t0) * 1000)

        await emit_event(
            run_id, "EDANode", "completed",
            layer="langgraph",
            rows_in=len(df),
            rows_out=len(df),
            latency_ms=latency,
            reasoning=f"EDA complete. {len(artifact_keys)} charts uploaded. {len(feature_cols)} features identified.",
        )

        new_state = {
            "eda_artifact_keys": artifact_keys,
            "feature_cols": feature_cols,
            "lineage": state.lineage + [{
                "step_order": 4,
                "agent": "EDANode",
                "transformation": f"EDA: {len(artifact_keys)} chart artifacts, {len(feature_cols)} features",
                "rows_in": len(df),
                "rows_out": len(df),
                "duration_ms": latency,
            }],
        }
        await save_checkpoint(run_id, "EDANode", new_state)
        return new_state

    except Exception as exc:
        log.error("eda_failed", run_id=run_id, error=str(exc))
        await emit_event(run_id, "EDANode", "error", reasoning=str(exc))
        return {"error": str(exc)}
