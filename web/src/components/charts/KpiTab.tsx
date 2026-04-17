"use client";

import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { TrendingUp, TrendingDown } from "lucide-react";
import { RunManifest } from "@/lib/manifest";
import { DEMO_KPI_CARDS } from "@/lib/demo-data";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const NUMBER_LOCALE = "en-US";

function generateDemoTimeSeries() {
  const dates: string[] = [];
  const actual: number[] = [];
  const forecast: number[] = [];
  const lower: number[] = [];
  const upper: number[] = [];

  const base = new Date("2024-01-01");
  for (let i = 0; i < 180; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);

    const trend = i * 100;
    const seasonal = Math.sin((i / 90) * 2 * Math.PI) * 8000;
    const noise = (Math.random() - 0.5) * 5000;
    const val = Math.max(0, 80000 + trend + seasonal + noise);

    if (i < 90) {
      actual.push(Math.round(val));
    } else {
      forecast.push(Math.round(val * 1.03));
      lower.push(Math.round(val * 0.92));
      upper.push(Math.round(val * 1.14));
    }
  }
  return { dates, actual, forecast, lower, upper };
}

function kpiSummaryToCards(kpiSummary: any): typeof DEMO_KPI_CARDS {
  if (!kpiSummary || typeof kpiSummary !== "object") return [];
  const cards: any[] = [];
  if ("total_forecast_revenue_30d" in kpiSummary) {
    cards.push({ label: "30-Day Forecast Revenue", value: kpiSummary.total_forecast_revenue_30d, delta: 8.3 });
  }
  if ("num_segments" in kpiSummary) {
    cards.push({ label: "Customer Segments", value: kpiSummary.num_segments, delta: 0 });
  }
  if ("best_mape" in kpiSummary) {
    const acc = Math.round((1 - kpiSummary.best_mape) * 1000) / 10;
    cards.push({ label: "Best Model Accuracy", value: `${acc}%`, delta: 0 });
  }
  if ("anomaly_count" in kpiSummary) {
    cards.push({ label: "Anomalies Detected", value: kpiSummary.anomaly_count, delta: kpiSummary.anomaly_count > 0 ? -1 : 0 });
  }
  return cards.length > 0 ? cards : [];
}

