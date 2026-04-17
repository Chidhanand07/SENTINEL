from __future__ import annotations

"""ARQ background worker — runs the LangGraph pipeline as an async job."""

import asyncio

import structlog
from arq import create_pool
from arq.connections import RedisSettings

from app.config import settings

log = structlog.get_logger()


async def run_pipeline_job(ctx: dict, run_id: str, dataset_path: str, config: dict) -> str:
    from app.agents.graph import run_pipeline
    log.info("arq_job_start", run_id=run_id)
    result = await run_pipeline({"run_id": run_id, "dataset_path": dataset_path, "config": config})
    log.info("arq_job_complete", run_id=run_id)
    return result.get("status", "completed")


async def startup(ctx: dict) -> None:
    log.info("arq_worker_startup")


async def shutdown(ctx: dict) -> None:
    log.info("arq_worker_shutdown")


class WorkerSettings:
    functions = [run_pipeline_job]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    queue_name = settings.arq_queue_name
    max_jobs = 4
    job_timeout = 3600


if __name__ == "__main__":
    from arq import run_worker
    run_worker(WorkerSettings)  # type: ignore[arg-type]
