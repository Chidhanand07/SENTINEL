import re
from typing import Optional

import pandas as pd
from pydantic import BaseModel


class DetectedSchema(BaseModel):
    date_col: Optional[str]
    revenue_col: Optional[str]
    customer_col: Optional[str]
    product_col: Optional[str]
    geo_col: Optional[str]
    numeric_cols: list[str]
    categorical_cols: list[str]
    row_count: int
    table_count: int
    join_keys: list[str]
    semantic_fields: dict[str, object] | None = None

    def dict(self, *args, **kwargs):
        # ensure everything is serializable
        return super().dict(*args, **kwargs)


class AvailableAnalyses(BaseModel):
    can_segment: bool
    can_forecast: bool
    can_choropleth: bool
    can_rfm: bool


class SchemaDetector:
    """
    Analyzes a dataframe and returns a detected schema using heuristics.
    """

    DATE_PATTERNS = [
        r'date', r'time', r'timestamp', r'created', r'ordered',
        r'purchased', r'dt', r'day', r'month', r'year'
    ]
    REVENUE_PATTERNS = [
        r'price', r'revenue', r'amount', r'value', r'payment',
        r'total', r'cost', r'sales', r'gmv', r'spend'
    ]
    CUSTOMER_PATTERNS = [
        r'customer', r'user', r'client', r'buyer', r'member',
        r'account', r'person', r'shopper'
    ]
    PRODUCT_PATTERNS = [
        r'product', r'sku', r'item', r'goods', r'category',
        r'article', r'merchandise'
    ]
    GEO_PATTERNS = [
        r'state', r'city', r'region', r'country', r'location',
        r'zip', r'postal', r'geo', r'province', r'district'
    ]

    def _score_columns(
        self,
        df: pd.DataFrame,
        patterns: list[str],
        must_be_numeric: bool = False,
        must_be_date: bool = False,
        prefer_categorical: bool = False,
    ) -> tuple[Optional[str], list[dict[str, object]]]:
        best_col = None
        best_score = -1.0
        candidates: list[dict[str, object]] = []

        for col in df.columns:
            # Type checks
            is_num = pd.api.types.is_numeric_dtype(df[col])
            is_datetime = pd.api.types.is_datetime64_any_dtype(df[col])

            if must_be_numeric and not is_num:
                continue
            if must_be_date:
                # We can also check if the col looks like a date via casting, but let's just rely on dtype mostly 
                # or column name if it contains date patterns
                pass

            score = 0
            lower_col = str(col).lower()
            
            # Exact match gets big bonus
            for p in patterns:
                if p == lower_col:
                    score += 10
                elif re.search(r'\b' + p + r'\b', lower_col):
                    score += 5
                elif p in lower_col:
                    score += 2

            if must_be_date and is_datetime:
                score += 5

            # Category quality heuristic: avoid IDs/near-unique strings
            if prefer_categorical and not is_num:
                non_null = df[col].dropna()
                uniq = non_null.nunique()
                total = max(len(non_null), 1)
                uniq_ratio = uniq / total
                if 2 <= uniq <= min(120, total):
                    score += 4
                if uniq_ratio > 0.9:
                    score -= 6
                if "id" in lower_col and uniq_ratio > 0.5:
                    score -= 4

            if score > 0:
                candidates.append({
                    "column": str(col),
                    "score": round(float(score), 2),
                    "confidence": round(min(float(score) / 16.0, 1.0), 2),
                })
                if score > best_score:
                    best_score = score
                    best_col = str(col)

        candidates.sort(key=lambda x: x["score"], reverse=True)
        return best_col, candidates

    def detect(self, df: pd.DataFrame, table_count: int = 1, join_keys: list[str] = None) -> DetectedSchema:
        try:
            numeric_cols = [str(c) for c in df.select_dtypes(include='number').columns.tolist()]
            categorical_cols = [str(c) for c in df.select_dtypes(exclude='number').columns.tolist()]

            date_col, date_candidates = self._score_columns(df, self.DATE_PATTERNS, must_be_date=True)
            revenue_col, revenue_candidates = self._score_columns(df, self.REVENUE_PATTERNS, must_be_numeric=True)
            customer_col, customer_candidates = self._score_columns(df, self.CUSTOMER_PATTERNS)
            product_col, product_candidates = self._score_columns(df, self.PRODUCT_PATTERNS, prefer_categorical=True)
            geo_col, geo_candidates = self._score_columns(df, self.GEO_PATTERNS)

            semantic_fields = {
                "category_col": product_col,
                "category_candidates": [c["column"] for c in product_candidates[:5]],
                "confidence": {
                    "date_col": date_candidates[0]["confidence"] if date_candidates else 0,
                    "revenue_col": revenue_candidates[0]["confidence"] if revenue_candidates else 0,
                    "customer_col": customer_candidates[0]["confidence"] if customer_candidates else 0,
                    "category_col": product_candidates[0]["confidence"] if product_candidates else 0,
                    "geo_col": geo_candidates[0]["confidence"] if geo_candidates else 0,
                },
            }

            return DetectedSchema(
                date_col=date_col,
                revenue_col=revenue_col,
                customer_col=customer_col,
                product_col=product_col,
                geo_col=geo_col,
                numeric_cols=numeric_cols,
                categorical_cols=categorical_cols,
                row_count=len(df),
                table_count=table_count,
                join_keys=join_keys or [],
                semantic_fields=semantic_fields,
            )
        except Exception as e:
            # ROBUSTNESS: Return safe defaults on any schema detection failure
            import structlog
            log = structlog.get_logger()
            log.warning("schema_detect_failed", error=str(e))
            numeric_cols = [str(c) for c in df.select_dtypes(include='number').columns.tolist()] if not df.empty else []
            categorical_cols = [str(c) for c in df.select_dtypes(exclude='number').columns.tolist()] if not df.empty else []
            return DetectedSchema(
                date_col=None,
                revenue_col=None,
                customer_col=None,
                product_col=None,
                geo_col=None,
                numeric_cols=numeric_cols,
                categorical_cols=categorical_cols,
                row_count=len(df),
                table_count=table_count,
                join_keys=join_keys or [],
                semantic_fields={
                    "category_col": None,
                    "category_candidates": [],
                    "confidence": {},
                },
            )

    def _geo_maps_to_known_regions(self, df: pd.DataFrame, geo_col: str) -> bool:
        """
        Stub to check if the geography maps to known mapbox/choropleth boundaries.
        In reality, we might check if values match known country/state codes.
        For now, checking if unique values are reasonable for regions.
        """
        if pd.api.types.is_numeric_dtype(df[geo_col]): return False
        uniques = df[geo_col].nunique()
        return uniques > 1 and uniques < 200

    def detect_available_analyses(self, schema: DetectedSchema, df: pd.DataFrame) -> AvailableAnalyses:
        can_segment = schema.customer_col is not None
        can_forecast = schema.date_col is not None and schema.revenue_col is not None
        can_choropleth = schema.geo_col is not None and self._geo_maps_to_known_regions(df, schema.geo_col)
        can_rfm = schema.date_col is not None and schema.customer_col is not None and schema.revenue_col is not None

        return AvailableAnalyses(
            can_segment=bool(can_segment),
            can_forecast=bool(can_forecast),
            can_choropleth=bool(can_choropleth),
            can_rfm=bool(can_rfm)
        )
