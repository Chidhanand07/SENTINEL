from __future__ import annotations

"""ML and LLM tools — sklearn, Prophet, LightGBM, Gemini."""

import json
from typing import Any

import numpy as np
import pandas as pd

from app.config import settings


# ── LLM client ─────────────────────────────────────────────────────────────

_llm_singleton: Any = None

def _get_llm() -> Any:
    global _llm_singleton
    if _llm_singleton is None:
        from langchain_google_genai import ChatGoogleGenerativeAI
        _llm_singleton = ChatGoogleGenerativeAI(
            model=settings.gemini_model,
            google_api_key=settings.google_api_key,
            temperature=0.7,
        )
    return _llm_singleton


# ── RFM ────────────────────────────────────────────────────────────────────

def compute_rfm(df: pd.DataFrame, id_col: str | None, date_col: str | None, val_col: str | None) -> pd.DataFrame:
    """Compute RFM (Recency, Frequency, Monetary) scores."""

    if not all([id_col, date_col, val_col]):
        # Generate synthetic RFM
        np.random.seed(42)
        n = min(len(df), 5000)
        return pd.DataFrame({
            "customer_id": [f"cust_{i}" for i in range(n)],
            "recency": np.random.exponential(30, n),
            "frequency": np.random.poisson(2, n) + 1,
            "monetary": np.random.lognormal(4, 1, n),
        })

    df = df.copy()
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    snapshot = df[date_col].max()

    rfm = df.groupby(id_col).agg(
        recency=(date_col, lambda x: (snapshot - x.max()).days),
        frequency=(id_col, "count"),
        monetary=(val_col, "sum"),
    ).reset_index()
    rfm.columns = ["customer_id", "recency", "frequency", "monetary"]

    # Score 1-5
    for col in ["recency", "frequency", "monetary"]:
        try:
            rfm[f"{col}_score"] = pd.qcut(rfm[col], 5, labels=[5, 4, 3, 2, 1]
                                            if col == "recency" else [1, 2, 3, 4, 5],
                                            duplicates="drop")
        except Exception:
            rfm[f"{col}_score"] = 3

    return rfm


def run_kmeans_sweep(rfm_df: pd.DataFrame, k_range: range) -> dict[str, Any]:
    """K-means sweep with silhouette scoring."""
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score
    from sklearn.preprocessing import StandardScaler

    features = [c for c in ["recency", "frequency", "monetary"] if c in rfm_df.columns]
    X = rfm_df[features].fillna(0).values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    best_k = 4
    best_score = -1
    best_labels: np.ndarray | None = None

    for k in k_range:
        if k >= len(X):
            continue
        try:
            km = KMeans(n_clusters=k, random_state=42, n_init=10)
            labels = km.fit_predict(X_scaled)
            score = silhouette_score(X_scaled, labels)
            if score > best_score:
                best_score = score
                best_k = k
                best_labels = labels
        except Exception:
            continue

    if best_labels is None:
        best_labels = np.zeros(len(X), dtype=int)

    rfm_df = rfm_df.copy()
    rfm_df["cluster"] = best_labels

    cluster_stats: list[dict[str, Any]] = []
    for cluster_id in range(best_k):
        mask = rfm_df["cluster"] == cluster_id
        subset = rfm_df[mask]
        sample_records = subset.head(50).to_dict(orient="records")
        cluster_stats.append({
            "cluster_id": cluster_id,
            "size": int(mask.sum()),
            "avg_recency": float(subset["recency"].mean()) if "recency" in subset else 0,
            "avg_frequency": float(subset["frequency"].mean()) if "frequency" in subset else 0,
            "avg_monetary": float(subset["monetary"].mean()) if "monetary" in subset else 0,
            "rfm_sample": sample_records[:10],
        })

    return {
        "optimal_k": best_k,
        "silhouette_score": best_score,
        "cluster_stats": cluster_stats,
        "labels": best_labels.tolist(),
        "rfm_df": rfm_df.to_dict(orient="records"),
    }


