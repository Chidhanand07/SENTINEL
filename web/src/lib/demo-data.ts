import { RunManifest } from "@/lib/manifest";

export const DEMO_MANIFEST: RunManifest = {
  run_id: "demo-run-001",
  dataset_name: "retail_transactions_2024.csv",
  detected_schema: {
    date_col: "transaction_date",
    revenue_col: "sale_amount",
    customer_col: "customer_id",
    product_col: "product_category",
    geo_col: "region",
    numeric_cols: [
      "sale_amount",
      "quantity",
      "discount_percent",
      "unit_price",
    ],
    categorical_cols: [
      "product_category",
      "region",
      "payment_method",
      "channel",
    ],
    row_count: 94_832,
    table_count: 3,
    join_keys: ["customer_id", "order_id"],
  },
  available_analyses: {
    can_segment: true,
    can_forecast: true,
    can_choropleth: false,
    can_rfm: true,
  },
};

export const DEMO_KPI_CARDS = [
  { label: "Total Revenue", value: "$2.34M", delta: "+14.2%" },
  { label: "Active Customers", value: "18.4K", delta: "+8.7%" },
  { label: "Avg Order Value", value: "$127.40", delta: "+3.2%" },
  { label: "Discount Rate", value: "14.2%", delta: "-0.4%" },
];

export const DEMO_SEGMENTS = [
  {
    id: "seg-001",
    name: "High Value",
    persona_name: "High Value",
    size: 3200,
    customer_count: 3200,
    cluster_id: 1,
    segment_id: 1,
    avg_ltv: 2150,
    recency: 8,
    frequency: 24,
    traits: ["High frequency", "$2K+ annual spend", "Premium channel"],
    recommended_action: "Launch VIP loyalty program → estimated 10% LTV uplift",
    color: "#E8A838",
    scatter_data: {
      x: Array.from({ length: 100 }, () => Math.random() * 30 + 20),
      y: Array.from({ length: 100 }, () => Math.random() * 50 + 40),
      z: Array.from({ length: 100 }, () => Math.random() * 2000 + 1500),
      recency: 8,
      frequency: 24,
      value: 2150,
    },
  },
  {
    id: "seg-002",
    name: "Regular",
    persona_name: "Regular",
    size: 7100,
    customer_count: 7100,
    cluster_id: 2,
    segment_id: 2,
    avg_ltv: 850,
    recency: 18,
    frequency: 12,
    traits: ["Moderate frequency", "$500-$2K annual", "Mixed channel"],
    recommended_action: "Run seasonal campaigns targeting mixed-channel buyers",
    color: "#a78bfa",
    scatter_data: {
      x: Array.from({ length: 100 }, () => Math.random() * 20 + 40),
      y: Array.from({ length: 100 }, () => Math.random() * 35 + 25),
      z: Array.from({ length: 100 }, () => Math.random() * 1200 + 600),
      recency: 18,
      frequency: 12,
      value: 850,
    },
  },
  {
    id: "seg-003",
    name: "Occasional",
    persona_name: "Occasional",
    size: 5400,
    customer_count: 5400,
    cluster_id: 3,
    segment_id: 3,
    avg_ltv: 380,
    recency: 35,
    frequency: 4,
    traits: ["Low frequency", "<$500 annual", "Web-only"],
    recommended_action: "Send re-engagement emails with 15% web incentive",
    color: "#2dd4cf",
    scatter_data: {
      x: Array.from({ length: 100 }, () => Math.random() * 50 + 50),
      y: Array.from({ length: 100 }, () => Math.random() * 25 + 10),
      z: Array.from({ length: 100 }, () => Math.random() * 600 + 200),
      recency: 35,
      frequency: 4,
      value: 380,
    },
  },
  {
    id: "seg-004",
    name: "Churning",
    persona_name: "Churning",
    size: 2100,
    customer_count: 2100,
    cluster_id: 4,
    segment_id: 4,
    avg_ltv: 620,
    recency: 62,
    frequency: 2,
    traits: ["Declining activity", "Seasonal buyer", "Price-sensitive"],
    recommended_action: "Win-back campaign with 25% discount → 20% expected recovery",
    color: "#f87171",
    scatter_data: {
      x: Array.from({ length: 100 }, () => Math.random() * 60 + 70),
      y: Array.from({ length: 100 }, () => Math.random() * 15 + 5),
      z: Array.from({ length: 100 }, () => Math.random() * 400 + 100),
      recency: 62,
      frequency: 2,
      value: 620,
    },
  },
];

