from __future__ import annotations

import asyncio
from typing import Any

import structlog
from langgraph.graph import END, StateGraph

from app.agents.nodes.cleaning import cleaning_node
from app.agents.nodes.eda import eda_node
from app.agents.nodes.feature_engineering import feature_engineering_node
from app.agents.nodes.forecast import forecast_node
from app.agents.nodes.narrator import narrator_node
from app.agents.nodes.profiler import profiler_node
from app.agents.nodes.schema_join import schema_join_node
from app.agents.nodes.segmentation import segmentation_node
from app.agents.state import PipelineState

log = structlog.get_logger()


def _dict_to_state(data: dict[str, Any]) -> PipelineState:
    return PipelineState(**data)


async def _parallel_branch(state: PipelineState) -> dict[str, Any]:
    """Run SegmentationNode and ForecastNode concurrently."""
    seg_task = asyncio.create_task(segmentation_node(state))
    fcast_task = asyncio.create_task(forecast_node(state))
    seg_result, fcast_result = await asyncio.gather(seg_task, fcast_task)
    # Merge both results
    merged: dict[str, Any] = {}
    merged.update(seg_result)
    merged.update(fcast_result)
    # Merge lineage lists
    merged["lineage"] = (
        state.lineage
        + seg_result.get("lineage", [])
        + fcast_result.get("lineage", [])
    )
    return merged


def build_graph() -> StateGraph:
    """Build the LangGraph StateGraph with parallel branches."""
    # We use a simplified graph since LangGraph's parallel branch API
    # differs by version — we implement parallelism inside the node itself.
    graph = StateGraph(dict)

    graph.add_node("SchemaJoinNode", lambda s: asyncio.get_event_loop().run_until_complete(
        schema_join_node(_dict_to_state(s))
    ))
    graph.add_node("ProfilerNode", lambda s: asyncio.get_event_loop().run_until_complete(
        profiler_node(_dict_to_state(s))
    ))
    graph.add_node("CleaningNode", lambda s: asyncio.get_event_loop().run_until_complete(
        cleaning_node(_dict_to_state(s))
    ))
    graph.add_node("EDANode", lambda s: asyncio.get_event_loop().run_until_complete(
        eda_node(_dict_to_state(s))
    ))
    graph.add_node("ParallelBranch", lambda s: asyncio.get_event_loop().run_until_complete(
        _parallel_branch(_dict_to_state(s))
    ))
    graph.add_node("NarratorNode", lambda s: asyncio.get_event_loop().run_until_complete(
        narrator_node(_dict_to_state(s))
    ))

    graph.set_entry_point("SchemaJoinNode")
    graph.add_edge("SchemaJoinNode", "ProfilerNode")
    graph.add_edge("ProfilerNode", "CleaningNode")
    graph.add_edge("CleaningNode", "EDANode")
    graph.add_edge("EDANode", "ParallelBranch")
    graph.add_edge("ParallelBranch", "NarratorNode")
    graph.add_edge("NarratorNode", END)

    return graph.compile()


async def run_pipeline(initial_state: dict[str, Any]) -> dict[str, Any]:
    """Execute the full pipeline asynchronously.

    Critical path (fast, blocking):
        SchemaJoin → Profiler → Cleaning → FeatureEngineering → ParallelBranch → Narrator

    Off critical path (background, non-blocking):
        EDANode — chart generation + MinIO uploads run concurrently; pipeline
        doesn't wait for them so the UI gets results much sooner.
    """
    state = PipelineState(**initial_state)
    log.info("pipeline_start", run_id=state.run_id)

    updates: dict[str, Any] = state.model_dump()

    # ── Critical path: sequential fast nodes ──────────────────────────────
    for node_fn in [
        schema_join_node,
        profiler_node,
        cleaning_node,
        feature_engineering_node,
    ]:
        current = PipelineState(**updates)
        result = await node_fn(current)
        updates.update(result)
        if updates.get("error"):
            log.error("pipeline_node_failed", node=node_fn.__name__, error=updates["error"])
            break

    if not updates.get("error"):
        # Fire EDA in background — charts are cosmetic, don't block ML nodes
        eda_state = PipelineState(**updates)
        asyncio.create_task(_run_eda_background(eda_state))

        # Parallel branch: segmentation + forecast run concurrently
        current = PipelineState(**updates)
        parallel_result = await _parallel_branch(current)
        updates.update(parallel_result)

    if not updates.get("error"):
        current = PipelineState(**updates)
        result = await narrator_node(current)
        updates.update(result)

    log.info("pipeline_complete", run_id=state.run_id)
    return updates


async def _run_eda_background(state: PipelineState) -> None:
    """Run EDA off the critical path — errors are logged, never propagated."""
    try:
        await eda_node(state)
    except Exception as exc:
        log.warning("eda_background_failed", run_id=state.run_id, error=str(exc))
