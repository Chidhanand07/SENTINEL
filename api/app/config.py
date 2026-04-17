from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Project
    project_name: str = "SENTINEL"
    environment: str = "development"

    # Postgres
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_db: str = "analytics"
    postgres_user: str = "analytics"
    postgres_password: str = "analytics"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def sync_database_url(self) -> str:
        return (
            f"postgresql://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # MinIO
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_secure: bool = False
    minio_bucket_datasets: str = "datasets"
    minio_bucket_charts: str = "charts"
    minio_bucket_reports: str = "reports"
    minio_bucket_models: str = "models"

    # MLflow
    mlflow_tracking_uri: str = "http://mlflow:5001"

    # n8n
    n8n_base_url: str = "http://n8n:5678"
    n8n_alert_webhook_url: str = "http://n8n:5678/webhook/n8n/alert"
    n8n_run_complete_webhook_url: str = "http://n8n:5678/webhook/n8n/run-complete"
    n8n_feedback_webhook_url: str = "http://n8n:5678/webhook/n8n/feedback"

    # LLM — Google Gemini
    google_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash-preview-04-17"

    # Auth
    jwt_secret: str = "replace-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24

    # ARQ
    arq_queue_name: str = "analytics-pipeline"

    # Data
    data_dir: str = "/data"

    # Upload configuration
    max_upload_size_bytes: int = 500 * 1024 * 1024  # 500 MB
    upload_timeout_seconds: int = 120  # 2 minutes for large files


settings = Settings()