export const DEMO_FORECAST = [
  // Electronics group
  {
    product_category: "Electronics",
    model: "prophet",
    forecast_dates: Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() + i * 86400000);
      return d.toISOString().split("T")[0];
    }),
    forecast_values: Array.from({ length: 30 }, (_, i) =>
      Math.floor(45000 + Math.random() * 12000 + i * 150)
    ),
    ci_lower: Array.from({ length: 30 }, (_, i) =>
      Math.floor(40000 + Math.random() * 8000 + i * 100)
    ),
    ci_upper: Array.from({ length: 30 }, (_, i) =>
      Math.floor(50000 + Math.random() * 15000 + i * 200)
    ),
    mape: 8.4,
    rmse: 2100,
  },
  {
    product_category: "Electronics",
    model: "sarimax",
    forecast_dates: Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() + i * 86400000);
      return d.toISOString().split("T")[0];
    }),
    forecast_values: Array.from({ length: 30 }, (_, i) =>
      Math.floor(43500 + Math.random() * 11000 + i * 160)
    ),
    ci_lower: Array.from({ length: 30 }, (_, i) =>
      Math.floor(38500 + Math.random() * 7500 + i * 110)
    ),
    ci_upper: Array.from({ length: 30 }, (_, i) =>
      Math.floor(48500 + Math.random() * 14000 + i * 210)
    ),
    mape: 9.1,
    rmse: 2280,
  },
  {
    product_category: "Electronics",
    model: "lightgbm",
    forecast_dates: Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() + i * 86400000);
      return d.toISOString().split("T")[0];
    }),
    forecast_values: Array.from({ length: 30 }, (_, i) =>
      Math.floor(46200 + Math.random() * 13000 + i * 140)
    ),
    ci_lower: Array.from({ length: 30 }, (_, i) =>
      Math.floor(41200 + Math.random() * 9000 + i * 90)
    ),
    ci_upper: Array.from({ length: 30 }, (_, i) =>
      Math.floor(51200 + Math.random() * 16000 + i * 190)
    ),
    mape: 7.8,
    rmse: 1950,
  },

  // Apparel group
  {
    product_category: "Apparel",
    model: "prophet",
    forecast_dates: Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() + i * 86400000);
      return d.toISOString().split("T")[0];
    }),
    forecast_values: Array.from({ length: 30 }, (_, i) =>
      Math.floor(28000 + Math.random() * 8000 + i * 90)
    ),
    ci_lower: Array.from({ length: 30 }, (_, i) =>
      Math.floor(24000 + Math.random() * 5500 + i * 60)
    ),
    ci_upper: Array.from({ length: 30 }, (_, i) =>
      Math.floor(32000 + Math.random() * 10000 + i * 120)
    ),
    mape: 10.2,
    rmse: 1850,
  },
  {
    product_category: "Apparel",
    model: "sarimax",
    forecast_dates: Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() + i * 86400000);
      return d.toISOString().split("T")[0];
    }),
    forecast_values: Array.from({ length: 30 }, (_, i) =>
      Math.floor(27200 + Math.random() * 7500 + i * 100)
    ),
    ci_lower: Array.from({ length: 30 }, (_, i) =>
      Math.floor(23200 + Math.random() * 5000 + i * 70)
    ),
    ci_upper: Array.from({ length: 30 }, (_, i) =>
      Math.floor(31200 + Math.random() * 9500 + i * 130)
    ),
    mape: 11.0,
    rmse: 1980,
  },
  {
    product_category: "Apparel",
    model: "lightgbm",
    forecast_dates: Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() + i * 86400000);
      return d.toISOString().split("T")[0];
    }),
    forecast_values: Array.from({ length: 30 }, (_, i) =>
      Math.floor(28800 + Math.random() * 8500 + i * 85)
    ),
    ci_lower: Array.from({ length: 30 }, (_, i) =>
      Math.floor(24800 + Math.random() * 6000 + i * 55)
    ),
    ci_upper: Array.from({ length: 30 }, (_, i) =>
      Math.floor(32800 + Math.random() * 10500 + i * 115)
    ),
    mape: 9.6,
    rmse: 1720,
  },

  // Home & Garden group
  {
    product_category: "Home & Garden",
    model: "prophet",
    forecast_dates: Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() + i * 86400000);
      return d.toISOString().split("T")[0];
    }),
    forecast_values: Array.from({ length: 30 }, (_, i) =>
      Math.floor(22000 + Math.random() * 6000 + i * 110)
    ),
    ci_lower: Array.from({ length: 30 }, (_, i) =>
      Math.floor(19000 + Math.random() * 4000 + i * 80)
    ),
    ci_upper: Array.from({ length: 30 }, (_, i) =>
      Math.floor(25000 + Math.random() * 7500 + i * 140)
    ),
    mape: 11.5,
    rmse: 1620,
  },
  {
    product_category: "Home & Garden",
    model: "sarimax",
    forecast_dates: Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() + i * 86400000);
      return d.toISOString().split("T")[0];
    }),
    forecast_values: Array.from({ length: 30 }, (_, i) =>
      Math.floor(21200 + Math.random() * 5800 + i * 105)
    ),
    ci_lower: Array.from({ length: 30 }, (_, i) =>
      Math.floor(18200 + Math.random() * 3800 + i * 75)
    ),
    ci_upper: Array.from({ length: 30 }, (_, i) =>
      Math.floor(24200 + Math.random() * 7200 + i * 135)
    ),
    mape: 12.1,
    rmse: 1750,
  },
  {
    product_category: "Home & Garden",
    model: "lightgbm",
    forecast_dates: Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() + i * 86400000);
      return d.toISOString().split("T")[0];
    }),
    forecast_values: Array.from({ length: 30 }, (_, i) =>
      Math.floor(22800 + Math.random() * 6500 + i * 115)
    ),
    ci_lower: Array.from({ length: 30 }, (_, i) =>
      Math.floor(19800 + Math.random() * 4500 + i * 85)
    ),
    ci_upper: Array.from({ length: 30 }, (_, i) =>
      Math.floor(25800 + Math.random() * 8000 + i * 145)
    ),
    mape: 10.8,
    rmse: 1550,
  },
];

