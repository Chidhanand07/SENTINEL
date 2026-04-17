from __future__ import annotations

"""
AnomalyWatchAgent — runs as a background asyncio task.
Every 60s, reads the clean DataFrame from MinIO and runs KS-test
on rolling revenue windows. Fires n8n webhook if drift detected.
"""

import asyncio
import json
from typing import Any

import httpx
import structlog

from app.config import settings

log = structlog.get_logger()


async def watch_anomalies(run_id: str, clean_df_path: str) -> None:
    """Continuous anomaly monitoring loop. Call as asyncio background task."""
    log.info("anomaly_watcher_start", run_id=run_id)

    iteration = 0
    while True:
        await asyncio.sleep(60)
        iteration += 1

        try:
            from app.tools.data_tools import read_parquet_from_minio
            import numpy as np
            from scipy import stats

            df = read_parquet_from_minio(clean_df_path)

            # Find revenue column + date column
            rev_col = next((c for c in df.columns if c in ["payment_value", "price"]), None)
            date_col = next((c for c in df.columns if "purchase" in c.lower() and "date" in c.lower()), None)

            if not (rev_col and date_col):
                continue

            import pandas as pd
            df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
            df = df.dropna(subset=[date_col, rev_col])

            # Split into two windows: first half vs recent
            df = df.sort_values(date_col)
            midpoint = len(df) // 2
            baseline = df.iloc[:midpoint][rev_col].values
            recent = df.iloc[midpoint:][rev_col].values

            if len(baseline) < 30 or len(recent) < 30:
                continue

            ks_stat, p_value = stats.ks_2samp(baseline, recent)

            if p_value < 0.05:
                direction = "down" if recent.mean() < baseline.mean() else "up"
                diagnosis = (
                    f"Revenue distribution shifted {direction}. "
                    f"Baseline mean: R$ {baseline.mean():.2f}, "
                    f"Recent mean: R$ {recent.mean():.2f}. "
                    f"KS-stat: {ks_stat:.3f}, p-value: {p_value:.4f}."
                )

                alert = {
                    "run_id": run_id,
                    "metric": rev_col,
                    "direction": direction,
                    "ks_stat": round(float(ks_stat), 4),
                    "p_value": round(float(p_value), 6),
                    "diagnosis": diagnosis,
                }

                log.warning("anomaly_detected", **alert)

                # Call n8n alert webhook
                async with httpx.AsyncClient(timeout=5) as client:
                    await client.post(f"http://localhost:8000/n8n/alert", json=alert)

        except asyncio.CancelledError:
            log.info("anomaly_watcher_cancelled", run_id=run_id)
            return
        except Exception as exc:
            log.warning("anomaly_watcher_error", error=str(exc))
