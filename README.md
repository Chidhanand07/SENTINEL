# SENTINEL — Autonomous Analytics System
### SOLARIS X Grand Hackathon · RNSIT Luminus Techfest · April 2026

> Three tools, three jobs, one autonomous pipeline.

---

## Quick Start (one command)

```bash
docker compose up -d
```

Services start at:
| Service | URL | Layer |
|---|---|---|
| Dashboard | http://localhost:3000 | Frontend |
| API | http://localhost:8000 | FastAPI |
| n8n | http://localhost:5678 | Workflow automation |
| MLflow | http://localhost:5001 | Experiment tracking |
| MinIO | http://localhost:9001 | Object storage |

**Seed demo data:**
```bash
python scripts/seed.py
```

**Inject live anomaly (demo move):**
```bash
python scripts/inject-anomaly.py <run_id>
```

---

## Architecture

```
Browser → n8n Workflow 1 (upload trigger)
        → FastAPI /run/start
        → LangGraph StateGraph
            ├── SchemaJoinNode (LangChain tools: infer_join_keys, execute_join)
            ├── ProfilerNode   (LangChain tools: profile_dataframe, detect_outliers)
            ├── CleaningNode   (LangChain tools: impute, deduplicate, normalize)
            ├── EDANode        (LangChain tools: correlations, distributions, STL, choropleth)
            ├── SegmentationNode ‖ ForecastNode  ← PARALLEL
            └── NarratorNode   (Gemini LLM → executive brief → WeasyPrint PDF)
        → n8n Workflow 4 (run complete → Slack + email)
```

## Bug Fixes Applied

1. **MLflow port 5001** — macOS AirPlay owns port 5000
2. **n8n entrypoint cleared** — `entrypoint: []` prevents /bin/sh mangling
3. **Frontend → api:8000/n8n/upload** — not n8n:5678 (CORS-safe proxy)
4. **ARM64 g++ in Dockerfile** — required for phik, scipy source builds
5. **WeasyPrint system libs** — cairo + pango injected in apt-get layer
6. **Health checks on all services** — API waits for Postgres + Redis
7. **MinIO bucket init container** — buckets created before first run

## 4-Minute Demo Script

1. **Open** http://localhost:3000
2. **Upload** — drag Olist CSVs onto the upload page → Start Pipeline
3. **Watch** the left pane: n8n (teal) → LangGraph (purple) → LangChain (amber) events stream in
4. **Mermaid DAG** updates live as nodes complete; parallel branch shows Segmentation ‖ Forecasting
5. **Inject constraint** — type "exclude: review_score" in the feedback panel → routed via n8n Workflow 5
6. **Inject anomaly** — `python scripts/inject-anomaly.py <run_id>` → watch alert feed + Slack notification arrive
7. **KPI tab** — revenue forecast chart, Brazil state bar chart
8. **Segments tab** — 4 persona cards with LTV, traits, actions
9. **Forecast tab** — Prophet/SARIMAX/LightGBM comparison, model leaderboard
10. **Insights tab** → Download PDF — hand it to the judge

## Talking Points

> "Three tools, three jobs. n8n handles every external trigger and notification. LangGraph owns the agent state and reasoning flow. LangChain executes every ML and LLM tool. Watch all three layers fire simultaneously in the left pane — color-coded by tool."

> "The human feedback input routes through n8n, into FastAPI, into a LangGraph checkpoint, and the pipeline resumes from exactly the node you paused at."

> "That Slack message just arrived because the AnomalyWatchAgent detected a KS-test p-value of 0.018 on daily revenue, called the n8n webhook, and n8n dispatched the notification. I didn't touch anything."
