from __future__ import annotations

"""LangChain data tools — pure typed functions with explicit side effects only."""

import io
import os
from typing import Any

import pandas as pd
import numpy as np
from minio import Minio
from thefuzz import process as fuzz_process

from app.config import settings


# ── MinIO client (singleton) ───────────────────────────────────────────────

def _get_minio() -> Minio:
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
    )


# ── Join tools ─────────────────────────────────────────────────────────────

def infer_join_keys(file_paths: list[str]) -> dict[str, Any]:
    """Heuristic join key inference from column names across multiple CSVs."""
    dfs: dict[str, list[str]] = {}
    file_rows: dict[str, int] = {}

    for fp in file_paths:
        try:
            df = pd.read_csv(fp, nrows=100, encoding="latin-1")
            name = os.path.splitext(os.path.basename(fp))[0]
            dfs[name] = df.columns.tolist()
            full_df = pd.read_csv(fp, usecols=[0], encoding="latin-1")
            file_rows[name] = len(full_df)
        except Exception:
            continue

    # Find common id columns
    id_cols = {"order_id", "customer_id", "product_id", "seller_id", "review_id"}
    join_edges: list[dict[str, str]] = []

    table_names = list(dfs.keys())
    for i, t1 in enumerate(table_names):
        for t2 in table_names[i + 1:]:
            common = set(dfs[t1]) & set(dfs[t2]) & id_cols
            if common:
                join_edges.append({
                    "left": t1,
                    "right": t2,
                    "on": list(common)[0],
                })

    return {
        "tables": dfs,
        "join_edges": join_edges,
        "strategy": "sequential_left_join",
        "file_rows": file_rows,
    }


def execute_join(plan: dict[str, Any], file_paths: list[str]) -> pd.DataFrame:
    """Execute the join plan and return a master DataFrame — universal for any dataset."""
    tables: dict[str, pd.DataFrame] = {}
    for fp in file_paths:
        name = os.path.splitext(os.path.basename(fp))[0]
        try:
            tables[name] = pd.read_csv(fp, low_memory=False, encoding="latin-1")
        except Exception:
            continue

    if not tables:
        return pd.DataFrame()

    def _parse_dates(df: pd.DataFrame) -> pd.DataFrame:
        for col in df.columns:
            if any(kw in col.lower() for kw in ("date", "timestamp", "created", "updated", "time")):
                try:
                    df[col] = pd.to_datetime(df[col], errors="coerce")
                except Exception:
                    pass
        return df

    # Single-file upload — just return it
    if len(tables) == 1:
        df = next(iter(tables.values()))
        return _parse_dates(df)

    # Detect Olist by naming pattern
    olist_indicators = ("olist_", "order_items", "order_payments", "order_reviews")
    is_olist = any(any(ind in k for ind in olist_indicators) for k in tables)

    if is_olist:
        return _execute_olist_join(tables, _parse_dates)

    # Generic join using inferred join_edges
    return _execute_generic_join(tables, plan, _parse_dates)


def _execute_olist_join(tables: dict[str, pd.DataFrame], parse_dates) -> pd.DataFrame:
    """Olist-specific 7-table join sequence."""
    olist_sequence = [
        ("olist_orders_dataset",        None,          None),
        ("olist_order_items_dataset",   "order_id",    "order_id"),
        ("olist_order_payments_dataset","order_id",    "order_id"),
        ("olist_order_reviews_dataset", "order_id",    "order_id"),
        ("olist_customers_dataset",     "customer_id", "customer_id"),
        ("olist_products_dataset",      "product_id",  "product_id"),
        ("olist_sellers_dataset",       "seller_id",   "seller_id"),
    ]
    base_name = next(
        (n for n in tables if "order" in n and "item" not in n and "payment" not in n and "review" not in n),
        list(tables.keys())[0]
    )
    master = tables[base_name].copy()

    for tname, lk, rk in olist_sequence:
        if tname == base_name:
            continue
        stub = tname.replace("olist_", "").replace("_dataset", "")
        match = next((k for k in tables if stub in k.replace("olist_", "").replace("_dataset", "")), None)
        if match and match != base_name and lk and rk:
            try:
                other = tables[match]
                dup_cols = [c for c in other.columns if c in master.columns and c != rk]
                other = other.drop(columns=dup_cols, errors="ignore")
                master = master.merge(other, left_on=lk, right_on=rk, how="left")
            except Exception:
                continue
    return parse_dates(master)


