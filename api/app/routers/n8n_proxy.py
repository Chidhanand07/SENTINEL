from __future__ import annotations

"""
n8n proxy router — fix #3.
Browser → api:8000/n8n/upload (CORS-safe) → n8n webhook + file persistence.
"""

import asyncio
import os
import uuid
from typing import Any

import structlog
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.config import settings

log = structlog.get_logger()
router = APIRouter()


# ── Workflow 1 — Upload ───────────────────────────────────────────────────

@router.post("/upload")
async def upload_dataset(
    bg: BackgroundTasks,
    files: list[UploadFile] = File(...),
    run_id: str = Form(default=""),
) -> dict[str, Any]:
    """Receive CSV files from browser, save to /tmp, trigger pipeline.
    
    Now supports files up to 500 MB with streaming to handle memory efficiently.
    """
    run_id = run_id or str(uuid.uuid4())
    # Write to /tmp — in-container filesystem, avoids slow macOS Docker bind-mount on ./data
    upload_dir = os.path.join("/tmp/sentinel_uploads", run_id)
    os.makedirs(upload_dir, exist_ok=True)

    saved_files: list[str] = []
    total_size = 0
    
    for f in files:
        safe_name = os.path.basename(f.filename or "upload.csv")
        dest = os.path.join(upload_dir, safe_name)
        
        # Stream the file in chunks instead of reading all at once
        # This keeps memory usage constant regardless of file size
        chunk_size = 1024 * 1024  # 1 MB chunks
        file_size = 0
        
        with open(dest, "wb") as dest_file:
            while True:
                chunk = await f.read(chunk_size)
                if not chunk:
                    break
                dest_file.write(chunk)
                file_size += len(chunk)
        
        total_size += file_size
        saved_files.append(dest)
        log.info(
            "file_saved",
            run_id=run_id,
            file=safe_name,
            size_mb=round(file_size / 1024 / 1024, 1)
        )

    # Emit an immediate "received" event so the WebSocket/pipeline stepper
    # lights up instantly — before the slower CSV-reading phase starts
    bg.add_task(_emit_upload_started, run_id, saved_files)

    # Start pipeline
    bg.add_task(_start_pipeline, run_id, upload_dir)

    # Notify n8n workflow 1 (fire-and-forget)
    bg.add_task(_notify_n8n_upload, run_id, saved_files)

    return {"run_id": run_id, "status": "queued", "files": [os.path.basename(f) for f in saved_files]}


async def _emit_upload_started(run_id: str, files: list[str]) -> None:
    """Immediately broadcast a pipeline-started event so the UI reacts at once."""
    from app.agents.events import emit_event
    file_names = [os.path.basename(f) for f in files]
    await emit_event(
        run_id, "n8nUpload", "completed",
        layer="n8n",
        reasoning=f"Upload received: {', '.join(file_names)}. Pipeline queued.",
        rows_in=len(files),
        rows_out=len(files),
    )


async def _start_pipeline(run_id: str, dataset_path: str) -> None:
    """Start the pipeline directly (no localhost self-call which breaks inside Docker)."""
    from app.agents.graph import run_pipeline
    from app.db.session import AsyncSessionLocal
    from app.db.models import Run
    import datetime

    async with AsyncSessionLocal() as session:
        run = await session.get(Run, run_id)
        if not run:
            run = Run(run_id=run_id, status="queued", dataset_path=dataset_path)
            session.add(run)
        run.status = "running"
        await session.commit()

    try:
        await run_pipeline({"run_id": run_id, "dataset_path": dataset_path, "config": {}})
        async with AsyncSessionLocal() as session:
            run = await session.get(Run, run_id)
            if run:
                run.status = "completed"
                run.completed_at = datetime.datetime.utcnow()
                await session.commit()
    except Exception as exc:
        log.error("pipeline_failed", run_id=run_id, error=str(exc))
        async with AsyncSessionLocal() as session:
            run = await session.get(Run, run_id)
            if run:
                run.status = "failed"
                run.error = str(exc)
                await session.commit()


