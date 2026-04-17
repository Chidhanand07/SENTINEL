from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def gen_uuid() -> str:
    return str(uuid.uuid4())


class Run(Base):
    __tablename__ = "runs"

    run_id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    status: Mapped[str] = mapped_column(String, default="queued")
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    dataset_path: Mapped[str] = mapped_column(String, default="")
    user_id: Mapped[str] = mapped_column(String, default="anonymous")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    kpi_summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    schema_map: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    available_analyses: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    insight_brief: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    quality_metrics: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class AgentEvent(Base):
    __tablename__ = "agent_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String, ForeignKey("runs.run_id"))
    node: Mapped[str] = mapped_column(String)
    event_type: Mapped[str] = mapped_column(String)
    layer: Mapped[str] = mapped_column(String, default="langgraph")  # n8n | langgraph | langchain
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    ts: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String, ForeignKey("runs.run_id"))
    type: Mapped[str] = mapped_column(String)
    s3_key: Mapped[str] = mapped_column(String)
    metadata_: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Segment(Base):
    __tablename__ = "segments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String, ForeignKey("runs.run_id"))
    cluster_id: Mapped[int] = mapped_column(Integer)
    persona_name: Mapped[str] = mapped_column(String)
    size: Mapped[int] = mapped_column(Integer)
    avg_ltv: Mapped[float] = mapped_column(Float)
    avg_recency: Mapped[float] = mapped_column(Float, default=0)
    avg_frequency: Mapped[float] = mapped_column(Float, default=0)
    traits: Mapped[dict] = mapped_column(JSON, default=dict)
    recommended_action: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String, default="#E8A838")


class Forecast(Base):
    __tablename__ = "forecasts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String, ForeignKey("runs.run_id"))
    sku_id: Mapped[str] = mapped_column(String)
    state: Mapped[str] = mapped_column(String)
    horizon_days: Mapped[int] = mapped_column(Integer)
    forecast_value: Mapped[float] = mapped_column(Float)
    lower_ci: Mapped[float] = mapped_column(Float)
    upper_ci: Mapped[float] = mapped_column(Float)
    model_used: Mapped[str] = mapped_column(String)
    mape: Mapped[float] = mapped_column(Float)
    forecast_data: Mapped[dict] = mapped_column(JSON, default=dict)


class AnomalyAlert(Base):
    __tablename__ = "anomaly_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String, ForeignKey("runs.run_id"))
    metric: Mapped[str] = mapped_column(String)
    ks_stat: Mapped[float] = mapped_column(Float)
    p_value: Mapped[float] = mapped_column(Float)
    direction: Mapped[str] = mapped_column(String)
    diagnosis: Mapped[str] = mapped_column(Text)
    detected_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    dispatched_slack: Mapped[bool] = mapped_column(default=False)
    dispatched_email: Mapped[bool] = mapped_column(default=False)


class Lineage(Base):
    __tablename__ = "lineage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String, ForeignKey("runs.run_id"))
    step_order: Mapped[int] = mapped_column(Integer)
    agent: Mapped[str] = mapped_column(String)
    transformation: Mapped[str] = mapped_column(Text)
    rows_in: Mapped[int] = mapped_column(Integer, default=0)
    rows_out: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    ts: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class N8nEvent(Base):
    __tablename__ = "n8n_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workflow_id: Mapped[str] = mapped_column(String)
    workflow_name: Mapped[str] = mapped_column(String, default="")
    event_type: Mapped[str] = mapped_column(String)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    ts: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
