from __future__ import annotations

import time
from typing import Any

import structlog

from app.agents.events import emit_event, save_checkpoint
from app.agents.state import PipelineState
from app.tools.ml_tools import generate_executive_brief
from app.tools.pdf_tools import render_pdf_report, upload_pdf_to_minio

log = structlog.get_logger()


async def narrator_node(state: PipelineState) -> dict[str, Any]:
    t0 = time.monotonic()
    run_id = state.run_id

    await emit_event(
        run_id, "NarratorNode", "started",
        layer="langgraph",
        reasoning="Synthesizing all agent outputs into an executive brief via Gemini. Rendering WeasyPrint PDF.",
    )

    try:
        # Build KPI summary from forecasts + segments
        total_revenue = sum(
            f.get("forecast_value", 0) for f in state.forecasts if f.get("horizon_days") == 30
        )
        top_segment = state.segments[0] if state.segments else {}
        best_model = min(
            state.model_leaderboard,
            key=lambda x: float(x.get("mape") or 1),
            default={},
        )

        kpi_summary = {
            "total_forecast_revenue_30d": round(total_revenue, 2),
            "top_segment": top_segment.get("persona_name", "Unknown"),
            "top_segment_size": top_segment.get("size", 0),
            "best_model": best_model.get("model", "prophet"),
            "best_mape": float(best_model.get("mape") or 0),
            "anomaly_count": len(state.anomaly_log),
            "num_segments": len(state.segments),
            "num_forecasts": len(state.forecasts),
        }

        # Early-persist kpi_summary so frontend KPI polling gets data immediately
        # (before the slower PDF render + brief generation completes)
        from app.db.session import AsyncSessionLocal as _ASL
        from app.db.models import Run as _Run
        async with _ASL() as _s:
            _run = await _s.get(_Run, run_id)
            if _run:
                _run.kpi_summary = kpi_summary
                await _s.commit()

        await emit_event(run_id, "NarratorNode", "tool_call", layer="langchain",
                         tool_called="generate_executive_brief",
                         reasoning="Calling Gemini 2.5 Flash with full state summary → 3-section brief.")

        state_summary = {
            "dataset_name": state.config.get("dataset_name", "Uploaded Dataset"),
            "schema_map": state.schema_map,
            "kpi_summary": kpi_summary,
            "segments": [
                {"name": s["persona_name"], "size": s["size"], "avg_ltv": s["avg_ltv"],
                 "action": s["recommended_action"]}
                for s in state.segments[:5]
            ],
            "top_forecasts": [
                {"sku": f["sku_id"], "region": f["state"], "value": f["forecast_value"],
                 "model": f["model_used"], "mape": f["mape"]}
                for f in state.forecasts[:5]
            ],
            "anomalies": state.anomaly_log[:3],
            "lineage_steps": len(state.lineage),
        }

        # Timeout wrapper: keep brief generation snappy, fallback quickly
        try:
            from app.tools.ml_tools import _fallback_brief
            import asyncio
            brief = await asyncio.wait_for(
                generate_executive_brief(state_summary),
                timeout=8.0
            )
            brief["brief_source"] = "gemini"
        except asyncio.TimeoutError:
            log.warning("narrator_brief_timeout", run_id=run_id, timeout_s=8)
            await emit_event(run_id, "NarratorNode", "timeout",
                           layer="langgraph",
                           reasoning="Brief generation timeout (8s) → using fallback brief.")
            from app.tools.ml_tools import _fallback_brief
            brief = _fallback_brief(state_summary)
            brief["brief_source"] = "fallback"
        except Exception as e:
            log.warning("narrator_brief_error", run_id=run_id, error=str(e))
            from app.tools.ml_tools import _fallback_brief
            brief = _fallback_brief(state_summary)
            brief["brief_source"] = "fallback"

        await emit_event(run_id, "NarratorNode", "tool_call", layer="langchain",
                         tool_called="render_pdf_report",
                         reasoning="Rendering WeasyPrint PDF with cover page, KPIs, charts, personas, brief, lineage.")

        pdf_bytes = render_pdf_report(
            run_id=run_id,
            kpi_summary=kpi_summary,
            segments=state.segments,
            forecasts=state.forecasts[:10],
            model_leaderboard=state.model_leaderboard[:10],
            brief=brief,
            lineage=state.lineage,
            anomaly_log=state.anomaly_log,
        )

        pdf_key = upload_pdf_to_minio(pdf_bytes, run_id)

        latency = int((time.monotonic() - t0) * 1000)

        await emit_event(
            run_id, "NarratorNode", "completed",
            layer="langgraph",
            latency_ms=latency,
            artifact_key=pdf_key,
            reasoning="Pipeline complete. Executive brief generated. PDF uploaded. Notifying n8n run-complete webhook.",
        )

        # Notify n8n workflow 4
        import httpx
        from app.config import settings
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(
                    settings.n8n_run_complete_webhook_url,
                    json={
                        "run_id": run_id,
                        "kpi_summary": kpi_summary,
                        "top_segment": top_segment.get("persona_name"),
                        "forecast_accuracy": f"{(1 - best_model.get('mape', 0)) * 100:.1f}%",
                    },
                )
            await emit_event(run_id, "NarratorNode", "n8n_webhook",
                             layer="n8n",
                             reasoning="n8n Workflow 4: run-complete webhook fired → Slack + email notification.")
        except Exception:
            pass  # n8n may not be configured in dev

        from app.db.session import AsyncSessionLocal
        from app.db.models import Run
        async with AsyncSessionLocal() as session:
            run = await session.get(Run, run_id)
            if run:
                run.insight_brief = brief
                # Persist quality metrics so /lineage/{run_id} can return them
                profile = state.profile_report or {}
                outlier_report = profile.get("outlier_report", {})
                run.quality_metrics = {
                    "completeness": round(100.0 - profile.get("missing_pct", 0), 2),
                    "duplicate_rate": round(
                        (profile.get("duplicate_count", 0) / max(profile.get("n_rows", 1), 1)) * 100, 3
                    ),
                    "outlier_count": outlier_report.get("outlier_count", 0),
                    "schema_coverage": profile.get("schema_coverage", 100.0),
                }
                await session.commit()

        new_state = {
            "insight_brief": brief.get("summary") or brief.get("full_text", ""),
            "pdf_key": pdf_key,
            "kpi_summary": kpi_summary,
            "lineage": state.lineage + [{
                "step_order": 8,
                "agent": "NarratorNode",
                "transformation": "Gemini brief generation + WeasyPrint PDF render",
                "rows_in": len(state.segments) + len(state.forecasts),
                "rows_out": 1,
                "duration_ms": latency,
            }],
        }
        await save_checkpoint(run_id, "NarratorNode", new_state)
        return new_state

    except Exception as exc:
        log.error("narrator_failed", run_id=run_id, error=str(exc))
        await emit_event(run_id, "NarratorNode", "error", reasoning=str(exc))
        return {"error": str(exc)}
