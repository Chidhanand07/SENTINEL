# Bug Fixes + Chatbot + KPI Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 production bugs (Data Quality always shows demo data, quality metrics never persisted, schema_coverage hardcoded, MAPE type error, silent brief fallback), speed up KPI chart loading, and add an end-to-end Gemini chatbot that lets judges query the cleaned dataset in real time.

**Architecture:** Bugs are isolated file edits. KPI perf is a frontend fetch + backend query optimization. Chatbot adds one new backend router (`api/app/routers/chat.py`) + one new frontend tab (`web/src/components/charts/ChatTab.tsx`) with streaming responses via Gemini's `stream_generate_content`.

**Tech Stack:** FastAPI, SQLAlchemy async, Google Gemini (`google-generativeai`), Next.js 14, React, pandas (for parquet), MinIO (for cleaned data)

---

## File Map

**Modified (bugs + perf):**
- `web/src/components/charts/LineageTab.tsx` — fix API URL, fix response parsing
- `api/app/routers/data.py` — wrap lineage response in `{steps, quality}` shape, include quality from Run
- `api/app/db/models.py` — add `quality_metrics` JSON column to `Run`
- `api/app/agents/nodes/profiler.py` — compute + return `schema_coverage`
- `api/app/agents/nodes/narrator.py` — persist quality_metrics to Run, fix MAPE coercion, add `brief_source` flag
- `web/src/components/charts/InsightsTab.tsx` — show fallback badge when `brief_source === "fallback"`
- `web/src/components/charts/KpiTab.tsx` — AbortController, parallel fetch, early-exit poll

**Created (chatbot):**
- `api/app/routers/chat.py` — POST `/chat/{run_id}`, streaming Gemini response
- `web/src/components/charts/ChatTab.tsx` — full chat UI with streaming bubbles
- `web/src/components/charts/DashboardTabs.tsx` — add Chat tab (modify existing)

---

## Task 1: Fix LineageTab API URL + response parsing

**Files:**
- Modify: `web/src/components/charts/LineageTab.tsx:37`

The frontend calls `/api/lineage/${runId}` (relative URL to Next.js server which has no such route). It also expects `data?.steps?.length > 0` but the current API returns a flat array `[{step_order, agent, ...}]`. Fix the URL AND the response shape check.

- [ ] **Step 1: Open LineageTab.tsx and fix the fetch call and response parsing**

Replace lines 37–44 in `web/src/components/charts/LineageTab.tsx`:

```typescript
// OLD (broken — wrong URL + wrong shape assumption)
fetch(`/api/lineage/${runId}`)
  .then(r => r.ok ? r.json() : null)
  .then(data => {
    if (data?.steps?.length > 0) {
      setLineage(data.steps);
      setQuality(data.quality ?? DEMO_QUALITY);
      setDataSource("live");
    }
  })
  .catch(err => console.warn("[LineageTab] Fetch failed:", err));
```

Replace with:

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
fetch(`${API_URL}/lineage/${runId}`)
  .then(r => r.ok ? r.json() : null)
  .then(data => {
    if (!data) return;
    // API returns { steps: [...], quality: {...} } shape
    const steps = Array.isArray(data.steps) ? data.steps : (Array.isArray(data) ? data : []);
    const qual = data.quality ?? null;
    if (steps.length > 0) {
      setLineage(steps);
      if (qual) setQuality(qual);
      setDataSource("live");
    }
  })
  .catch(err => console.warn("[LineageTab] Fetch failed:", err));
