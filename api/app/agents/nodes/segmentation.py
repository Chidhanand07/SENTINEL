from __future__ import annotations

import time
from typing import Any

import pandas as pd
import structlog

from app.agents.events import emit_event, save_checkpoint
from app.agents.state import PipelineState
from app.tools.data_tools import read_parquet_from_minio
from app.tools.ml_tools import compute_rfm, label_clusters_with_llm, run_kmeans_sweep, write_segments_to_db

log = structlog.get_logger()

CLUSTER_COLORS = ["#E8A838", "#7C3AED", "#0EA5E9", "#10B981", "#EF4444", "#F59E0B", "#6366F1", "#14B8A6"]


async def segmentation_node(state: PipelineState) -> dict[str, Any]:
    t0 = time.monotonic()
    run_id = state.run_id

    await emit_event(
        run_id, "SegmentationNode", "started",
        layer="langgraph",
        reasoning="Computing RFM scores → k-means sweep k=2..8 → silhouette selection → LLM persona labeling.",
    )

    try:
        df = read_parquet_from_minio(state.clean_df_path or "")

        schema_map = state.schema_map or {}
        available_analyses = state.available_analyses or {}

        if not available_analyses.get("can_segment", False):
            await emit_event(run_id, "SegmentationNode", "completed", layer="langgraph", reasoning="Skipping segmentation: No customer identifier column detected.", rows_in=len(df), rows_out=0)
            new_state = {"segments": [], "lineage": state.lineage + [{"step_order": 5, "agent": "SegmentationNode", "transformation": "Skipped (no customer_col)", "rows_in": len(df), "rows_out": 0}]}
            await save_checkpoint(run_id, "SegmentationNode", new_state)
            return new_state

        if available_analyses.get("can_rfm", False):
            await emit_event(run_id, "SegmentationNode", "tool_call", layer="langchain", tool_called="compute_rfm", reasoning="Recency, Frequency, Monetary calculation.")
            feature_df = compute_rfm(df, schema_map.get("customer_col"), schema_map.get("date_col"), schema_map.get("revenue_col"))
        else:
            await emit_event(run_id, "SegmentationNode", "tool_call", layer="langchain", tool_called="aggregate_numeric", reasoning="Fallback clustering on numeric columns.")
            num_cols = schema_map.get("numeric_cols", [])
            id_col = schema_map.get("customer_col")
            if not num_cols or id_col not in df.columns:
                feature_df = pd.DataFrame()
            else:
                feature_df = df.groupby(id_col)[num_cols].mean().reset_index()

        if len(feature_df) == 0:
            await emit_event(run_id, "SegmentationNode", "completed", layer="langgraph", reasoning="Skipping segmentation: Insufficient data after aggregation.", rows_in=len(df), rows_out=0)
            new_state = {"segments": [], "lineage": state.lineage + [{"step_order": 5, "agent": "SegmentationNode", "transformation": "Skipped (no data)", "rows_in": len(df), "rows_out": 0}]}
            await save_checkpoint(run_id, "SegmentationNode", new_state)
            return new_state

        await emit_event(run_id, "SegmentationNode", "tool_call", layer="langchain",
                         tool_called="run_kmeans_sweep",
                         reasoning="Silhouette sweep k=2..8. Selecting optimal k via elbow + silhouette score.")
        cluster_result = run_kmeans_sweep(feature_df, range(2, 9))
        optimal_k = cluster_result["optimal_k"]

        await emit_event(run_id, "SegmentationNode", "tool_call", layer="langchain",
                         tool_called="label_clusters_with_llm",
                         reasoning=f"Optimal k={optimal_k}. Calling Gemini to generate persona cards per cluster.",
        )
        persona_cards = await label_clusters_with_llm(cluster_result["cluster_stats"])

        # Build segment records
        segments: list[dict[str, Any]] = []
        for i, card in enumerate(persona_cards):
            stats = cluster_result["cluster_stats"][i] if i < len(cluster_result["cluster_stats"]) else {}
            segments.append({
                "cluster_id": i,
                "persona_name": card.get("name", f"Segment {i+1}"),
                "size": stats.get("size", 0),
                "avg_ltv": stats.get("avg_monetary", 0),
                "avg_recency": stats.get("avg_recency", 0),
                "avg_frequency": stats.get("avg_frequency", 0),
                "traits": card.get("traits", []),
                "recommended_action": card.get("recommended_action", ""),
                "color": CLUSTER_COLORS[i % len(CLUSTER_COLORS)],
                "rfm_data": stats.get("rfm_sample", []),
            })

        await write_segments_to_db(segments, run_id)

        latency = int((time.monotonic() - t0) * 1000)

        await emit_event(
            run_id, "SegmentationNode", "completed",
            layer="langgraph",
            rows_in=len(feature_df),
            rows_out=len(segments),
            latency_ms=latency,
            reasoning=(
                f"Segmentation complete. {optimal_k} clusters. "
                f"Largest: '{segments[0]['persona_name']}' ({segments[0]['size']:,} customers)."
            ),
        )

        new_state = {
            "segments": segments,
            "lineage": state.lineage + [{
                "step_order": 5,
                "agent": "SegmentationNode",
                "transformation": f"RFM + k-means (k={optimal_k}) → {len(segments)} persona clusters",
                "rows_in": len(df),
                "rows_out": len(segments),
                "duration_ms": latency,
            }],
        }
        await save_checkpoint(run_id, "SegmentationNode", new_state)
        return new_state

    except Exception as exc:
        log.error("segmentation_failed", run_id=run_id, error=str(exc))
        await emit_event(run_id, "SegmentationNode", "error", reasoning=str(exc))
        return {"error": str(exc)}
