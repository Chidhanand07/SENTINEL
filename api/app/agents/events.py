from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime
from typing import Any
from collections import defaultdict, deque

import redis.asyncio as aioredis
import structlog

from app.config import settings

log = structlog.get_logger()

_redis: aioredis.Redis | None = None
_memory_event_log: dict[str, deque[dict[str, Any]]] = defaultdict(lambda: deque(maxlen=500))


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def emit_event(
    run_id: str,
    node: str,
    status: str,
    layer: str = "langgraph",
    tool_called: str | None = None,
    reasoning: str | None = None,
    rows_in: int = 0,
    rows_out: int = 0,
    latency_ms: int = 0,
    artifact_key: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    event: dict[str, Any] = {
        "run_id": run_id,
        "node": node,
        "status": status,
        "layer": layer,
        "tool_called": tool_called,
        "reasoning": reasoning,
        "rows_in": rows_in,
        "rows_out": rows_out,
        "latency_ms": latency_ms,
        "artifact_key": artifact_key,
        "ts": datetime.utcnow().isoformat(),
        **(extra or {}),
    }
    try:
        r = await get_redis()
        channel = f"events:{run_id}"
        await r.publish(channel, json.dumps(event))
        # Also push to a list for replay
        await r.rpush(f"event_log:{run_id}", json.dumps(event))
        await r.expire(f"event_log:{run_id}", 86400)
    except Exception as exc:
        log.warning("event_emit_failed", error=str(exc))
    finally:
        # Always keep an in-process fallback buffer so UI trace still works
        _memory_event_log[run_id].append(event)


async def save_checkpoint(run_id: str, node: str, state_dict: dict[str, Any]) -> None:
    try:
        r = await get_redis()
        key = f"checkpoint:{run_id}:{node}"
        await r.set(key, json.dumps(state_dict, default=str), ex=86400)
    except Exception as exc:
        log.warning("checkpoint_save_failed", error=str(exc))


async def load_checkpoint(run_id: str, node: str) -> dict[str, Any] | None:
    try:
        r = await get_redis()
        key = f"checkpoint:{run_id}:{node}"
        data = await r.get(key)
        return json.loads(data) if data else None
    except Exception:
        return None


async def get_event_log(run_id: str) -> list[dict[str, Any]]:
    try:
        r = await get_redis()
        raw = await r.lrange(f"event_log:{run_id}", 0, -1)
        if raw:
            return [json.loads(e) for e in raw]
    except Exception:
        pass
    return list(_memory_event_log.get(run_id, []))
