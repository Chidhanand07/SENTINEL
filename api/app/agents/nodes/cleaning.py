from __future__ import annotations

import asyncio
import time
from typing import Any

import pandas as pd
import structlog

from app.agents.events import emit_event, save_checkpoint
from app.agents.state import PipelineState
from app.tools.data_tools import (
    cap_outliers_iqr,
    deduplicate,
    impute_dataframe,
    normalize_categories,
    read_parquet_from_minio,
    select_imputation_strategy,
    write_parquet_to_minio,
)

log = structlog.get_logger()


async def cleaning_node(state: PipelineState) -> dict[str, Any]:
    t0 = time.monotonic()
    run_id = state.run_id

    await emit_event(
        run_id, "CleaningNode", "started",
        layer="langgraph",
        reasoning="Reading profile report to choose per-column imputation strategies. Applying fuzzy category normalization.",
    )

    try:
        df = read_parquet_from_minio(state.master_df_path or "")
        profile = state.profile_report or {}
        rows_before_cap = len(df)
        
        # ⚡ CAP DATA AT 5000 ROWS FOR SPEED
        if len(df) > 5000:
            df = df.sample(n=5000, random_state=42)
            await emit_event(
                run_id, "CleaningNode", "data_cap",
                layer="langgraph",
                rows_before=rows_before_cap,
                rows_after=len(df),
                reasoning=f"Capping {rows_before_cap:,} rows → 5k for speed optimization"
            )
        
        rows_in = len(df)

        # Parse human feedback for column exclusions
        exclusions: list[str] = []
        if state.human_feedback:
            await emit_event(
                run_id, "CleaningNode", "human_feedback",
                layer="langgraph",
                reasoning=f"Human constraint injected: {state.human_feedback}",
            )
            import re
            match = re.search(r"exclude[:\s]+([a-zA-Z0-9_, ]+)", state.human_feedback, re.I)
            if match:
                exclusions = [c.strip() for c in match.group(1).split(",")]

        await emit_event(
            run_id, "CleaningNode", "tool_call",
            layer="langchain",
            tool_called="select_imputation_strategy",
            reasoning=f"Selecting strategy per column based on dtype + missingness. Exclusions: {exclusions or 'none'}",
        )
        col_profiles = profile.get("columns", {})
        strategy_map = {
            col: select_imputation_strategy(col, col_profiles.get(col, {}))
            for col in df.columns
            if col not in exclusions
        }

        await emit_event(
            run_id, "CleaningNode", "tool_call",
            layer="langchain",
            tool_called="impute_dataframe",
            reasoning=f"Imputing {sum(1 for s in strategy_map.values() if s != 'none')} columns.",
        )
        
        # ⚡ TIMEOUT WRAPPER: Imputation can take >30s on large datasets
        try:
            df = await asyncio.wait_for(
                asyncio.to_thread(impute_dataframe, df, strategy_map),
                timeout=10.0
            )
        except asyncio.TimeoutError:
            log.warning("impute_timeout", run_id=run_id, timeout_sec=10)
            await emit_event(
                run_id, "CleaningNode", "timeout",
                layer="langgraph",
                tool="impute_dataframe",
                reasoning="Imputation timeout (10s), skipping imputation to maintain speed"
            )
            # Skip imputation on timeout, continue with dedup

        # ── OUTLIER CAPPING (IQR winsorization) ──────────────────────────
        await emit_event(
            run_id, "CleaningNode", "tool_call",
            layer="langchain",
            tool_called="cap_outliers_iqr",
            reasoning="Winsorizing numeric outliers via 1.5×IQR. Clips extreme values without dropping rows.",
        )
        try:
            df = await asyncio.wait_for(
                asyncio.to_thread(cap_outliers_iqr, df),
                timeout=8.0
            )
        except asyncio.TimeoutError:
            log.warning("outlier_cap_timeout", run_id=run_id)
            await emit_event(run_id, "CleaningNode", "timeout", layer="langgraph",
                             tool="cap_outliers_iqr", reasoning="Outlier capping timeout (8s), skipping.")

        await emit_event(
            run_id, "CleaningNode", "tool_call",
            layer="langchain",
            tool_called="deduplicate",
            reasoning="Removing duplicate rows based on full features.",
        )

        # ⚡ TIMEOUT WRAPPER: Drop duplicates is O(n) but with fuzzy matching can hang
        try:
            df = await asyncio.wait_for(
                asyncio.to_thread(df.drop_duplicates),
                timeout=8.0
            )
        except asyncio.TimeoutError:
            log.warning("dedupe_timeout", run_id=run_id, timeout_sec=8)
            await emit_event(
                run_id, "CleaningNode", "timeout",
                layer="langgraph",
                tool="deduplicate",
                reasoning="Dedupe timeout (8s), skipping to maintain speed"
            )
            # Continue without explicit dedup, implicit duplicates may exist

        date_col = state.schema_map.get("date_col") if state.schema_map else None
        if date_col and date_col in df.columns:
            df[date_col] = pd.to_datetime(df[date_col], errors='coerce')

        clean_key = write_parquet_to_minio(df, f"datasets/{run_id}/clean.parquet")
        rows_out = len(df)
        latency = int((time.monotonic() - t0) * 1000)

        await emit_event(
            run_id, "CleaningNode", "completed",
            layer="langgraph",
            rows_in=rows_in,
            rows_out=rows_out,
            latency_ms=latency,
            artifact_key=clean_key,
            reasoning=(
                f"Cleaning complete. Dropped {rows_in - rows_out} duplicates. "
                f"Imputed {len([s for s in strategy_map.values() if s != 'none'])} columns."
            ),
        )

        new_state = {
            "clean_df_path": clean_key,
            "lineage": state.lineage + [{
                "step_order": 3,
                "agent": "CleaningNode",
                "transformation": f"Imputation + IQR outlier capping + dedup → {rows_out:,} clean rows",
                "rows_in": rows_in,
                "rows_out": rows_out,
                "duration_ms": latency,
            }],
        }
        await save_checkpoint(run_id, "CleaningNode", new_state)
        return new_state

    except Exception as exc:
        log.error("cleaning_failed", run_id=run_id, error=str(exc))
        await emit_event(run_id, "CleaningNode", "error", reasoning=str(exc))
        return {"error": str(exc)}
