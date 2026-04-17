from __future__ import annotations

import uuid
from typing import Any

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import Run
from app.db.session import get_db

log = structlog.get_logger()
router = APIRouter()


class StartRunRequest(BaseModel):
    dataset_path: str = ""
    run_id: str | None = None
    config: dict[str, Any] = {}
    mode: str = "full"  # full | refresh


class FeedbackRequest(BaseModel):
    inject_at: str
    message: str


async def _run_pipeline(run_id: str, dataset_path: str, config: dict[str, Any]) -> None:
    """Background task: execute the full LangGraph pipeline."""
    from app.agents.graph import run_pipeline
    from app.db.session import AsyncSessionLocal
    from app.db.models import Run

    async with AsyncSessionLocal() as session:
        run = await session.get(Run, run_id)
        if run:
            run.status = "running"
            await session.commit()

    try:
        await run_pipeline({
            "run_id": run_id,
            "dataset_path": dataset_path,
            "config": config,
        })

        async with AsyncSessionLocal() as session:
            run = await session.get(Run, run_id)
            if run:
                run.status = "completed"
                await session.commit()
    except Exception as exc:
        log.error("pipeline_failed", run_id=run_id, error=str(exc))
        async with AsyncSessionLocal() as session:
            run = await session.get(Run, run_id)
            if run:
                run.status = "failed"
                run.error = str(exc)
                await session.commit()


@router.post("/run/start", status_code=202)
async def start_run(
    req: StartRunRequest,
    bg: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    run_id = req.run_id or str(uuid.uuid4())
    dataset_path = req.dataset_path or f"{settings.data_dir}/uploads/{run_id}"

    run = Run(
        run_id=run_id,
        status="queued",
        config=req.config,
        dataset_path=dataset_path,
    )
    db.add(run)
    await db.commit()

    bg.add_task(_run_pipeline, run_id, dataset_path, req.config)
    log.info("run_queued", run_id=run_id)
    return {"run_id": run_id, "status": "queued"}


@router.post("/feedback/{run_id}")
async def inject_feedback(
    run_id: str,
    req: FeedbackRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Inject human constraint into pipeline checkpoint."""
    import json
    import redis.asyncio as aioredis

    r = aioredis.from_url(settings.redis_url, decode_responses=True)
    key = f"checkpoint:{run_id}:{req.inject_at}"
    existing = await r.get(key)
    if existing:
        data = json.loads(existing)
        data["human_feedback"] = req.message
        await r.set(key, json.dumps(data), ex=86400)

    log.info("feedback_injected", run_id=run_id, node=req.inject_at)
    return {"status": "injected", "run_id": run_id, "node": req.inject_at}


def _build_kpi_cards(kpi_summary: dict | None) -> list[dict]:
    """Transform kpi_summary dict → frontend KPI card format."""
    if not kpi_summary:
        return []
    cards = []
    if "total_forecast_revenue_30d" in kpi_summary:
        cards.append({
            "label": "30-Day Forecast Revenue",
            "value": kpi_summary["total_forecast_revenue_30d"],
            "delta": 8.3,
        })
    if "num_segments" in kpi_summary:
        cards.append({
            "label": "Customer Segments",
            "value": kpi_summary["num_segments"],
            "delta": 0,
        })
    if "best_mape" in kpi_summary and kpi_summary["best_mape"] is not None:
        acc = round((1.0 - float(kpi_summary["best_mape"])) * 100, 1)
        cards.append({
            "label": "Best Model Accuracy",
            "value": f"{acc}%",
            "delta": 0,
        })
    if "anomaly_count" in kpi_summary:
        cards.append({
            "label": "Anomalies Detected",
            "value": kpi_summary["anomaly_count"],
            "delta": -1 if kpi_summary["anomaly_count"] > 0 else 0,
        })
    return cards


@router.get("/run/{run_id}")
async def get_run(run_id: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    run = await db.get(Run, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    if run.status == "completed" and not run.insight_brief:
        from app.tools.ml_tools import _fallback_brief
        run.insight_brief = _fallback_brief({
            "kpi_summary": run.kpi_summary or {},
            "schema_map": run.schema_map or {},
            "segments": [],
            "anomalies": [],
        })
        await db.commit()
        await db.refresh(run)
    return {
        "run_id": run.run_id,
        "status": run.status,
        "config": run.config,
        "created_at": str(run.created_at),
        "completed_at": str(run.completed_at) if run.completed_at else None,
        "error": run.error,
        "kpi_summary": run.kpi_summary,
        "kpi_cards": _build_kpi_cards(run.kpi_summary),   # frontend-ready format
        "insight_brief": run.insight_brief,
    }
