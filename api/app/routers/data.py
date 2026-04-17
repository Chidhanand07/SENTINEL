from __future__ import annotations

from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AnomalyAlert, Forecast, Lineage, Segment
from app.db.session import get_db

log = structlog.get_logger()
router = APIRouter()


@router.get("/segments/{run_id}")
async def get_segments(run_id: str, db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    result = await db.execute(select(Segment).where(Segment.run_id == run_id))
    segs = result.scalars().all()
    log.info("[API] GET /segments/{run_id}", run_id=run_id, segment_count=len(segs))
    return [
        {
            "cluster_id": s.cluster_id,
            "persona_name": s.persona_name,
            "size": s.size,
            "avg_ltv": s.avg_ltv,
            "avg_recency": s.avg_recency,
            "avg_frequency": s.avg_frequency,
            "traits": s.traits.get("traits", []) if s.traits else [],
            "recommended_action": s.recommended_action,
            "color": s.color,
        }
        for s in segs
    ]


@router.get("/forecast/{run_id}")
async def get_forecasts(
    run_id: str,
    first: bool = Query(False, description="Return only first record with forecast_data (for KPI chart)"),
    summary: bool = Query(False, description="Return lightweight rows without forecast_data"),
    sku_id: str | None = Query(None, description="Filter detail by sku"),
    state: str | None = Query(None, description="Filter detail by region/state"),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    result = await db.execute(select(Forecast).where(Forecast.run_id == run_id))
    forecasts = result.scalars().all()
    log.info("[API] GET /forecast/{run_id}", run_id=run_id, forecast_count=len(forecasts), first=first)

    rows: list[dict[str, Any]] = []
    for f in forecasts:
        if sku_id and f.sku_id != sku_id:
            continue
        if state and f.state != state:
            continue
        base = {
            "sku_id": f.sku_id,
            "state": f.state,
            "horizon_days": f.horizon_days,
            "forecast_value": f.forecast_value,
            "lower_ci": f.lower_ci,
            "upper_ci": f.upper_ci,
            "model_used": f.model_used,
            "mape": f.mape,
        }
        if not summary:
            base["forecast_data"] = f.forecast_data
        rows.append(base)

    if first:
        # Return only the single record with the richest historical time-series
        with_data = [r for r in rows if r.get("forecast_data") and r["forecast_data"].get("historical_dates")]
        return with_data[:1] if with_data else rows[:1]

    return rows


@router.get("/lineage/{run_id}")
async def get_lineage(run_id: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await db.execute(
        select(Lineage).where(Lineage.run_id == run_id).order_by(Lineage.step_order)
    )
    steps = result.scalars().all()

    # Fetch quality metrics from Run record (persisted by narrator_node)
    from app.db.models import Run
    run = await db.get(Run, run_id)
    quality = run.quality_metrics if run and run.quality_metrics else None

    log.info("[API] GET /lineage/{run_id}", run_id=run_id, step_count=len(steps))
    return {
        "steps": [
            {
                "step_order": s.step_order,
                "agent": s.agent,
                "transformation": s.transformation,
                "rows_in": s.rows_in,
                "rows_out": s.rows_out,
                "duration_ms": s.duration_ms,
            }
            for s in steps
        ],
        "quality": quality,
    }


@router.get("/alerts/{run_id}")
async def get_alerts(run_id: str, db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    result = await db.execute(
        select(AnomalyAlert).where(AnomalyAlert.run_id == run_id).order_by(AnomalyAlert.detected_at.desc())
    )
    alerts = result.scalars().all()
    log.info("[API] GET /alerts/{run_id}", run_id=run_id, alert_count=len(alerts))
    return [
        {
            "metric": a.metric,
            "ks_stat": a.ks_stat,
            "p_value": a.p_value,
            "direction": a.direction,
            "diagnosis": a.diagnosis,
            "detected_at": str(a.detected_at),
            "dispatched_slack": a.dispatched_slack,
        }
        for a in alerts
    ]


@router.get("/runs")
async def list_runs(db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    from app.db.models import Run
    from sqlalchemy import desc
    result = await db.execute(select(Run).order_by(desc(Run.created_at)).limit(50))
    runs = result.scalars().all()
    return [
        {
            "run_id": r.run_id,
            "status": r.status,
            "created_at": str(r.created_at),
            "completed_at": str(r.completed_at) if r.completed_at else None,
            "kpi_summary": r.kpi_summary,
        }
        for r in runs
    ]
