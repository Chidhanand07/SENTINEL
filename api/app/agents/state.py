from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class PipelineState(BaseModel):
    """Shared state passed between all LangGraph nodes."""

    run_id: str
    dataset_path: str
    config: dict[str, Any] = Field(default_factory=dict)

    # Populated progressively
    schema_map: dict[str, Any] | None = None
    available_analyses: dict[str, Any] | None = None
    master_df_path: str | None = None       # parquet on MinIO
    profile_report: dict[str, Any] | None = None
    clean_df_path: str | None = None
    eda_artifact_keys: list[str] = Field(default_factory=list)
    feature_cols: list[str] = Field(default_factory=list)
    segments: list[dict[str, Any]] = Field(default_factory=list)
    forecasts: list[dict[str, Any]] = Field(default_factory=list)
    model_leaderboard: list[dict[str, Any]] = Field(default_factory=list)
    anomaly_log: list[dict[str, Any]] = Field(default_factory=list)
    insight_brief: str | None = None
    pdf_key: str | None = None
    lineage: list[dict[str, Any]] = Field(default_factory=list)
    human_feedback: str | None = None       # injected mid-run via checkpoint
    error: str | None = None
    kpi_summary: dict[str, Any] = Field(default_factory=dict)
