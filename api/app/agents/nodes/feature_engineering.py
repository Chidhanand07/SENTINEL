from __future__ import annotations

"""FeatureEngineeringNode — generates temporal + behavioral features from detected schema."""

import asyncio
import time
from typing import Any

import pandas as pd
import numpy as np
import structlog

from app.agents.events import emit_event, save_checkpoint
from app.agents.state import PipelineState
from app.tools.data_tools import read_parquet_from_minio, write_parquet_to_minio

log = structlog.get_logger()


def _add_temporal_features(df: pd.DataFrame, date_col: str) -> tuple[pd.DataFrame, list[str]]:
    """Extract day-of-week, month, quarter, is_weekend, day_of_year from date column."""
    added: list[str] = []
    if date_col not in df.columns:
        return df, added
    try:
        dt = pd.to_datetime(df[date_col], errors="coerce")
        df["feat_day_of_week"]    = dt.dt.dayofweek.astype("int8")
        df["feat_month"]          = dt.dt.month.astype("int8")
        df["feat_quarter"]        = dt.dt.quarter.astype("int8")
        df["feat_is_weekend"]     = (dt.dt.dayofweek >= 5).astype("int8")
        df["feat_day_of_year"]    = dt.dt.dayofyear.astype("int16")
        df["feat_week_of_year"]   = dt.dt.isocalendar().week.astype("int16")
        added = [
            "feat_day_of_week", "feat_month", "feat_quarter",
            "feat_is_weekend", "feat_day_of_year", "feat_week_of_year",
        ]
    except Exception as e:
        log.warning("temporal_feature_failed", error=str(e))
    return df, added


def _add_rfm_features(
    df: pd.DataFrame,
    customer_col: str | None,
    date_col: str | None,
    revenue_col: str | None,
) -> tuple[pd.DataFrame, list[str]]:
    """Per-customer aggregated RFM features joined back to the main frame."""
    added: list[str] = []
    if not customer_col or not date_col or not revenue_col:
        return df, added
    if not all(c in df.columns for c in [customer_col, date_col, revenue_col]):
        return df, added
    try:
        dt = pd.to_datetime(df[date_col], errors="coerce")
        ref_date = dt.max()
        agg = df.groupby(customer_col).agg(
            feat_cust_recency    = (date_col, lambda x: (ref_date - pd.to_datetime(x, errors="coerce").max()).days),
            feat_cust_frequency  = (customer_col, "count"),
            feat_cust_monetary   = (revenue_col, "sum"),
            feat_cust_avg_order  = (revenue_col, "mean"),
        ).reset_index()
        # Log-scale monetary & avg_order to reduce skew
        agg["feat_cust_log_monetary"] = np.log1p(agg["feat_cust_monetary"].clip(lower=0))
        agg["feat_cust_log_avg_order"] = np.log1p(agg["feat_cust_avg_order"].clip(lower=0))
        df = df.merge(
            agg[[customer_col, "feat_cust_recency", "feat_cust_frequency",
                 "feat_cust_monetary", "feat_cust_avg_order",
                 "feat_cust_log_monetary", "feat_cust_log_avg_order"]],
            on=customer_col,
            how="left",
        )
        added = [
            "feat_cust_recency", "feat_cust_frequency", "feat_cust_monetary",
            "feat_cust_avg_order", "feat_cust_log_monetary", "feat_cust_log_avg_order",
        ]
    except Exception as e:
        log.warning("rfm_feature_failed", error=str(e))
    return df, added


def _add_revenue_features(
    df: pd.DataFrame,
    revenue_col: str | None,
) -> tuple[pd.DataFrame, list[str]]:
    """Log-transform and rolling stats on the revenue column."""
    added: list[str] = []
    if not revenue_col or revenue_col not in df.columns:
        return df, added
    try:
        s = pd.to_numeric(df[revenue_col], errors="coerce").clip(lower=0)
        df["feat_log_revenue"] = np.log1p(s)
        df["feat_revenue_zscore"] = (s - s.mean()) / (s.std() + 1e-9)
        added = ["feat_log_revenue", "feat_revenue_zscore"]
    except Exception as e:
        log.warning("revenue_feature_failed", error=str(e))
    return df, added


