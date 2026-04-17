from __future__ import annotations

import json
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Forecast, Run, Segment
from app.db.session import get_db

log = structlog.get_logger()
router = APIRouter()

# Module-level singleton — avoids re-initialising the LLM client on every request
_llm_instance: Any = None

def _get_chat_llm() -> Any:
    global _llm_instance
    if _llm_instance is None:
        from langchain_google_genai import ChatGoogleGenerativeAI
        from app.config import settings
        _llm_instance = ChatGoogleGenerativeAI(
            model=settings.gemini_model,
            google_api_key=settings.google_api_key,
            streaming=True,
            temperature=0.7,
        )
    return _llm_instance


class ChatMessage(BaseModel):
    role: str  # "user" | "model"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []


def _build_system_prompt(run: Run, segments: list[dict], forecasts: list[dict]) -> str:
    schema = run.schema_map or {}
    kpi = run.kpi_summary or {}
    brief = run.insight_brief or {}
    quality = run.quality_metrics or {}

    seg_lines = "\n".join(
        f"  - {s['persona_name']}: {s['size']} customers, avg LTV ${s['avg_ltv']:.0f}"
        for s in segments[:5]
    ) or "  No segments available"

    fc_lines = "\n".join(
        f"  - {f['sku_id']} / {f['state']}: ${f['forecast_value']:,.0f} ({f['horizon_days']}d, MAPE {f['mape']:.1%})"
        for f in forecasts[:5]
    ) or "  No forecasts available"

    actions = "\n".join(
        f"  - {a}" for a in brief.get("recommended_actions", [])
    ) or "  None yet"

    row_count = schema.get("row_count", "unknown")
    row_count_str = f"{row_count:,}" if isinstance(row_count, int) else str(row_count)

    return f"""You are SENTINEL, an AI analytics assistant embedded in a business intelligence dashboard.
You have full access to a cleaned and processed dataset. Answer questions accurately and concisely.
Always use the specific numbers provided below — do not make up values.

=== DATASET OVERVIEW ===
Date column: {schema.get('date_col', 'unknown')}
Revenue column: {schema.get('revenue_col', 'unknown')}
Customer column: {schema.get('customer_col', 'unknown')}
Product column: {schema.get('product_col', 'unknown')}
Geography column: {schema.get('geo_col', 'unknown')}
Total rows: {row_count_str}

=== DATA QUALITY ===
Completeness: {quality.get('completeness', 'unknown')}%
Duplicate rate: {quality.get('duplicate_rate', 'unknown')}%
Outliers detected: {quality.get('outlier_count', 'unknown')}
Schema coverage: {quality.get('schema_coverage', 'unknown')}%

=== KPI SUMMARY ===
30-Day Forecast Revenue: ${kpi.get('total_forecast_revenue_30d', 0):,.2f}
Top Customer Segment: {kpi.get('top_segment', 'unknown')} ({kpi.get('top_segment_size', 0):,} customers)
Best Model: {kpi.get('best_model', 'unknown')} (accuracy: {(1 - kpi.get('best_mape', 0)) * 100:.1f}%)
Anomalies Detected: {kpi.get('anomaly_count', 0)}
Number of Segments: {kpi.get('num_segments', 0)}
Number of Forecasts: {kpi.get('num_forecasts', 0)}

=== CUSTOMER SEGMENTS ===
{seg_lines}

=== TOP FORECASTS (30-day horizon) ===
{fc_lines}

=== EXECUTIVE BRIEF ===
{brief.get('full_text', brief.get('what_we_found', 'Not yet generated.'))}

=== RECOMMENDED ACTIONS ===
{actions}

=== PIPELINE INFO ===
This dataset was processed by SENTINEL's autonomous 3-layer pipeline:
- Layer 1 (n8n): Trigger, upload, notifications
- Layer 2 (LangGraph): Schema detection → Profiling → Cleaning → EDA → Segmentation + Forecasting → Brief
- Layer 3 (LangChain): Gemini 2.5 Flash for brief generation and persona labelling

Answer in clear, business-friendly language. Use specific numbers from the data above.
If asked something outside the dataset scope, say so honestly.
Keep answers concise (2-4 sentences) unless the user asks for more detail."""


async def _stream_gemini(system_prompt: str, history: list[ChatMessage], user_message: str):
    """Async generator: streams Gemini response tokens as SSE data lines.
    Uses langchain_google_genai (same as the rest of the pipeline) to avoid
    any missing-package issues with the raw google.generativeai SDK.
    """
    try:
        from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
        from app.config import settings

        if not settings.google_api_key:
            yield f"data: {json.dumps({'token': 'Gemini API key not configured. Please set GOOGLE_API_KEY in your .env file.'})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
            return

        llm = _get_chat_llm()

        # Build message list: system prompt + conversation history + new user message
        messages: list = [SystemMessage(content=system_prompt)]
        for msg in history:
            if msg.role == "user":
                messages.append(HumanMessage(content=msg.content))
            elif msg.role == "model":
                messages.append(AIMessage(content=msg.content))
        messages.append(HumanMessage(content=user_message))

        # Stream tokens using langchain's async streaming
        async for chunk in llm.astream(messages):
            text = chunk.content if hasattr(chunk, "content") else str(chunk)
            if text:
                yield f"data: {json.dumps({'token': text})}\n\n"

        yield f"data: {json.dumps({'done': True})}\n\n"

    except Exception as exc:
        log.error("chat_gemini_error", error=str(exc))
        error_msg = str(exc)
        # Surface a user-friendly message for common errors
        if "API_KEY" in error_msg.upper() or "api key" in error_msg.lower():
            error_msg = "Gemini API key is invalid or missing."
        elif "quota" in error_msg.lower():
            error_msg = "Gemini API quota exceeded. Try again shortly."
        yield f"data: {json.dumps({'token': f'Sorry, I encountered an error: {error_msg}'})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"


@router.post("/chat/{run_id}")
async def chat(
    run_id: str,
    req: ChatRequest,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Stream a Gemini response grounded in the run's cleaned dataset context."""
    run = await db.get(Run, run_id)
    if not run:
        raise HTTPException(404, "Run not found")

    # Load segments for context
    seg_result = await db.execute(select(Segment).where(Segment.run_id == run_id))
    segments = [
        {"persona_name": s.persona_name, "size": s.size, "avg_ltv": s.avg_ltv}
        for s in seg_result.scalars().all()
    ]

    # Load top 5 forecasts (30-day horizon) for context
    fc_result = await db.execute(
        select(Forecast)
        .where(Forecast.run_id == run_id, Forecast.horizon_days == 30)
        .limit(5)
    )
    forecasts = [
        {
            "sku_id": f.sku_id,
            "state": f.state,
            "forecast_value": f.forecast_value,
            "horizon_days": f.horizon_days,
            "mape": f.mape,
        }
        for f in fc_result.scalars().all()
    ]

    system_prompt = _build_system_prompt(run, segments, forecasts)

    log.info("chat_request", run_id=run_id, message_len=len(req.message), history_turns=len(req.history))

    return StreamingResponse(
        _stream_gemini(system_prompt, req.history, req.message),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