```

Also add `const API_URL = ...` at the top of the component function (after `const schema = ...` line).

- [ ] **Step 2: Verify the fix visually**

After the next Task updates the backend to return `{steps, quality}`, open the Data Quality tab for a completed run and confirm it shows real data (not demo badge).

---

## Task 2: Fix lineage API response shape + include quality metrics

**Files:**
- Modify: `api/app/routers/data.py:59-76`
- Modify: `api/app/db/models.py` — add `quality_metrics` column to `Run`

The lineage endpoint returns `list[dict]` but frontend now expects `{steps: list, quality: dict}`. Also quality metrics (completeness, duplicate_rate, outlier_count, schema_coverage) are never persisted — they're computed in profiler_node but discarded. We'll store them in `Run.quality_metrics` and return them from `/lineage/{run_id}`.

- [ ] **Step 1: Add `quality_metrics` column to the Run model**

In `api/app/db/models.py`, after line 45 (`insight_brief` column):

```python
quality_metrics: Mapped[dict | None] = mapped_column(JSON, nullable=True)
```

The `create_tables()` call in lifespan uses `checkfirst=True` so this column will be added automatically on next startup (SQLite) or requires a manual `ALTER TABLE` for Postgres. For Postgres, after restart run:
```sql
ALTER TABLE runs ADD COLUMN IF NOT EXISTS quality_metrics JSONB;
```

- [ ] **Step 2: Update the lineage endpoint to return `{steps, quality}` shape**

Replace lines 59–76 in `api/app/routers/data.py`:

```python
@router.get("/lineage/{run_id}")
async def get_lineage(run_id: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    # Fetch lineage steps
    result = await db.execute(
        select(Lineage).where(Lineage.run_id == run_id).order_by(Lineage.step_order)
    )
    steps = result.scalars().all()

    # Fetch quality metrics from Run record
    from app.db.models import Run
    run = await db.get(Run, run_id)
    quality = run.quality_metrics if run and run.quality_metrics else None

    log.info("[API] GET /lineage/{run_id}", run_id=run_id, step_count=len(steps))
    return {
        "steps": [
            {
                "step_order": s.step_order,
                "agent": s.agent,
                "transformation": s.transformation,
                "rows_in": s.rows_in,
                "rows_out": s.rows_out,
                "duration_ms": s.duration_ms,
            }
            for s in steps
        ],
        "quality": quality,
    }
```

- [ ] **Step 3: Restart API and verify the endpoint shape**

```bash
curl http://localhost:8000/lineage/<a-real-run-id> | python3 -m json.tool
```

Expected output shape:
```json
{
  "steps": [{ "step_order": 1, "agent": "SchemaJoinNode", ... }],
  "quality": null
}
```

(`quality` is null until Task 3 persists it.)

---

## Task 3: Compute schema_coverage + persist quality metrics

**Files:**
- Modify: `api/app/agents/nodes/profiler.py`
- Modify: `api/app/agents/nodes/narrator.py`

`schema_coverage` = fraction of detected schema columns (date, revenue, customer, product, geo) that were successfully mapped (non-null). Quality metrics need to be written to `Run.quality_metrics` so the lineage endpoint can return them.

- [ ] **Step 1: Compute schema_coverage and enrich profile in profiler_node**

In `api/app/agents/nodes/profiler.py`, after line 53 (`profile["outlier_report"] = outlier_report`), add:

```python
# Compute schema_coverage: fraction of schema slots detected
schema_map = state.schema_map or {}
schema_slots = ["date_col", "revenue_col", "customer_col", "product_col", "geo_col"]
detected = sum(1 for k in schema_slots if schema_map.get(k))
schema_coverage = round((detected / len(schema_slots)) * 100, 1)
profile["schema_coverage"] = schema_coverage
```

- [ ] **Step 2: Persist quality_metrics to Run table in narrator_node**

In `api/app/agents/nodes/narrator.py`, inside the `async with AsyncSessionLocal() as session:` block (currently at lines 134–140), extend it to also write quality_metrics:

```python
from app.db.session import AsyncSessionLocal
from app.db.models import Run
async with AsyncSessionLocal() as session:
    run = await session.get(Run, run_id)
    if run:
        run.insight_brief = brief
        # Persist quality metrics for lineage endpoint
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
```

- [ ] **Step 3: Verify end-to-end**

Run a pipeline with a test CSV. After completion:
```bash
curl http://localhost:8000/lineage/<run_id> | python3 -m json.tool
```

Expected: `quality` key is now populated:
```json
{
  "steps": [...],
  "quality": {
    "completeness": 97.3,
    "duplicate_rate": 0.12,
    "outlier_count": 45,
    "schema_coverage": 80.0
  }
}
```

Open Data Quality tab in UI — confirm real values, not demo values, and no "demo" badge.

---

## Task 4: Fix MAPE TypeError + surface brief fallback to user

**Files:**
- Modify: `api/app/agents/nodes/narrator.py` — coerce MAPE to float, add `brief_source`
- Modify: `web/src/components/charts/InsightsTab.tsx` — show fallback badge

- [ ] **Step 1: Fix MAPE type coercion in narrator.py**

On line 32 of `api/app/agents/nodes/narrator.py`:

```python
# OLD — can fail if mape is a string
best_model = min(state.model_leaderboard, key=lambda x: x.get("mape", 1), default={})
```

Replace with:

```python
best_model = min(
    state.model_leaderboard,
    key=lambda x: float(x.get("mape") or 1),
    default={},
)
```

Also fix line 39 (`"best_mape": best_model.get("mape", 0)`):

```python
"best_mape": float(best_model.get("mape") or 0),
```

- [ ] **Step 2: Add `brief_source` field to brief dict**

In `narrator.py`, change the timeout/fallback block. After line 74 (successful `brief = await asyncio.wait_for(...)`), add:

```python
brief["brief_source"] = "gemini"
```

In the `TimeoutError` handler (line 81, after `brief = _fallback_brief(state_summary)`):

```python
brief["brief_source"] = "fallback"
```

In the generic `Exception` handler (line 85):

```python
brief["brief_source"] = "fallback"
```

Also in `api/app/tools/ml_tools.py`, find `_fallback_brief` and ensure it returns a dict that can accept the new key (just add `"brief_source": "fallback"` to its return dict).

- [ ] **Step 3: Show fallback badge in InsightsTab**

In `web/src/components/charts/InsightsTab.tsx`, find where `brief` is displayed. Add a warning badge when `brief?.brief_source === "fallback"`:

```tsx
{brief?.brief_source === "fallback" && (
  <div className="text-xs px-2 py-1 rounded-md bg-yellow-900/30 text-yellow-400 border border-yellow-800/40 inline-flex items-center gap-1 mb-3">
    <span>⚠</span> AI brief unavailable — showing rule-based summary
  </div>
)}
```

Place this just before the `what_we_found` / `full_text` display block.

---

## Task 5: Fix KPI chart slow loading

**Files:**
- Modify: `web/src/components/charts/KpiTab.tsx`
- Modify: `api/app/routers/data.py` — add `?limit=1` support to forecast endpoint

**Root causes:**
1. `pollKpi` loops every 5–8s — no AbortController, no back-off
2. Forecast fetch returns ALL forecasts (potentially 100s of rows with large `forecast_data` blobs); KpiTab only needs ONE record
3. No early commit of `kpi_summary` to Run table — it only gets written at the very end of narrator_node

- [ ] **Step 1: Add `?first=true` query param to forecast endpoint**

In `api/app/routers/data.py`, update `get_forecasts`:

```python
from fastapi import Query

@router.get("/forecast/{run_id}")
async def get_forecasts(
    run_id: str,
    first: bool = Query(False, description="Return only the first record with forecast_data (for KPI chart)"),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    result = await db.execute(select(Forecast).where(Forecast.run_id == run_id))
    forecasts = result.scalars().all()
    log.info("[API] GET /forecast/{run_id}", run_id=run_id, forecast_count=len(forecasts))

    rows = [
        {
            "sku_id": f.sku_id,
            "state": f.state,
            "horizon_days": f.horizon_days,
            "forecast_value": f.forecast_value,
            "lower_ci": f.lower_ci,
            "upper_ci": f.upper_ci,
            "model_used": f.model_used,
            "mape": f.mape,
            "forecast_data": f.forecast_data,
        }
        for f in forecasts
    ]

    if first:
        # Return only the single best record that has historical time-series data
        with_data = [r for r in rows if r["forecast_data"] and r["forecast_data"].get("historical_dates")]
        return with_data[:1] if with_data else rows[:1]

    return rows
```

- [ ] **Step 2: Rewrite KpiTab useEffect with AbortController + optimised fetch**

Replace the entire `useEffect` in `web/src/components/charts/KpiTab.tsx` (lines 70–115) with:

```typescript
useEffect(() => {
  if (!runId || isDemoRun) {
    if (isDemoRun) {
      setKpiCards(DEMO_KPI_CARDS);
      setForecastData(null);
    }
    return;
  }

  const ctrl = new AbortController();
  const { signal } = ctrl;

  // Fetch KPI cards with adaptive polling (5s → 10s → 15s back-off)
  let attempt = 0;
  const delays = [2000, 5000, 5000, 10000, 10000, 15000];
  const pollKpi = async () => {
    if (signal.aborted) return;
    try {
      const res = await fetch(`${API_URL}/run/${runId}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const cards =
        (Array.isArray(data?.kpi_cards) && data.kpi_cards.length > 0)
          ? data.kpi_cards
          : kpiSummaryToCards(data?.kpi_summary);
      if (cards.length > 0) {
        setKpiCards(cards);
        return; // done — no more polling
      }
      if (data?.status === "completed" || data?.status === "failed") return;
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.warn("[KpiTab] run fetch failed:", err.message);
    }
    const delay = delays[Math.min(attempt++, delays.length - 1)];
    setTimeout(pollKpi, delay);
  };
  pollKpi();

  // Fetch forecast time-series (only first record with historical data)
  fetch(`${API_URL}/forecast/${runId}?first=true`, { signal })
    .then(async (res) => {
      if (!res.ok || signal.aborted) return;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setForecastData(data[0]?.forecast_data ?? null);
      }
    })
    .catch((err) => {
      if (err.name !== "AbortError") console.warn("[KpiTab] forecast fetch failed:", err.message);
    });

  return () => ctrl.abort();
}, [runId, isDemoRun]);
```

- [ ] **Step 3: Persist kpi_summary early in narrator_node**

Currently kpi_summary is only persisted to DB once, at the end of narrator (after PDF render + MinIO upload). Move the DB write earlier — right after `kpi_summary` is computed (after line 43 in narrator.py) so polling picks it up sooner:

```python
# Early persist kpi_summary so frontend polling gets cards ASAP
from app.db.session import AsyncSessionLocal as _ASL
from app.db.models import Run as _Run
async with _ASL() as _s:
    _run = await _s.get(_Run, run_id)
    if _run:
        _run.kpi_summary = kpi_summary
        await _s.commit()
```

Place this block right after `kpi_summary = { ... }` dict definition (after line 43), before the `emit_event` call for the brief.

---

## Task 6: Chatbot backend — POST `/chat/{run_id}` with Gemini

**Files:**
- Create: `api/app/routers/chat.py`
- Modify: `api/app/main.py` — register the router

The chatbot loads the run's context (schema, KPIs, segments, top forecasts, brief) from DB, builds a system prompt that describes the cleaned dataset, then calls Gemini with the user message + chat history. Response is streamed back as `text/event-stream`.

- [ ] **Step 1: Create `api/app/routers/chat.py`**

```python
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


class ChatMessage(BaseModel):
    role: str  # "user" | "model"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []


def _build_system_prompt(run: Run, segments: list, forecasts: list) -> str:
    schema = run.schema_map or {}
    kpi = run.kpi_summary or {}
    brief = run.insight_brief or {}

    seg_lines = "\n".join(
        f"  - {s['persona_name']}: {s['size']} customers, avg LTV ${s['avg_ltv']:.0f}"
        for s in segments[:5]
    )
    fc_lines = "\n".join(
        f"  - {f['sku_id']} / {f['state']}: ${f['forecast_value']:,.0f} ({f['horizon_days']}d, MAPE {f['mape']:.1%})"
        for f in forecasts[:5]
    )

    return f"""You are SENTINEL, an AI analytics assistant for a business intelligence dashboard.
You have access to a cleaned and processed dataset. Answer questions about it concisely and accurately.

=== DATASET OVERVIEW ===
Date column: {schema.get('date_col', 'unknown')}
Revenue column: {schema.get('revenue_col', 'unknown')}
Customer column: {schema.get('customer_col', 'unknown')}
Product column: {schema.get('product_col', 'unknown')}
Geography column: {schema.get('geo_col', 'unknown')}
Row count: {schema.get('row_count', 'unknown'):,}

=== KPI SUMMARY ===
30-Day Forecast Revenue: ${kpi.get('total_forecast_revenue_30d', 0):,.2f}
Customer Segments: {kpi.get('num_segments', 0)}
Best Model Accuracy: {(1 - kpi.get('best_mape', 0)) * 100:.1f}%
Anomalies Detected: {kpi.get('anomaly_count', 0)}

=== CUSTOMER SEGMENTS ===
{seg_lines if seg_lines else "  No segments available"}

=== TOP FORECASTS ===
{fc_lines if fc_lines else "  No forecasts available"}

=== EXECUTIVE BRIEF ===
{brief.get('full_text', brief.get('what_we_found', 'Not yet generated.'))}

=== RECOMMENDED ACTIONS ===
{chr(10).join(f'  - {a}' for a in brief.get('recommended_actions', []))}

Answer in clear, business-friendly language. If asked about specific numbers, use the data above.
If asked something outside the dataset scope, say so honestly.
Keep answers concise (2-4 sentences) unless the user asks for detail."""


async def _stream_gemini(system_prompt: str, history: list[ChatMessage], user_message: str):
    """Generator that streams Gemini response tokens as SSE."""
    try:
        import google.generativeai as genai
        from app.config import settings

        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel(
            model_name="gemini-2.0-flash",
            system_instruction=system_prompt,
        )

        # Build Gemini history format
        gemini_history = [
            {"role": msg.role, "parts": [msg.content]}
            for msg in history
        ]

        chat = model.start_chat(history=gemini_history)
        response = chat.send_message(user_message, stream=True)

        for chunk in response:
            text = chunk.text if hasattr(chunk, "text") else ""
            if text:
                yield f"data: {json.dumps({'token': text})}\n\n"

        yield f"data: {json.dumps({'done': True})}\n\n"

    except Exception as exc:
        log.error("chat_gemini_error", error=str(exc))
        yield f"data: {json.dumps({'error': str(exc)})}\n\n"


@router.post("/chat/{run_id}")
async def chat(
    run_id: str,
    req: ChatRequest,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    run = await db.get(Run, run_id)
    if not run:
        raise HTTPException(404, "Run not found")

    # Load segments + top forecasts for context
    seg_result = await db.execute(select(Segment).where(Segment.run_id == run_id))
    segments = [
        {"persona_name": s.persona_name, "size": s.size, "avg_ltv": s.avg_ltv}
        for s in seg_result.scalars().all()
    ]

    fc_result = await db.execute(
        select(Forecast)
        .where(Forecast.run_id == run_id, Forecast.horizon_days == 30)
        .limit(5)
    )
    forecasts = [
        {"sku_id": f.sku_id, "state": f.state, "forecast_value": f.forecast_value,
         "horizon_days": f.horizon_days, "mape": f.mape}
        for f in fc_result.scalars().all()
    ]

    system_prompt = _build_system_prompt(run, segments, forecasts)

    return StreamingResponse(
        _stream_gemini(system_prompt, req.history, req.message),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

- [ ] **Step 2: Register the chat router in main.py**

In `api/app/main.py`, after the existing router imports (line 44):

```python
from app.routers import pipeline, n8n_proxy, data, report, manifest, chat  # noqa: E402
```

And after existing `app.include_router(report.router, ...)` line:

```python
app.include_router(chat.router, tags=["chat"])
```

- [ ] **Step 3: Verify the endpoint exists**

```bash
curl -X POST http://localhost:8000/chat/<run_id> \
  -H "Content-Type: application/json" \
  -d '{"message": "What are the top customer segments?", "history": []}' \
  --no-buffer
```

Expected: SSE stream of `data: {"token": "Based on..."}` lines, ending with `data: {"done": true}`.

---

## Task 7: Chatbot frontend — ChatTab.tsx

**Files:**
- Create: `web/src/components/charts/ChatTab.tsx`
- Modify: `web/src/components/charts/DashboardTabs.tsx` — add Chat tab

- [ ] **Step 1: Create `web/src/components/charts/ChatTab.tsx`**

```tsx
"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import { Send, Bot, User, Sparkles } from "lucide-react";
import { RunManifest } from "@/lib/manifest";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Message {
  role: "user" | "model";
  content: string;
  streaming?: boolean;
}

const SUGGESTED = [
  "What are the top customer segments?",
  "Which SKU has the best forecast accuracy?",
  "What actions should I take based on this data?",
  "Summarise the executive brief for me.",
];

export function ChatTab({ runId, manifest }: { runId: string; manifest: RunManifest | null }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "model",
      content: "Hi! I'm SENTINEL, your AI analytics assistant. Ask me anything about your cleaned dataset — segments, forecasts, KPIs, or recommended actions.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: Message = { role: "user", content: text };
    const history = messages.filter(m => !m.streaming).map(m => ({ role: m.role, content: m.content }));

    setMessages(prev => [...prev, userMsg, { role: "model", content: "", streaming: true }]);
    setInput("");
    setIsStreaming(true);

    abortRef.current = new AbortController();

    try {
      const res = await fetch(`${API_URL}/chat/${runId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.token) {
              accumulated += payload.token;
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: "model", content: accumulated, streaming: true };
                return next;
              });
            }
            if (payload.done || payload.error) break;
          } catch {}
        }
      }

      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: "model", content: accumulated, streaming: false };
        return next;
      });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "model",
          content: "Sorry, I encountered an error. Please try again.",
          streaming: false,
        };
        return next;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="flex flex-col h-full" style={{ minHeight: "500px" }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
        <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-accent" />
        </div>
        <div>
          <p className="text-xs font-bold text-subtle uppercase tracking-wider">SENTINEL Chat</p>
          <p className="text-xs text-muted">Powered by Gemini · Querying your cleaned dataset</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-muted">Live</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto space-y-4 pr-1 mb-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
              msg.role === "user" ? "bg-accent/20" : "bg-surface border border-border"
            }`}>
              {msg.role === "user"
                ? <User className="w-3 h-3 text-accent" />
                : <Bot className="w-3 h-3 text-muted" />
              }
            </div>
            <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
              msg.role === "user"
                ? "bg-accent/10 text-subtle border border-accent/20"
                : "bg-surface border border-border text-muted"
            }`}>
              {msg.content || (msg.streaming ? (
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              ) : "")}
              {msg.streaming && msg.content && (
                <span className="inline-block w-0.5 h-3.5 bg-accent ml-0.5 animate-pulse align-middle" />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Suggested questions (only on first message) */}
      {messages.length === 1 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {SUGGESTED.map((q, i) => (
            <button
              key={i}
              onClick={() => sendMessage(q)}
              disabled={isStreaming}
              className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted hover:text-subtle hover:border-accent/30 transition-colors disabled:opacity-40"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={isStreaming}
          placeholder="Ask about your data..."
          className="flex-1 text-sm px-4 py-2.5 bg-surface border border-border rounded-xl text-subtle placeholder:text-muted focus:outline-none focus:border-accent/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className="px-4 py-2.5 rounded-xl bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Add Chat tab to DashboardTabs.tsx**

In `web/src/components/charts/DashboardTabs.tsx`:

1. Add import at top (after existing chart imports):
```typescript
import { ChatTab } from "./ChatTab";
```

2. Add tab to `ALL_TABS` array (add after the `insights` entry):
```typescript
{ id: "chat", label: "Chat" },
```

3. In the `availableTabs` filter logic, make chat always visible (like kpi/lineage/insights):
```typescript
if (tab.id === "kpi" || tab.id === "lineage" || tab.id === "insights" || tab.id === "chat") return true;
```

4. In the Content section (after `insights` line):
```tsx
{active === "chat"     && <ChatTab     runId={runId} manifest={activeManifest} />}
```

- [ ] **Step 3: Verify chatbot works end to end**

1. Start a run, wait for completion
2. Click the "Chat" tab
3. Click "What are the top customer segments?"
4. Verify: streaming response appears token-by-token, final message shows segment names from the actual run data
5. Send a follow-up: "What's the 30-day revenue forecast?"
6. Verify: Gemini uses the actual `total_forecast_revenue_30d` from kpi_summary

---

## Self-Review

### Spec Coverage Check

| Requirement | Task |
|---|---|
| Fix LineageTab API URL (CRITICAL) | Task 1 |
| Fix lineage response shape | Task 2 |
| Compute + persist schema_coverage | Task 3 |
| Persist quality_metrics to DB | Task 3 |
| Fix MAPE TypeError | Task 4 |
| Surface brief fallback to user | Task 4 |
| KPI chart slow loading | Task 5 |
| Chatbot backend | Task 6 |
| Chatbot frontend | Task 7 |

All 9 requirements covered. ✓

### Placeholder Check

All code blocks are complete. No TBD/TODO in implementation code. ✓

### Type Consistency Check

- `ChatMessage` used identically in `chat.py` Pydantic model and `ChatTab.tsx` interface ✓
- `{steps: [...], quality: {...}}` shape consistent between `data.py` response and `LineageTab.tsx` parser ✓
- `quality_metrics` dict keys (`completeness`, `duplicate_rate`, `outlier_count`, `schema_coverage`) consistent with `QualityMetrics` interface in `LineageTab.tsx` ✓
- `brief_source` field added to both Gemini and fallback paths ✓