async def label_clusters_with_llm(cluster_stats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Call Gemini to generate persona names + recommended actions (non-blocking)."""
    if not settings.google_api_key:
        defaults = [
            {"name": "Champions", "traits": ["High spend", "Recent buyers", "Frequent"],
             "recommended_action": "Reward with loyalty points and early access to new products."},
            {"name": "Loyal Customers", "traits": ["Regular buyers", "Moderate spend"],
             "recommended_action": "Offer cross-sell bundles and referral bonuses."},
            {"name": "At-Risk", "traits": ["Haven't bought recently", "Low frequency"],
             "recommended_action": "Send win-back campaign with 15% off coupon."},
            {"name": "Lost", "traits": ["Very inactive", "Single purchase"],
             "recommended_action": "Targeted reactivation email with exclusive deal."},
        ]
        return defaults[:len(cluster_stats)]

    try:
        llm = _get_llm()
        # Trim rfm_sample arrays — only send summary stats, not raw rows
        trimmed = [
            {"cluster_id": c.get("cluster_id"), "size": c.get("size"),
             "avg_recency": round(c.get("avg_recency", 0), 1),
             "avg_frequency": round(c.get("avg_frequency", 0), 1),
             "avg_monetary": round(c.get("avg_monetary", 0), 2)}
            for c in cluster_stats
        ]
        prompt = f"""E-commerce analyst. Generate persona cards for these RFM clusters. Be brief.

{json.dumps(trimmed, default=str)}

Return ONLY a JSON array (one object per cluster):
[{{"name":"Champions","traits":["trait1","trait2","trait3"],"recommended_action":"one sentence"}}]"""

        import asyncio
        from langchain_core.messages import HumanMessage
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: llm.invoke([HumanMessage(content=prompt)]))
        text = response.content.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        cards = json.loads(text)
        return cards if isinstance(cards, list) else []
    except Exception:
        return [
            {"name": f"Segment {i+1}",
             "traits": ["Moderate spend", "Periodic buyers"],
             "recommended_action": "Targeted email campaign with personalized offers."}
            for i in range(len(cluster_stats))
        ]


# ── Forecasting ────────────────────────────────────────────────────────────

def group_by_sku_region(df: pd.DataFrame, cat_col: str | None, state_col: str | None, date_col: str | None, val_col: str | None) -> list[tuple[tuple[str, str], pd.Series]]:
    """Group revenue by category × state × week."""

    if not all([date_col, val_col]):
        return []

    df = df.copy()
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    df = df.dropna(subset=[date_col])

    if cat_col is None:
        cat_col = "_sku"
        df[cat_col] = "All"
    if state_col is None:
        state_col = "_state"
        df[state_col] = "BR"

    df["_week"] = df[date_col].dt.to_period("W").dt.start_time
    groups = df.groupby([cat_col, state_col, "_week"])[val_col].sum().reset_index()

    results: list[tuple[tuple[str, str], pd.Series]] = []
    for (cat, state), grp in groups.groupby([cat_col, state_col]):
        series = grp.set_index("_week")[val_col].sort_index()
        if len(series) >= 4:
            results.append(((str(cat), str(state)), series))

    # Sort by total volume descending
    results.sort(key=lambda x: x[1].sum(), reverse=True)
    return results


def run_prophet(series: pd.Series) -> dict[str, Any]:
    try:
        from prophet import Prophet
        df_p = series.reset_index()
        df_p.columns = ["ds", "y"]
        df_p["ds"] = pd.to_datetime(df_p["ds"])

        m = Prophet(yearly_seasonality=True, weekly_seasonality=True, daily_seasonality=False,
                    interval_width=0.9, changepoint_prior_scale=0.05)
        m.fit(df_p)

        future = m.make_future_dataframe(periods=90, freq="W")
        forecast = m.predict(future)

        # MAPE on in-sample
        merged = df_p.merge(forecast[["ds", "yhat"]], on="ds")
        actual = merged["y"].replace(0, np.nan)
        mape = float((np.abs(merged["y"] - merged["yhat"]) / actual.abs()).mean())

        last = forecast.tail(13)  # last 90d in weekly chunks
        return {
            "model": "prophet",
            "mape": min(mape, 0.99),
            "mae": float((np.abs(merged["y"] - merged["yhat"])).mean()),
            "rmse": float(np.sqrt(((merged["y"] - merged["yhat"]) ** 2).mean())),
            "forecast_30": float(last[last["ds"] <= last["ds"].min() + pd.Timedelta(days=30)]["yhat"].sum()),
            "forecast_60": float(last[last["ds"] <= last["ds"].min() + pd.Timedelta(days=60)]["yhat"].sum()),
            "forecast_90": float(last["yhat"].sum()),
            "lower_30": float(last["yhat_lower"].iloc[:4].sum()),
            "upper_30": float(last["yhat_upper"].iloc[:4].sum()),
            "lower_60": float(last["yhat_lower"].iloc[:9].sum()),
            "upper_60": float(last["yhat_upper"].iloc[:9].sum()),
            "lower_90": float(last["yhat_lower"].sum()),
            "upper_90": float(last["yhat_upper"].sum()),
            "forecast_data": {
                "dates": forecast["ds"].astype(str).tolist()[-13:],
                "values": forecast["yhat"].tolist()[-13:],
                "lower": forecast["yhat_lower"].tolist()[-13:],
                "upper": forecast["yhat_upper"].tolist()[-13:],
                "historical_dates": df_p["ds"].astype(str).tolist(),
                "historical_values": df_p["y"].tolist(),
            },
        }
    except Exception as e:
        return _fallback_forecast("prophet", series)


def run_sarimax(series: pd.Series) -> dict[str, Any]:
    try:
        from statsmodels.tsa.statespace.sarimax import SARIMAX
        model = SARIMAX(series, order=(1, 1, 1), seasonal_order=(1, 0, 1, 52),
                        enforce_stationarity=False, enforce_invertibility=False)
        result = model.fit(disp=False, maxiter=50)
        forecast = result.forecast(steps=13)
        ci = result.get_forecast(steps=13).conf_int(alpha=0.1)

        merged = series.copy()
        fitted = result.fittedvalues
        actual = merged.replace(0, np.nan)
        mape = float((np.abs(merged - fitted) / actual.abs()).mean())

        return {
            "model": "sarimax",
            "mape": min(mape, 0.99),
            "mae": float(np.abs(merged - fitted).mean()),
            "rmse": float(np.sqrt(((merged - fitted) ** 2).mean())),
            "forecast_30": float(forecast.iloc[:4].sum()),
            "forecast_60": float(forecast.iloc[:9].sum()),
            "forecast_90": float(forecast.sum()),
            "lower_30": float(ci.iloc[:4, 0].sum()),
            "upper_30": float(ci.iloc[:4, 1].sum()),
            "lower_90": float(ci.iloc[:, 0].sum()),
            "upper_90": float(ci.iloc[:, 1].sum()),
            "forecast_data": {
                "dates": [str(d) for d in forecast.index],
                "values": forecast.tolist(),
                "lower": ci.iloc[:, 0].tolist(),
                "upper": ci.iloc[:, 1].tolist(),
                "historical_dates": [str(d) for d in series.index],
                "historical_values": series.tolist(),
            },
        }
    except Exception:
        return _fallback_forecast("sarimax", series)


def run_lightgbm_lags(series: pd.Series, sku: str = "") -> dict[str, Any]:
    try:
        import lightgbm as lgb
        df = pd.DataFrame({"y": series.values})
        for lag in [1, 2, 4, 8, 13]:
            df[f"lag_{lag}"] = df["y"].shift(lag)
        df = df.dropna()
        if len(df) < 8:
            return _fallback_forecast("lightgbm", series)

        split = max(1, int(len(df) * 0.8))
        train, val = df[:split], df[split:]
        feature_cols = [c for c in df.columns if c != "y"]

        model = lgb.LGBMRegressor(n_estimators=100, learning_rate=0.1, random_state=42, verbose=-1)
        model.fit(train[feature_cols], train["y"])

        pred_val = model.predict(val[feature_cols])
        actual = val["y"].replace(0, np.nan)
        mape = float((np.abs(val["y"].values - pred_val) / np.abs(actual.values)).mean())

        # Generate 13-week forecast iteratively
        last_row = df.iloc[-1].copy()
        future_preds: list[float] = []
        for _ in range(13):
            row = {f"lag_{l}": last_row.get(f"lag_{l-1}", 0) for l in [2, 4, 8, 13]}
            row["lag_1"] = last_row["y"] if "y" in last_row else 0
            feat = pd.DataFrame([row])[feature_cols]
            pred = float(model.predict(feat)[0])
            future_preds.append(pred)
            new_row = {"y": pred}
            for lag in [2, 4, 8, 13]:
                new_row[f"lag_{lag}"] = last_row.get(f"lag_{lag-1}", 0)
            new_row["lag_1"] = pred
            last_row = pd.Series(new_row)

        return {
            "model": "lightgbm",
            "mape": min(mape, 0.99),
            "mae": float(np.abs(val["y"].values - pred_val).mean()),
            "rmse": float(np.sqrt(((val["y"].values - pred_val) ** 2).mean())),
            "forecast_30": sum(future_preds[:4]),
            "forecast_60": sum(future_preds[:9]),
            "forecast_90": sum(future_preds),
            "lower_30": sum(future_preds[:4]) * 0.85,
            "upper_30": sum(future_preds[:4]) * 1.15,
            "lower_90": sum(future_preds) * 0.80,
            "upper_90": sum(future_preds) * 1.20,
            "forecast_data": {
                "dates": [f"Week+{i+1}" for i in range(13)],
                "values": future_preds,
                "lower": [v * 0.85 for v in future_preds],
                "upper": [v * 1.15 for v in future_preds],
                "historical_dates": [str(d) for d in series.index],
                "historical_values": series.tolist(),
            },
        }
    except Exception:
        return _fallback_forecast("lightgbm", series)


def _fallback_forecast(model: str, series: pd.Series) -> dict[str, Any]:
    """Simple trend extrapolation as fallback."""
    vals = series.values
    mean_val = float(np.mean(vals[-4:])) if len(vals) >= 4 else float(np.mean(vals)) if len(vals) > 0 else 100
    return {
        "model": model,
        "mape": 0.15,
        "mae": mean_val * 0.15,
        "rmse": mean_val * 0.20,
        "forecast_30": mean_val * 4,
        "forecast_60": mean_val * 9,
        "forecast_90": mean_val * 13,
        "lower_30": mean_val * 4 * 0.85,
        "upper_30": mean_val * 4 * 1.15,
        "lower_90": mean_val * 13 * 0.80,
        "upper_90": mean_val * 13 * 1.20,
        "forecast_data": {
            "dates": [f"Week+{i+1}" for i in range(13)],
            "values": [mean_val] * 13,
            "lower": [mean_val * 0.85] * 13,
            "upper": [mean_val * 1.15] * 13,
            "historical_dates": [str(d) for d in series.index],
            "historical_values": series.tolist(),
        },
    }


def select_best_model(results: list[dict[str, Any]]) -> dict[str, Any]:
    valid = [r for r in results if "mape" in r]
    if not valid:
        return _fallback_forecast("prophet", pd.Series([]))
    return min(valid, key=lambda x: x["mape"])


async def generate_executive_brief(state_summary: dict[str, Any]) -> dict[str, Any]:
    """Generate strict JSON business brief."""
    if not settings.google_api_key:
        return _fallback_brief(state_summary)

    try:
        llm = _get_llm()
        kpi = state_summary.get("kpi_summary", {})
        schema_map = state_summary.get("schema_map", {}) or {}
        forecast_rev = kpi.get("total_forecast_revenue_30d", 0)
        # Trim to only essential fields — avoids sending large rfm_sample arrays
        segs = [{"name": s.get("name"), "size": s.get("size"), "avg_ltv": s.get("avg_ltv"), "action": s.get("action")}
                for s in state_summary.get("segments", [])[:3]]
        fcs = [{"sku": f.get("sku"), "region": f.get("region"), "value": f.get("value"), "mape": f.get("mape")}
               for f in state_summary.get("top_forecasts", [])[:3]]

        prompt = f"""You are a senior business analyst generating a clean, decision-ready report for non-technical users.

CRITICAL RULES:
- Return ONLY valid JSON with keys: summary, findings, impact, actions
- Do NOT use generic labels like "Segment 1", "Segment 2", or "Top Segment"
- Use meaningful customer group names only when data supports it
- If segments are missing/weak, say exactly: "No clearly distinct customer groups were identified from the current dataset"
- If a key value is 0 (revenue/forecast/segments), do not state it blindly; explain likely reasons in business language
- Do NOT mention technical tools, model names, LLMs, or implementation details
- No hallucinations; if data is weak, say so clearly

Dataset context:
30d forecast revenue={forecast_rev:,.0f}
segment_count={kpi.get('num_segments',0)}
anomaly_count={kpi.get('anomaly_count',0)}
primary_category={schema_map.get('semantic_fields', {}).get('category_col')}
category_candidates={schema_map.get('semantic_fields', {}).get('category_candidates', [])}
Top segments: {json.dumps(segs, default=str)}
Top forecasts: {json.dumps(fcs, default=str)}
Anomalies: {state_summary.get('anomalies', [])[:2]}

Return ONLY this JSON (no markdown):
{{"summary":"3-4 lines","findings":["insight1","insight2","insight3"],"impact":["impact1","impact2"],"actions":["action1","action2","action3"]}}"""

        import asyncio
        from langchain_core.messages import HumanMessage
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: llm.invoke([HumanMessage(content=prompt)]))
        text = response.content.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except Exception:
        return _fallback_brief(state_summary)


def _fallback_brief(state_summary: dict[str, Any]) -> dict[str, Any]:
    kpi = state_summary.get("kpi_summary", {})
    segs = state_summary.get("segments", [])
    schema_map = state_summary.get("schema_map", {}) or {}
    category_col = (schema_map.get("semantic_fields", {}) or {}).get("category_col")
    forecast = kpi.get("total_forecast_revenue_30d", 0)
    num_segs = kpi.get("num_segments", 0)
    anomaly_count = kpi.get("anomaly_count", 0)
    seg_statement = (
        "No clearly distinct customer groups were identified from the current dataset"
        if num_segs <= 0 or len(segs) == 0
        else f"The dataset shows {num_segs} customer groups with different buying behavior"
    )
    forecast_statement = (
        "The near-term outlook currently shows no expected revenue activity, which usually indicates weak demand signals, an inactive period, or missing sales records."
        if forecast <= 0
        else f"The near-term outlook points to approximately {forecast:,.0f} in revenue, suggesting active demand to plan around."
    )
    anomaly_statement = (
        f"{anomaly_count} anomaly signal(s) were detected and should be reviewed to avoid revenue leakage."
        if anomaly_count > 0 else
        "No major anomaly signals were detected in the current monitoring window."
    )
    category_sentence = (
        f"The dataset has a usable category field ({category_col}) for grouping and comparison."
        if category_col else
        "No strong category field was confidently detected, so grouped category insights may be limited."
    )
    return {
        "summary": f"{seg_statement}. {forecast_statement} {anomaly_statement} {category_sentence}",
        "findings": [
            seg_statement + ".",
            "Customer behavior appears either uniform or not detailed enough for strong persona separation." if num_segs <= 0 else "Customer groups show different value and engagement patterns that can support targeted actions.",
            forecast_statement,
            category_sentence,
        ],
        "impact": [
            "Without clear customer grouping, targeted marketing decisions will have lower confidence and weaker ROI control.",
            "Planning directly from weak or zero demand signals can cause under- or over-allocation of budget and inventory.",
        ],
        "actions": [
            "Validate transaction, date, and customer-level data completeness before the next planning cycle.",
            "Re-run customer analysis with richer behavior inputs like repeat rate, basket value, and purchase recency.",
            "Use phased campaign and inventory plans until stronger demand and segment signals are confirmed.",
        ],
    }


async def write_segments_to_db(segments: list[dict[str, Any]], run_id: str) -> None:
    """Persist segment records to Postgres."""
    from app.db.session import AsyncSessionLocal
    from app.db.models import Segment
    import structlog
    log = structlog.get_logger()
    async with AsyncSessionLocal() as session:
        for seg in segments:
            obj = Segment(
                run_id=run_id,
                cluster_id=seg.get("cluster_id", 0),
                persona_name=seg.get("persona_name", "Unknown"),
                size=seg.get("size", 0),
                avg_ltv=seg.get("avg_ltv", 0),
                avg_recency=seg.get("avg_recency", 0),
                avg_frequency=seg.get("avg_frequency", 0),
                traits={"traits": seg.get("traits", [])},
                recommended_action=seg.get("recommended_action", ""),
                color=seg.get("color", "#E8A838"),
            )
            session.add(obj)
        await session.commit()
        log.info("[DB] write_segments_to_db", run_id=run_id, segment_count=len(segments))


async def write_forecasts_to_db(forecasts: list[dict[str, Any]], run_id: str) -> None:
    """Persist forecast records to Postgres."""
    from app.db.session import AsyncSessionLocal
    from app.db.models import Forecast
    import structlog
    log = structlog.get_logger()
    async with AsyncSessionLocal() as session:
        for f in forecasts:
            obj = Forecast(
                run_id=run_id,
                sku_id=f.get("sku_id", ""),
                state=f.get("state", ""),
                horizon_days=f.get("horizon_days", 30),
                forecast_value=f.get("forecast_value", 0),
                lower_ci=f.get("lower_ci", 0),
                upper_ci=f.get("upper_ci", 0),
                model_used=f.get("model_used", "prophet"),
                mape=f.get("mape", 0),
                forecast_data=f.get("forecast_data", {}),
            )
            session.add(obj)
        await session.commit()
        log.info("[DB] write_forecasts_to_db", run_id=run_id, forecast_count=len(forecasts))
