from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any

import structlog
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.db.session import create_tables

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    log.info("sentinel_startup", env=settings.environment)
    await create_tables()
    log.info("database_ready")
    yield
    log.info("sentinel_shutdown")


app = FastAPI(
    title="SENTINEL API",
    description="Autonomous Analytics System — SOLARIS X Hackathon 2026",
    version="1.0.0",
    lifespan=lifespan,
)

# Configure for large file uploads (100 MB+)
# This affects the max body size for all endpoints
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────
from app.routers import pipeline, n8n_proxy, data, report, manifest, chat  # noqa: E402

app.include_router(pipeline.router, tags=["pipeline"])
app.include_router(manifest.router, tags=["manifest"])
app.include_router(n8n_proxy.router, prefix="/n8n", tags=["n8n"])
app.include_router(data.router, tags=["data"])
app.include_router(report.router, tags=["report"])
app.include_router(chat.router, tags=["chat"])


# ── N8N Event Webhook ────────────────────────────────────────────────────────
# POST /api/n8n/event — receives workflow node completion events from n8n
@app.post("/api/n8n/event")
async def n8n_event(data: dict[str, Any]) -> dict[str, str]:
    """
    Accept n8n workflow node events and broadcast them to WebSocket subscribers.
    
    Expected JSON:
    {
        "run_id": "string",
        "node": "string",           # Node name (e.g., "Upload", "Profiler")
        "layer": "n8n",
        "status": "running|complete"
    }
    """
    run_id = data.get("run_id", "")
    node = data.get("node", "")
    status = data.get("status", "")
    
    if not run_id or not node:
        return {"error": "Missing run_id or node"}
    
    log.info("[n8n_event]", run_id=run_id, node=node, status=status)
    
    # Broadcast to all WebSocket subscribers for this run_id
    await manager.broadcast(run_id, {
        "type": "n8n_node_event",
        "run_id": run_id,
        "node": node,
        "layer": data.get("layer", "n8n"),
        "status": status,
        "ts": data.get("ts", ""),
    })
    
    return {"status": "ok"}


# ── WebSocket — live event stream ─────────────────────────────────────────

class ConnectionManager:
    def __init__(self) -> None:
        self.active: dict[str, list[WebSocket]] = {}

    async def connect(self, run_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.active.setdefault(run_id, []).append(ws)

    def disconnect(self, run_id: str, ws: WebSocket) -> None:
        if run_id in self.active:
            self.active[run_id].discard(ws) if hasattr(self.active[run_id], "discard") else None
            try:
                self.active[run_id].remove(ws)
            except ValueError:
                pass

    async def broadcast(self, run_id: str, message: dict[str, Any]) -> None:
        dead = []
        for ws in self.active.get(run_id, []):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(run_id, ws)


manager = ConnectionManager()


@app.websocket("/ws/pipeline/{run_id}")
async def websocket_pipeline(websocket: WebSocket, run_id: str) -> None:
    await manager.connect(run_id, websocket)
    log.info("ws_connected", run_id=run_id)

    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        pubsub = r.pubsub()
        await pubsub.subscribe(f"events:{run_id}")

        # Replay historical events first
        from app.agents.events import get_event_log
        history = await get_event_log(run_id)
        for event in history:
            try:
                await websocket.send_json(event)
            except Exception:
                break

        # Stream new events
        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    data = json.loads(message["data"])
                    await websocket.send_json(data)
                except Exception:
                    continue
    except WebSocketDisconnect:
        log.info("ws_disconnected", run_id=run_id)
    except Exception as exc:
        log.warning("ws_error", run_id=run_id, error=str(exc))
    finally:
        manager.disconnect(run_id, websocket)


# ── SSE alert stream ──────────────────────────────────────────────────────

sse_subscribers: list[asyncio.Queue[dict[str, Any]]] = []


@app.get("/sse/alerts")
async def sse_alerts() -> StreamingResponse:
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    sse_subscribers.append(queue)

    async def event_stream():
        try:
            yield "data: {\"type\": \"connected\"}\n\n"
            while True:
                event = await asyncio.wait_for(queue.get(), timeout=30)
                yield f"data: {json.dumps(event)}\n\n"
        except asyncio.TimeoutError:
            yield "data: {\"type\": \"ping\"}\n\n"
        except Exception:
            pass
        finally:
            try:
                sse_subscribers.remove(queue)
            except ValueError:
                pass

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/sse/broadcast")
async def sse_broadcast(payload: dict[str, Any]) -> dict[str, str]:
    for q in sse_subscribers:
        await q.put(payload)
    return {"status": "broadcast_sent", "subscribers": str(len(sse_subscribers))}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "sentinel-api"}


@app.get("/events/{run_id}")
async def get_events(run_id: str) -> dict[str, Any]:
    from app.agents.events import get_event_log
    events = await get_event_log(run_id)
    return {"run_id": run_id, "events": events}
