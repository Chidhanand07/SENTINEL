from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def create_tables() -> None:
    from app.db.models import Base
    from sqlalchemy import text

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Idempotent column additions for models added after initial schema
        for stmt in [
            "ALTER TABLE runs ADD COLUMN IF NOT EXISTS quality_metrics JSONB",
            "ALTER TABLE runs ADD COLUMN IF NOT EXISTS kpi_summary JSONB",
            "ALTER TABLE runs ADD COLUMN IF NOT EXISTS error TEXT",
            "ALTER TABLE runs ADD COLUMN IF NOT EXISTS insight_brief JSONB",
            "ALTER TABLE runs ADD COLUMN IF NOT EXISTS schema_map JSONB",
            "ALTER TABLE runs ADD COLUMN IF NOT EXISTS available_analyses JSONB",
        ]:
            await conn.execute(text(stmt))