def _execute_generic_join(tables: dict[str, pd.DataFrame], plan: dict[str, Any], parse_dates) -> pd.DataFrame:
    """Generic join using the plan's inferred join_edges."""
    join_edges = plan.get("join_edges", [])

    if not join_edges:
        # No common keys — return the largest table
        master = max(tables.values(), key=len).copy()
        return parse_dates(master)

    # Start from the table that appears most in edges (likely the fact table)
    from collections import Counter
    name_counts: Counter = Counter()
    for edge in join_edges:
        name_counts[edge["left"]] += 1
        name_counts[edge["right"]] += 1
    base_name = name_counts.most_common(1)[0][0] if name_counts else list(tables.keys())[0]

    if base_name not in tables:
        base_name = list(tables.keys())[0]

    master = tables[base_name].copy()
    joined: set[str] = {base_name}

    for edge in join_edges:
        left_t, right_t, on = edge["left"], edge["right"], edge["on"]
        try:
            if left_t in joined and right_t not in joined and right_t in tables:
                other = tables[right_t]
                dup_cols = [c for c in other.columns if c in master.columns and c != on]
                other = other.drop(columns=dup_cols, errors="ignore")
                master = master.merge(other, on=on, how="left")
                joined.add(right_t)
            elif right_t in joined and left_t not in joined and left_t in tables:
                other = tables[left_t]
                dup_cols = [c for c in other.columns if c in master.columns and c != on]
                other = other.drop(columns=dup_cols, errors="ignore")
                master = master.merge(other, on=on, how="left")
                joined.add(left_t)
        except Exception:
            continue

    return parse_dates(master)


# ── Storage tools ──────────────────────────────────────────────────────────

def write_parquet_to_minio(df: pd.DataFrame, key: str) -> str:
    """Write DataFrame as parquet to MinIO. Returns the key."""
    minio = _get_minio()
    bucket = settings.minio_bucket_datasets
    try:
        minio.bucket_exists(bucket) or minio.make_bucket(bucket)
    except Exception:
        pass

    buf = io.BytesIO()
    df.to_parquet(buf, index=False, engine="pyarrow")
    buf.seek(0)
    size = buf.getbuffer().nbytes

    minio.put_object(bucket, key, buf, size, content_type="application/octet-stream")
    return f"{bucket}/{key}"


def read_parquet_from_minio(key: str) -> pd.DataFrame:
    """Read parquet from MinIO."""
    if not key:
        raise ValueError("No parquet key provided")

    minio = _get_minio()
    # key may be bucket/path or just path
    if "/" in key:
        bucket, path = key.split("/", 1)
    else:
        bucket = settings.minio_bucket_datasets
        path = key

    try:
        response = minio.get_object(bucket, path)
        buf = io.BytesIO(response.read())
        return pd.read_parquet(buf)
    except Exception:
        # Fallback: try to find local CSV files
        import glob
        csv_files = glob.glob("/data/uploads/**/*.csv", recursive=True)
        if csv_files:
            plan = infer_join_keys(csv_files)
            return execute_join(plan, csv_files)
        raise


# ── Profiling tools ────────────────────────────────────────────────────────

def profile_dataframe(df: pd.DataFrame) -> dict[str, Any]:
    """Compute statistical profile of a DataFrame."""
    n = len(df)
    profile: dict[str, Any] = {
        "n_rows": n,
        "n_cols": len(df.columns),
        "missing_pct": df.isnull().mean().mean() * 100,
        "duplicate_count": df.duplicated().sum(),
        "columns": {},
    }

    for col in df.columns:
        series = df[col]
        col_profile: dict[str, Any] = {
            "dtype": str(series.dtype),
            "missing_count": int(series.isnull().sum()),
            "missing_pct": float(series.isnull().mean() * 100),
            "unique_count": int(series.nunique()),
        }
        if pd.api.types.is_numeric_dtype(series):
            col_profile.update({
                "mean": float(series.mean()) if not series.isnull().all() else 0,
                "std": float(series.std()) if not series.isnull().all() else 0,
                "min": float(series.min()) if not series.isnull().all() else 0,
                "max": float(series.max()) if not series.isnull().all() else 0,
                "skew": float(series.skew()) if not series.isnull().all() else 0,
            })
        profile["columns"][col] = col_profile

    return profile


