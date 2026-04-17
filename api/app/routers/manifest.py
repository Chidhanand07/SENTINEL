import os
import json
from typing import Any

from fastapi import APIRouter, HTTPException
from app.db.session import AsyncSessionLocal
from app.db.models import Run

router = APIRouter()

@router.get("/manifest/{run_id}")
async def get_manifest(run_id: str) -> dict[str, Any]:
    """
    Returns the dynamic manifest for a given run containing the
    detected schema and available feature analyses.
    """
    async with AsyncSessionLocal() as session:
        run = await session.get(Run, run_id)
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
            
        dataset_name = "Unknown Dataset"
        if run.dataset_path:
            dataset_name = os.path.basename(run.dataset_path)
            
        schema_map = run.schema_map
        available_analyses = run.available_analyses
        
        # If still computing, it will be None
        if not schema_map:
            return {
                "run_id": run_id,
                "dataset_name": dataset_name,
                "detected_schema": None,
                "available_analyses": None
            }
            
        return {
            "run_id": run_id,
            "dataset_name": dataset_name,
            "detected_schema": schema_map,
            "available_analyses": available_analyses
        }