async def _notify_n8n_upload(run_id: str, files: list[str]) -> None:
    import httpx
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                f"{settings.n8n_base_url}/webhook/n8n/upload",
                json={"run_id": run_id, "files": files, "status": "received"},
            )
    except Exception:
        pass  # n8n is optional


# ── Workflow 3 — Anomaly alert ────────────────────────────────────────────

class AlertPayload(BaseModel):
    run_id: str
    metric: str
    direction: str
    ks_stat: float
    p_value: float
    diagnosis: str


@router.post("/alert")
async def receive_alert(payload: AlertPayload, bg: BackgroundTasks) -> dict[str, str]:
    """Called by AnomalyWatchAgent → logs to DB → notifies n8n → broadcasts SSE."""
    import httpx
    from app.db.session import AsyncSessionLocal
    from app.db.models import AnomalyAlert

    async with AsyncSessionLocal() as session:
        alert = AnomalyAlert(
            run_id=payload.run_id,
            metric=payload.metric,
            ks_stat=payload.ks_stat,
            p_value=payload.p_value,
            direction=payload.direction,
            diagnosis=payload.diagnosis,
        )
        session.add(alert)
        await session.commit()

    # Broadcast to SSE subscribers
    bg.add_task(_broadcast_alert, payload.dict())

    # Forward to n8n workflow 3
    bg.add_task(_forward_alert_to_n8n, payload.dict())

    return {"status": "logged"}


async def _broadcast_alert(alert: dict[str, Any]) -> None:
    import httpx
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            await client.post("http://localhost:8000/sse/broadcast", json={
                "type": "anomaly_alert",
                **alert,
            })
    except Exception:
        pass


async def _forward_alert_to_n8n(alert: dict[str, Any]) -> None:
    import httpx
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(settings.n8n_alert_webhook_url, json=alert)
    except Exception:
        pass


# ── Workflow 4 — Run complete ─────────────────────────────────────────────

class RunCompletePayload(BaseModel):
    run_id: str
    kpi_summary: dict[str, Any] = {}
    top_segment: str = ""
    forecast_accuracy: str = ""


@router.post("/run-complete")
async def run_complete(payload: RunCompletePayload, bg: BackgroundTasks) -> dict[str, str]:
    from app.db.session import AsyncSessionLocal
    from app.db.models import Run, N8nEvent
    import datetime

    async with AsyncSessionLocal() as session:
        run = await session.get(Run, payload.run_id)
        if run:
            run.status = "completed"
            run.completed_at = datetime.datetime.utcnow()
            run.kpi_summary = payload.kpi_summary

        event = N8nEvent(
            workflow_id="workflow_4",
            workflow_name="Run Complete Notifier",
            event_type="run_complete",
            payload=payload.dict(),
        )
        session.add(event)
        await session.commit()

    return {"status": "recorded"}


# ── Workflow 5 — Human feedback relay ────────────────────────────────────

class FeedbackRelayPayload(BaseModel):
    run_id: str
    node_name: str
    constraint_text: str


@router.post("/feedback")
async def relay_feedback(payload: FeedbackRelayPayload) -> dict[str, str]:
    """Relay human constraint directly into Redis checkpoint (no localhost self-call)."""
    import json
    import redis.asyncio as aioredis
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        key = f"checkpoint:{payload.run_id}:{payload.node_name}"
        existing = await r.get(key)
        data = json.loads(existing) if existing else {}
        data["human_feedback"] = payload.constraint_text
        await r.set(key, json.dumps(data), ex=86400)
        log.info("feedback_relayed", run_id=payload.run_id, node=payload.node_name)
    except Exception as exc:
        raise HTTPException(500, str(exc))
    return {"status": "relayed", "run_id": payload.run_id, "node": payload.node_name}
