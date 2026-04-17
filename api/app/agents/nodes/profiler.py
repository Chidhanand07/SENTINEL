from __future__ import annotations

import time
from typing import Any

import structlog

from app.agents.events import emit_event, save_checkpoint
from app.agents.state import PipelineState
from app.tools.data_tools import detect_outliers, profile_dataframe, read_parquet_from_minio

log = structlog.get_logger()


async def profiler_node(state: PipelineState) -> dict[str, Any]:
    t0 = time.monotonic()
    run_id = state.run_id

    await emit_event(
        run_id, "ProfilerNode", "started",
        layer="langgraph",
        reasoning="Loading master DataFrame and running statistical profiling with ydata-profiling + outlier detection.",
    )

    try:
        df = read_parquet_from_minio(state.master_df_path or "")
        
        # DATA CAP: Hackathon mode — apply 5000 row cap for profiling speed
        if len(df) > 5000:
            df = df.sample(n=5000, random_state=42)
            await emit_event(
                run_id, "ProfilerNode", "data_cap",
                layer="langgraph",
                reasoning=f"Data cap applied for profiling: {len(df):,} rows (demo mode).",
            )

        await emit_event(
            run_id, "ProfilerNode", "tool_call",
            layer="langchain",
            tool_called="profile_dataframe",
            reasoning=f"Profiling {len(df):,} rows. Computing missingness, skewness, cardinality per column.",
            rows_in=len(df),
        )
        profile = profile_dataframe(df)

        await emit_event(
            run_id, "ProfilerNode", "tool_call",
            layer="langchain",
            tool_called="detect_outliers",
            reasoning="Running IQR + Isolation Forest for multi-variate outlier detection on numeric columns.",
            rows_in=len(df),
        )
        outlier_report = detect_outliers(df)
        profile["outlier_report"] = outlier_report

        # Compute schema_coverage: fraction of expected schema slots that were detected
        schema_map = state.schema_map or {}
        schema_slots = ["date_col", "revenue_col", "customer_col", "product_col", "geo_col"]
        detected = sum(1 for k in schema_slots if schema_map.get(k))
        profile["schema_coverage"] = round((detected / len(schema_slots)) * 100, 1)

        latency = int((time.monotonic() - t0) * 1000)

        await emit_event(
            run_id, "ProfilerNode", "completed",
            layer="langgraph",
            rows_in=len(df),
            rows_out=len(df),
            latency_ms=latency,
            reasoning=(
                f"Profile ready. Missing: {profile.get('missing_pct', 0):.1f}%, "
                f"Duplicates: {profile.get('duplicate_count', 0)}, "
                f"Outliers: {outlier_report.get('outlier_count', 0)}"
            ),
        )

        new_state = {
            "profile_report": profile,
            "lineage": state.lineage + [{
                "step_order": 2,
                "agent": "ProfilerNode",
                "transformation": "Statistical profiling + outlier detection",
                "rows_in": len(df),
                "rows_out": len(df),
                "duration_ms": latency,
            }],
        }
        await save_checkpoint(run_id, "ProfilerNode", new_state)
        return new_state

    except Exception as exc:
        log.error("profiler_failed", run_id=run_id, error=str(exc))
        await emit_event(run_id, "ProfilerNode", "error", reasoning=str(exc))
        return {"error": str(exc)}
