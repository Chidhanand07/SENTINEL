from __future__ import annotations

import time
from typing import Any

import structlog

from app.agents.events import emit_event, save_checkpoint
from app.agents.state import PipelineState
from app.tools.data_tools import execute_join, infer_join_keys, write_parquet_to_minio

log = structlog.get_logger()


async def schema_join_node(state: PipelineState) -> dict[str, Any]:
    t0 = time.monotonic()
    run_id = state.run_id

    await emit_event(
        run_id, "SchemaJoinNode", "started",
        layer="langgraph",
        reasoning="Scanning uploaded CSVs to infer optimal join keys using column name heuristics + dtype analysis.",
    )

    try:
        import glob
        import os

        dataset_path = state.dataset_path
        csv_files = glob.glob(os.path.join(dataset_path, "*.csv"))
        if not csv_files:
            # Fallback: check both bind-mount and /tmp paths
            csv_files = glob.glob(os.path.join("/tmp/sentinel_uploads", "**", "*.csv"), recursive=True)
        if not csv_files:
            csv_files = glob.glob(os.path.join("/data/uploads", "**", "*.csv"), recursive=True)

        await emit_event(
            run_id, "SchemaJoinNode", "tool_call",
            layer="langchain",
            tool_called="infer_join_keys",
            reasoning=f"Found {len(csv_files)} CSV files. Analyzing join keys.",
            rows_in=len(csv_files),
        )

        join_plan = infer_join_keys(csv_files)

        await emit_event(
            run_id, "SchemaJoinNode", "tool_call",
            layer="langchain",
            tool_called="execute_join",
            reasoning=f"Join plan ready: {join_plan.get('strategy', 'sequential')}. Executing multi-table merge.",
        )

        master_df = execute_join(join_plan, csv_files)
        rows_before_cap = len(master_df)
        
        # DATA CAP: Hackathon mode — 5000 row cap for speed
        if len(master_df) > 5000:
            import random
            random.seed(42)
            master_df = master_df.sample(n=5000, random_state=42)
            await emit_event(
                run_id, "SchemaJoinNode", "data_cap",
                layer="langgraph",
                reasoning=f"Data cap applied: {rows_before_cap:,} rows → {len(master_df):,} rows for hackathon speed.",
            )
        
        rows_out = len(master_df)

        await emit_event(
            run_id, "SchemaJoinNode", "tool_call",
            layer="langchain",
            tool_called="write_parquet_to_minio",
            reasoning=f"Master DataFrame: {rows_out:,} rows × {len(master_df.columns)} cols. Writing to MinIO.",
            rows_in=rows_out,
            rows_out=rows_out,
        )

        master_key = write_parquet_to_minio(master_df, f"datasets/{run_id}/master.parquet")

        from app.agents.schema_detector import SchemaDetector
        from app.db.session import AsyncSessionLocal
        from app.db.models import Run

        detector = SchemaDetector()
        detected_schema = detector.detect(master_df, table_count=len(csv_files), join_keys=list(join_plan.get("keys", [])))
        available_analyses = detector.detect_available_analyses(detected_schema, master_df)
        
        async with AsyncSessionLocal() as session:
            run = await session.get(Run, run_id)
            if run:
                run.schema_map = detected_schema.dict()
                run.available_analyses = available_analyses.dict()
                await session.commit()
                # Force flush to ensure persistence
                await session.refresh(run)
                log.info("schema_map_persisted_to_db", run_id=run_id, has_schema=run.schema_map is not None)

        latency = int((time.monotonic() - t0) * 1000)
        lineage_entry = {
            "step_order": 1,
            "agent": "SchemaJoinNode",
            "transformation": f"Joined {len(csv_files)} CSVs → {rows_out:,} rows via {join_plan.get('strategy')}",
            "rows_in": sum(join_plan.get("file_rows", {}).values()) or rows_out,
            "rows_out": rows_out,
            "duration_ms": latency,
        }

        await emit_event(
            run_id, "SchemaJoinNode", "completed",
            layer="langgraph",
            rows_in=len(csv_files),
            rows_out=rows_out,
            latency_ms=latency,
            artifact_key=master_key,
            reasoning=f"Join complete. {rows_out:,} rows, {len(master_df.columns)} features. Schema: {list(master_df.columns[:8])}...",
        )

        new_state = {
            "schema_map": detected_schema.dict(),
            "available_analyses": available_analyses.dict(),
            "master_df_path": master_key,
            "lineage": state.lineage + [lineage_entry],
        }
        await save_checkpoint(run_id, "SchemaJoinNode", new_state)
        return new_state

    except Exception as exc:
        log.error("schema_join_failed", run_id=run_id, error=str(exc))
        await emit_event(run_id, "SchemaJoinNode", "error", reasoning=str(exc))
        return {"error": str(exc)}
