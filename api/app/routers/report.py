from __future__ import annotations

import io

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import get_db

router = APIRouter()


@router.get("/report/{run_id}")
async def download_report(run_id: str, db: AsyncSession = Depends(get_db)) -> StreamingResponse:
    """Stream PDF report from MinIO."""
    from minio import Minio, S3Error

    minio = Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
    )

    key = f"{run_id}/report.pdf"
    try:
        response = minio.get_object(settings.minio_bucket_reports, key)
        pdf_bytes = response.read()
    except S3Error:
        raise HTTPException(404, f"Report not found for run {run_id}")

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="sentinel-report-{run_id[:8]}.pdf"'},
    )


@router.get("/explain/{run_id}")
async def get_shap_explanation(run_id: str) -> dict:
    """Return SHAP waterfall data for the forecast model."""
    # Stub — returns synthetic SHAP values for demo
    import random
    features = ["lag_1", "lag_2", "lag_4", "day_of_week", "month", "trend", "seasonal"]
    values = [round(random.uniform(-50, 100), 2) for _ in features]
    return {
        "run_id": run_id,
        "base_value": 420.0,
        "features": features,
        "shap_values": values,
        "prediction": round(420 + sum(values), 2),
    }