def detect_outliers(df: pd.DataFrame) -> dict[str, Any]:
    """IQR-based outlier detection on numeric columns."""
    numeric = df.select_dtypes(include="number")
    outlier_count = 0
    outlier_cols: list[str] = []

    for col in numeric.columns:
        s = numeric[col].dropna()
        if len(s) < 10:
            continue
        q1, q3 = s.quantile(0.25), s.quantile(0.75)
        iqr = q3 - q1
        n_out = ((s < q1 - 1.5 * iqr) | (s > q3 + 1.5 * iqr)).sum()
        if n_out > 0:
            outlier_count += int(n_out)
            outlier_cols.append(col)

    return {"outlier_count": outlier_count, "outlier_cols": outlier_cols}


# ── Cleaning tools ─────────────────────────────────────────────────────────

def cap_outliers_iqr(df: pd.DataFrame) -> pd.DataFrame:
    """Winsorize outliers using 1.5×IQR — clips rather than drops."""
    df = df.copy()
    for col in df.select_dtypes(include="number").columns:
        s = df[col].dropna()
        if len(s) < 10:
            continue
        q1, q3 = s.quantile(0.25), s.quantile(0.75)
        iqr = q3 - q1
        if iqr == 0:
            continue
        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        df[col] = df[col].clip(lower=lower, upper=upper)
    return df


def select_imputation_strategy(col: str, col_profile: dict[str, Any]) -> str:
    """Choose imputation strategy from column profile."""
    if col_profile.get("missing_pct", 0) == 0:
        return "none"
    dtype = col_profile.get("dtype", "object")
    skew = col_profile.get("skew", 0)

    if "float" in dtype or "int" in dtype:
        return "median" if abs(skew) > 1 else "mean"
    return "mode"


def impute_dataframe(df: pd.DataFrame, strategy_map: dict[str, str]) -> pd.DataFrame:
    """Apply per-column imputation."""
    df = df.copy()
    for col, strategy in strategy_map.items():
        if col not in df.columns or strategy == "none":
            continue
        try:
            if strategy == "mean":
                df[col] = df[col].fillna(df[col].mean())
            elif strategy == "median":
                df[col] = df[col].fillna(df[col].median())
            elif strategy == "mode":
                mode_val = df[col].mode()
                if not mode_val.empty:
                    df[col] = df[col].fillna(mode_val.iloc[0])
        except Exception:
            continue
    return df


def deduplicate(df: pd.DataFrame, key_col: str) -> pd.DataFrame:
    """Remove duplicate rows by key column."""
    if key_col in df.columns:
        return df.drop_duplicates(subset=[key_col], keep="first").reset_index(drop=True)
    return df.drop_duplicates().reset_index(drop=True)


CATEGORY_MAP = {
    "cama_mesa_banho": "Bed Bath Table",
    "beleza_saude": "Beauty Health",
    "esporte_lazer": "Sports Leisure",
    "informatica_acessorios": "Computers Accessories",
    "moveis_decoracao": "Furniture Decor",
    "utilidades_domesticas": "Home Utilities",
    "relogios_presentes": "Watches Gifts",
    "telefonia": "Telephony",
    "ferramentas_jardim": "Tools Garden",
    "automotivo": "Automotive",
    "brinquedos": "Toys",
    "cool_stuff": "Cool Stuff",
    "perfumaria": "Perfumery",
    "bebes": "Baby",
    "eletronicos": "Electronics",
    "construcao_ferramentas_construcao": "Construction Tools",
    "papelaria": "Stationery",
    "livros_interesse_geral": "Books General",
    "eletrodomesticos": "Appliances",
    "fashion_bolsas_e_acessorios": "Fashion Bags Accessories",
}


def normalize_categories(df: pd.DataFrame, col: str) -> pd.DataFrame:
    """Map Portuguese category names to English using fuzzy matching."""
    df = df.copy()
    known = list(CATEGORY_MAP.keys())

    def _normalize(val: Any) -> str:
        if pd.isna(val):
            return "Other"
        val_str = str(val).lower().strip()
        if val_str in CATEGORY_MAP:
            return CATEGORY_MAP[val_str]
        # Fuzzy match
        match, score = fuzz_process.extractOne(val_str, known) or (val_str, 0)
        if score > 70:
            return CATEGORY_MAP[match]
        return val_str.replace("_", " ").title()

    df[col] = df[col].apply(_normalize)
    return df