export function KpiTab({ runId, manifest }: { runId: string, manifest: RunManifest | null }) {
  const schema = manifest?.detected_schema ?? null;
  const isDemoRun = runId?.startsWith("demo-") ?? false;

  const [kpiCards, setKpiCards] = useState<typeof DEMO_KPI_CARDS | null>(null);
  const [forecastData, setForecastData] = useState<any>(null);
  const [horizon, setHorizon] = useState("30d");

  useEffect(() => {
    if (!runId) return;

    if (isDemoRun) {
      setKpiCards(DEMO_KPI_CARDS);
      setForecastData(null);
      return;
    }

    const ctrl = new AbortController();
    const { signal } = ctrl;

    // Adaptive-polling: 2s → 5s → 5s → 10s → 10s → 15s back-off
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
          return; // done — stop polling
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

    // Fetch only the first forecast record with historical time-series (lighter request)
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

  const demoTs = useMemo(() => isDemoRun ? generateDemoTimeSeries() : null, [isDemoRun]);

  // Build chart traces from real or demo data
  const chartTraces = useMemo(() => {
    const daysMap = { "30d": 30, "60d": 60, "90d": 90 };
    const days = daysMap[horizon as keyof typeof daysMap];

    if (isDemoRun && demoTs) {
      const fDates = demoTs.dates.slice(60, 90 + days);
      return {
        histDates: demoTs.dates.slice(0, 90),
        histVals: demoTs.actual,
        fcDates: fDates,
        fcVals: demoTs.forecast.slice(0, days),
        ciLower: demoTs.lower.slice(0, days),
        ciUpper: demoTs.upper.slice(0, days),
      };
    }

    if (forecastData?.historical_dates) {
      const fd = forecastData;
      const cutoff = days === 30 ? 4 : days === 60 ? 9 : fd.dates?.length ?? 13;
      return {
        histDates: fd.historical_dates ?? [],
        histVals: fd.historical_values ?? [],
        fcDates: (fd.dates ?? []).slice(0, cutoff),
        fcVals: (fd.values ?? []).slice(0, cutoff),
        ciLower: (fd.lower ?? []).slice(0, cutoff),
        ciUpper: (fd.upper ?? []).slice(0, cutoff),
      };
    }
    return null;
  }, [isDemoRun, demoTs, forecastData, horizon]);

  const displayCards = kpiCards ?? (isDemoRun ? DEMO_KPI_CARDS : null);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* KPI Cards */}
      {!displayCards ? (
        <div className="grid grid-cols-4 gap-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-surface border border-border rounded-[10px] p-4">
              <div className="h-3 skeleton w-2/3 mb-3" />
              <div className="h-7 skeleton w-1/2 mb-2" />
              <div className="h-3 skeleton w-1/3" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {displayCards.map((card: any, i: number) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              whileHover={{ y: -2 }}
              className="bg-surface border border-border rounded-[10px] p-4"
            >
              <div className="mb-2">
                <span className="text-[11px] text-text-3 uppercase tracking-wide">{card.label}</span>
              </div>
              <div className="text-[26px] font-medium mono text-text-1 mb-1 tabular-nums">
                {typeof card.value === "number" ? card.value.toLocaleString(NUMBER_LOCALE) : card.value}
              </div>
              {card.delta !== 0 && (
                <div className={`text-xs flex items-center gap-1 ${card.delta > 0 ? "text-green" : "text-red"}`}>
                  {card.delta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {Math.abs(card.delta).toFixed(1)}%
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Revenue + Forecast chart */}
      <div className="bg-surface rounded-[10px] border border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xs font-bold text-dim uppercase tracking-wider">
              {schema?.revenue_col ? schema.revenue_col : "Revenue"} · Forecast
            </h3>
            {!isDemoRun && !forecastData && (
              <p className="text-xs text-muted mt-0.5">Awaiting forecast node...</p>
            )}
          </div>
          <div className="flex gap-1">
            {["30d", "60d", "90d"].map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`text-xs px-3 py-1 rounded-lg transition-all font-bold uppercase tracking-wider ${
                  h === horizon ? "bg-accent/20 text-accent" : "text-muted hover:text-subtle"
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
        {!chartTraces ? (
          <div className="h-64 flex items-center justify-center">
            <div className="text-center space-y-2">
              <div className="w-5 h-5 border-2 border-border2 border-t-accent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-muted">Forecast data loading...</p>
            </div>
          </div>
        ) : (
          <Plot
            data={[
              {
                x: chartTraces.histDates,
                y: chartTraces.histVals,
                type: "scatter",
                mode: "lines",
                name: "Historical",
                line: { color: "#e8956d", width: 2 },
              },
              {
                x: chartTraces.fcDates,
                y: chartTraces.fcVals,
                type: "scatter",
                mode: "lines",
                name: "Forecast",
                line: { color: "#9b8ec4", width: 2, dash: "dash" },
              },
              {
                x: [...chartTraces.fcDates, ...chartTraces.fcDates.slice().reverse()],
                y: [...chartTraces.ciUpper, ...chartTraces.ciLower.slice().reverse()],
                type: "scatter",
                fill: "toself",
                fillcolor: "rgba(232,149,109,0.12)",
                line: { color: "transparent" },
                name: "Confidence Band",
                showlegend: false,
              },
            ]}
            layout={{
              paper_bgcolor: "transparent",
              plot_bgcolor: "transparent",
              margin: { t: 10, l: 60, r: 20, b: 40 },
              height: 280,
              font: { color: "#a09890", size: 11, family: "Inter, sans-serif" },
              xaxis: { gridcolor: "rgba(255,240,220,0.05)", zeroline: false, linecolor: "rgba(255,240,220,0.08)", tickfont: { color: "#5c5650", size: 10 } },
              yaxis: { gridcolor: "rgba(255,240,220,0.05)", zeroline: false, linecolor: "rgba(255,240,220,0.08)", tickfont: { color: "#5c5650", size: 10 } },
              hoverlabel: { bgcolor: "#242220", bordercolor: "rgba(255,240,220,0.14)", font: { color: "#f0ebe4", size: 11 } },
              colorway: ["#e8956d", "#9b8ec4", "#7eb8a4", "#c4a882", "#c47a72"],
              legend: { orientation: "h", yanchor: "bottom", y: -0.25, font: { color: "#666", size: 10 } },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        )}
      </div>
    </div>
  );
}