export const DEMO_LINEAGE = [
  {
    step_order: 1,
    agent: "SchemaJoinNode",
    transformation:
      "Uploaded 3 CSV files → 94,832 rows via customer_id key join",
    rows_in: 145000,
    rows_out: 94832,
    duration_ms: 2840,
  },
  {
    step_order: 2,
    agent: "ProfilerNode",
    transformation:
      "Statistical profiling + outlier detection (IQR method)",
    rows_in: 94832,
    rows_out: 94832,
    duration_ms: 6230,
  },
  {
    step_order: 3,
    agent: "CleaningNode",
    transformation:
      "Median imputation (8 numeric_cols) + dedup (156 removed) + category normalization",
    rows_in: 94832,
    rows_out: 94676,
    duration_ms: 4120,
  },
  {
    step_order: 4,
    agent: "EDANode",
    transformation:
      "EDA: 8 chart artifacts, 15 features identified, autocorrelation analysis",
    rows_in: 94676,
    rows_out: 94676,
    duration_ms: 9870,
  },
  {
    step_order: 5,
    agent: "SegmentationNode",
    transformation:
      "RFM clustering (k=4) → 4 segments, silhouette score 0.58, engagement patterns identified",
    rows_in: 94676,
    rows_out: 4,
    duration_ms: 14560,
  },
  {
    step_order: 6,
    agent: "ForecastNode",
    transformation:
      "Prophet/SARIMAX/LightGBM → 90 forecasts (3 product_category groups × 30d)",
    rows_in: 94676,
    rows_out: 90,
    duration_ms: 32410,
  },
  {
    step_order: 7,
    agent: "NarratorNode",
    transformation:
      "LangChain narrative generation + PDF synthesis with charts",
    rows_in: 98,
    rows_out: 1,
    duration_ms: 5280,
  },
];

export const DEMO_BRIEF = {
  insight_brief:
    "Analysis of 94,832 transactions revealed 4 distinct customer segments. High-value customers drive 32% of revenue while representing 24% of the base. Demand forecasting projects 18% growth in Electronics category over next 30 days.",
  what_we_found:
    "Analysis of 94,832 transactions revealed 4 distinct customer segments. High-value customers drive 32% of revenue while representing only 24% of the customer base. Demand forecasting validates sustained growth momentum, with Electronics category leading at 18% quarterly increase. Churn indicators detected in 2.1K accounts with declining frequency.",
  why_it_matters:
    "Untargeted marketing spend is diluting ROI across all customer tiers. The churning segment represents $450K in recoverable annual revenue. Regional demand signals show 15% growth opportunity in West Coast markets. Customer lifetime value disparity creates concentrated revenue risk.",
  recommended_actions: [
    "Launch VIP loyalty program for high-value segment — estimated 10% LTV uplift.",
    "Activate win-back campaign for churning segment with 20% discount — 20% expected recovery rate.",
    "Increase inventory for Electronics category — forecast shows +18% demand surge.",
    "Expand in West Coast region — second fastest growing market with 15% growth potential.",
    "Set automated alerts for revenue anomalies exceeding 25% deviation.",
  ],
  evidence_needed: ["kpi", "segments", "forecast"],
};

export const DEMO_QUALITY = {
  completeness: 97.3,
  duplicate_rate: 0.42,
  outlier_count: 3421,
  schema_coverage: 100,
};
