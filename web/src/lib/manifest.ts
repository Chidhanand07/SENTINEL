export interface DetectedSchema {
  date_col: string | null;
  revenue_col: string | null;
  customer_col: string | null;
  product_col: string | null;
  geo_col: string | null;
  numeric_cols: string[];
  categorical_cols: string[];
  row_count: number;
  table_count: number;
  join_keys: string[];
  semantic_fields?: {
    category_col?: string | null;
    category_candidates?: string[];
    confidence?: Record<string, number>;
  };
}

export interface AvailableAnalyses {
  can_segment: boolean;
  can_forecast: boolean;
  can_choropleth: boolean;
  can_rfm: boolean;
}

export interface RunManifest {
  run_id: string;
  dataset_name: string;
  detected_schema: DetectedSchema | null;
  available_analyses: AvailableAnalyses | null;
}
