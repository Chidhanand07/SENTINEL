from __future__ import annotations

"""EDA tools — generate chart artifacts and upload to MinIO."""

import io
from typing import Any

import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from plotly.graph_objects import Figure
from minio import Minio

from app.config import settings


DARK_TEMPLATE = "plotly_dark"
AMBER = "#E8A838"
TEAL = "#0EA5E9"
PURPLE = "#7C3AED"

BRAZIL_STATES = {
    "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas",
    "BA": "Bahia", "CE": "Ceará", "DF": "Distrito Federal",
    "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão",
    "MT": "Mato Grosso", "MS": "Mato Grosso do Sul", "MG": "Minas Gerais",
    "PA": "Pará", "PB": "Paraíba", "PR": "Paraná", "PE": "Pernambuco",
    "PI": "Piauí", "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte",
    "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima",
    "SC": "Santa Catarina", "SP": "São Paulo", "SE": "Sergipe", "TO": "Tocantins",
}


def _get_minio() -> Minio:
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
    )


def compute_correlations(df: pd.DataFrame) -> Figure:
    numeric = df.select_dtypes("number")
    if numeric.empty:
        return go.Figure()
    corr = numeric.corr()
    fig = go.Figure(
        go.Heatmap(
            z=corr.values,
            x=corr.columns.tolist(),
            y=corr.columns.tolist(),
            colorscale="RdBu_r",
            zmid=0,
            text=np.round(corr.values, 2),
            texttemplate="%{text}",
        )
    )
    fig.update_layout(
        template=DARK_TEMPLATE,
        title="Feature Correlation Matrix",
        height=500,
        paper_bgcolor="#1a1a2e",
        plot_bgcolor="#1a1a2e",
    )
    return fig


def plot_distributions(df: pd.DataFrame, cols: list[str]) -> list[Figure]:
    figs: list[Figure] = []
    for col in cols[:8]:
        series = df[col].dropna()
        if len(series) == 0:
            continue
        fig = go.Figure()
        fig.add_trace(go.Histogram(x=series, nbinsx=40, marker_color=AMBER, opacity=0.8, name=col))
        fig.update_layout(
            template=DARK_TEMPLATE,
            title=f"Distribution: {col}",
            xaxis_title=col,
            yaxis_title="Count",
            paper_bgcolor="#1a1a2e",
            plot_bgcolor="#1a1a2e",
            height=300,
        )
        figs.append(fig)
    return figs


def decompose_timeseries(df: pd.DataFrame, date_col: str) -> Figure:
    try:
        from statsmodels.tsa.seasonal import STL
        ts = df.copy()
        ts[date_col] = pd.to_datetime(ts[date_col], errors="coerce")
        ts = ts.dropna(subset=[date_col])

        # Find revenue column
        rev_col = next(
            (c for c in ts.columns if c in ["payment_value", "price", "revenue"]), None
        )
        if not rev_col:
            rev_col = ts.select_dtypes("number").columns[0] if not ts.select_dtypes("number").empty else None

        if not rev_col:
            return go.Figure()

        daily = ts.groupby(pd.Grouper(key=date_col, freq="W"))[rev_col].sum().dropna()
        if len(daily) < 10:
            return go.Figure()

        stl = STL(daily, period=52, robust=True)
        result = stl.fit()

        fig = go.Figure()
        fig.add_trace(go.Scatter(x=daily.index, y=daily.values, name="Observed",
                                  line=dict(color=AMBER)))
        fig.add_trace(go.Scatter(x=daily.index, y=result.trend, name="Trend",
                                  line=dict(color=TEAL, dash="dash")))
        fig.add_trace(go.Scatter(x=daily.index, y=result.seasonal, name="Seasonal",
                                  line=dict(color=PURPLE, dash="dot")))
        fig.update_layout(
            template=DARK_TEMPLATE,
            title="Revenue Time-Series Decomposition (STL)",
            yaxis_title="Revenue (BRL)",
            paper_bgcolor="#1a1a2e",
            plot_bgcolor="#1a1a2e",
            height=400,
            legend=dict(orientation="h"),
        )
        return fig
    except Exception:
        return go.Figure()


def plot_choropleth(df: pd.DataFrame, geo_col: str, metric: str) -> Figure:
    try:
        state_data = df.groupby(geo_col)[metric].sum().reset_index()
        state_data.columns = ["state", "value"]
        state_data = state_data[state_data["state"].str.len() == 2]

        fig = go.Figure(go.Choropleth(
            locations=state_data["state"],
            z=state_data["value"],
            locationmode="geojson-id",
            colorscale=[[0, "#1a1a2e"], [0.5, PURPLE], [1.0, AMBER]],
            text=state_data["state"],
            hovertemplate="<b>%{text}</b><br>Revenue: R$ %{z:,.0f}<extra></extra>",
            colorbar_title="Revenue (BRL)",
        ))

        # Fallback: use simple bar chart if choropleth fails
        fig = px.bar(
            state_data.sort_values("value", ascending=False).head(15),
            x="state",
            y="value",
            color="value",
            color_continuous_scale=["#1a1a2e", PURPLE, AMBER],
            labels={"state": "State", "value": "Revenue (BRL)"},
            title="Revenue by Brazilian State",
            template=DARK_TEMPLATE,
        )
        fig.update_layout(
            paper_bgcolor="#1a1a2e",
            plot_bgcolor="#1a1a2e",
            height=400,
        )
        return fig
    except Exception:
        return go.Figure()


def upload_chart_to_minio(fig: Figure, run_id: str, name: str) -> str:
    """Upload a Plotly figure as PNG to MinIO. Returns key."""
    minio = _get_minio()
    bucket = settings.minio_bucket_charts
    try:
        minio.bucket_exists(bucket) or minio.make_bucket(bucket)
    except Exception:
        pass

    # Also store as JSON for browser rendering
    import json
    chart_json = fig.to_json()
    key = f"{run_id}/{name}.json"
    data = chart_json.encode()
    minio.put_object(bucket, key, io.BytesIO(data), len(data), content_type="application/json")
    return f"{bucket}/{key}"