async def feature_engineering_node(state: PipelineState) -> dict[str, Any]:
    t0 = time.monotonic()
    run_id = state.run_id

    await emit_event(
        run_id, "FeatureEngineeringNode", "started",
        layer="langgraph",
        reasoning=(
            "Generating temporal features (day-of-week, month, quarter, is_weekend) "
            "and behavioral features (per-customer RFM aggregates, log-revenue) "
            "from detected schema columns."
        ),
    )

    try:
        df = read_parquet_from_minio(state.clean_df_path or "")
        schema_map = state.schema_map or {}
        rows_in = len(df)
        all_features: list[str] = []

        # ── Temporal features ──────────────────────────────────────────
        date_col = schema_map.get("date_col")
        if date_col:
            await emit_event(
                run_id, "FeatureEngineeringNode", "tool_call",
                layer="langchain",
                tool_called="add_temporal_features",
                reasoning=f"Extracting temporal features from '{date_col}'.",
            )
            try:
                df, temporal_feats = await asyncio.wait_for(
                    asyncio.to_thread(_add_temporal_features, df, date_col),
                    timeout=8.0,
                )
                all_features.extend(temporal_feats)
            except asyncio.TimeoutError:
                log.warning("temporal_feature_timeout", run_id=run_id)

        # ── RFM / behavioral features ───────────────────────────────────
        customer_col = schema_map.get("customer_col")
        revenue_col  = schema_map.get("revenue_col")
        if customer_col and date_col and revenue_col:
            await emit_event(
                run_id, "FeatureEngineeringNode", "tool_call",
                layer="langchain",
                tool_called="add_rfm_features",
                reasoning=(
                    f"Computing per-customer RFM: recency('{date_col}'), "
                    f"frequency('{customer_col}'), monetary('{revenue_col}')."
                ),
            )
            try:
                df, rfm_feats = await asyncio.wait_for(
                    asyncio.to_thread(_add_rfm_features, df, customer_col, date_col, revenue_col),
                    timeout=6.0,  # tighter timeout — 5k rows should finish in <2s
                )
                all_features.extend(rfm_feats)
            except asyncio.TimeoutError:
                log.warning("rfm_feature_timeout", run_id=run_id)

        # ── Revenue transform ───────────────────────────────────────────
        if revenue_col:
            try:
                df, rev_feats = await asyncio.to_thread(_add_revenue_features, df, revenue_col)
                all_features.extend(rev_feats)
            except Exception:
                pass

        # Write enhanced parquet
        feat_key = write_parquet_to_minio(df, f"datasets/{run_id}/features.parquet")
        latency = int((time.monotonic() - t0) * 1000)

        await emit_event(
            run_id, "FeatureEngineeringNode", "completed",
            layer="langgraph",
            rows_in=rows_in,
            rows_out=len(df),
            latency_ms=latency,
            artifact_key=feat_key,
            reasoning=(
                f"Feature engineering complete. "
                f"Added {len(all_features)} features: {all_features[:6]}{'...' if len(all_features)>6 else ''}. "
                f"Feature matrix: {rows_in:,} rows × {len(df.columns)} cols."
            ),
        )

        new_state = {
            "clean_df_path": feat_key,   # downstream nodes use this path
            "feature_cols": all_features,
            "lineage": state.lineage + [{
                "step_order": 3.5,
                "agent": "FeatureEngineeringNode",
                "transformation": (
                    f"Temporal + RFM + revenue transforms → "
                    f"{len(all_features)} new features ({rows_in:,} rows)"
                ),
                "rows_in": rows_in,
                "rows_out": len(df),
                "duration_ms": latency,
            }],
        }
        await save_checkpoint(run_id, "FeatureEngineeringNode", new_state)
        return new_state

    except Exception as exc:
        log.error("feature_engineering_failed", run_id=run_id, error=str(exc))
        await emit_event(run_id, "FeatureEngineeringNode", "error", reasoning=str(exc))
        # Non-fatal — return empty update so pipeline continues
        return {"feature_cols": []}
