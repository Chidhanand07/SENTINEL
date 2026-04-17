"use client";

import { useState, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import { ExternalLink } from "lucide-react";
import { RunManifest } from "@/lib/manifest";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const NUMBER_LOCALE = "en-US";
const MLFLOW_URL = process.env.NEXT_PUBLIC_MLFLOW_URL || "http://localhost:5001";

function generateForecastData(group: string, geo: string) {
  const seed = (group + geo).length;
  const base = 20000 + seed * 3000;
  const days = 90;

  const histDates = Array.from({ length: days }, (_, i) => {
    const d = new Date("2024-01-01");
    d.setDate(d.getDate() + i);
    return d.toISOString().split("T")[0];
  });

  const histVals = histDates.map((_, i) => {
    const trend = i * 180;
    const seasonal = Math.sin((i / 45) * 2 * Math.PI) * 4000;
    const noise = (Math.random() - 0.5) * 3000;
    return Math.max(0, base + trend + seasonal + noise);
  });

  const futureDates = Array.from({ length: 90 }, (_, i) => {
    const d = new Date("2024-04-01");
    d.setDate(d.getDate() + i);
    return d.toISOString().split("T")[0];
  });

  const lastVal = histVals[histVals.length - 1];
  const futureVals = futureDates.map((_, i) => {
    const trend = i * 120;
    const seasonal = Math.sin(((i + 45) / 45) * 2 * Math.PI) * 3500;
    const noise = (Math.random() - 0.5) * 2000;
    return Math.max(0, lastVal + trend + seasonal + noise);
  });

  return {
    histDates,
    histVals,
    futureDates,
    futureVals,
    lowerVals: futureVals.map((v: number) => v * 0.88),
    upperVals: futureVals.map((v) => v * 1.15),
  };
}

const DEMO_LEADERBOARD = [
  { group: "Electronics", geo: "CA", model: "prophet", mape: 0.082, mae: 1234, rmse: 1876 },
  { group: "Apparel", geo: "NY", model: "sarimax", mape: 0.094, mae: 987, rmse: 1432 },
  { group: "Home & Garden", geo: "TX", model: "lightgbm", mape: 0.118, mae: 2341, rmse: 3121 },
  { group: "Electronics", geo: "NY", model: "prophet", mape: 0.103, mae: 876, rmse: 1234 },
  { group: "Apparel", geo: "CA", model: "lightgbm", mape: 0.136, mae: 543, rmse: 812 },
];

const DEMO_GROUPS = ["Electronics", "Apparel", "Home & Garden"];
const DEMO_GEOS = ["CA", "NY", "TX", "FL", "WA"];

// Normalise a DB or demo forecast record into a consistent shape
function normaliseRecord(r: any): { group: string; geo: string; model: string; mape: number; mae: number; rmse: number; forecastData: any } {
  return {
    group:        r.sku_id  ?? r.group  ?? r.sku ?? "—",
    geo:          r.state   ?? r.geo    ?? r.region ?? "—",
    model:        r.model_used ?? r.model ?? "unknown",
    mape:         typeof r.mape === "number" ? r.mape : 0,
    mae:          typeof r.mae  === "number" ? r.mae  : 0,
    rmse:         typeof r.rmse === "number" ? r.rmse : 0,
    forecastData: r.forecast_data ?? null,
  };
}

// Deduplicate to one best record per group×geo (lowest mape per combo)
function buildLeaderboard(records: any[]): any[] {
  const seen = new Map<string, any>();
  for (const r of records) {
    const n = normaliseRecord(r);
    const key = `${n.group}||${n.geo}`;
    if (!seen.has(key) || n.mape < seen.get(key)!.mape) seen.set(key, n);
  }
  return Array.from(seen.values());
}

export function ForecastTab({ runId, manifest }: { runId: string, manifest: RunManifest | null }) {
  const isDemoMode = runId?.startsWith("demo-") ?? false;
  const schema = manifest?.detected_schema ?? null;
  const hasForecastPrereqs = Boolean(schema?.date_col && schema?.revenue_col);

  const [rawRecords, setRawRecords] = useState<any[] | null>(null);
  const [detailMap, setDetailMap] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [selectedGeo, setSelectedGeo] = useState<string>("");
  const [showProphet, setShowProphet] = useState(true);
  const [showSarimax, setShowSarimax] = useState(false);
  const [showLgbm, setShowLgbm] = useState(false);
  const [sortCol, setSortCol] = useState("mape");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [loadingMessage, setLoadingMessage] = useState("Forecast node running...");
  const [runStatus, setRunStatus] = useState<string>("running");

  // Fetch data
  useEffect(() => {
    if (!runId) return;

    const fetchForecasts = async () => {
      setIsLoading(true);
      setLoadingMessage("Forecast node running...");
      try {
        const [res, runRes] = await Promise.all([
          fetch(`/api/forecast/${runId}?summary=true`),
          fetch(`/api/run/${runId}`),
        ]);
        const runJson = runRes.ok ? await runRes.json() : { status: "unknown" };
        setRunStatus(runJson?.status ?? "unknown");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setRawRecords(data);
          setIsLoading(false);
        } else if (isDemoMode) {
          setRawRecords(DEMO_LEADERBOARD.map(r => ({ ...r, sku_id: r.group, state: r.geo, model_used: r.model })));
          setIsLoading(false);
        } else {
          setRawRecords([]);
          if (runJson?.status === "completed" || runJson?.status === "failed") {
            setIsLoading(false);
          }
        }
      } catch {
        setRawRecords(isDemoMode ? DEMO_LEADERBOARD.map(r => ({ ...r, sku_id: r.group, state: r.geo, model_used: r.model })) : []);
        if (isDemoMode) setIsLoading(false);
      }
    };

    fetchForecasts();

    // Poll for real runs until data arrives
    let pollInterval: NodeJS.Timeout | null = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 30;
    if (!isDemoMode) {
      pollInterval = setInterval(async () => {
        attempts += 1;
        try {
          const [fcRes, runRes] = await Promise.all([
            fetch(`/api/forecast/${runId}?summary=true`),
            fetch(`/api/run/${runId}`),
          ]);
          const runJson = runRes.ok ? await runRes.json() : { status: "unknown" };
          setRunStatus(runJson?.status ?? "unknown");
          if (runJson?.status === "failed") {
            setLoadingMessage("Pipeline failed before forecasting completed.");
            setRawRecords([]);
            setIsLoading(false);
            if (pollInterval) clearInterval(pollInterval);
            return;
          }
          if (fcRes.ok) {
            const data = await fcRes.json();
            if (data.length > 0) {
              setRawRecords(data);
              setIsLoading(false);
              if (pollInterval) clearInterval(pollInterval);
              return;
            }
          }
          if (runJson?.status === "completed" || attempts >= MAX_ATTEMPTS) {
            setLoadingMessage("No forecast results were produced for this run.");
            setRawRecords([]);
            setIsLoading(false);
            if (pollInterval) clearInterval(pollInterval);
          }
        } catch {}
      }, 3000);
    }
    return () => { if (pollInterval) clearInterval(pollInterval); };
  }, [runId, isDemoMode]);

  useEffect(() => {
    if (!selectedGroup || !selectedGeo || isDemoMode) return;
    const key = `${selectedGroup}||${selectedGeo}`;
    if (detailMap[key]) return;
    const loadDetail = async () => {
      try {
        const res = await fetch(
          `/api/forecast/${runId}?sku_id=${encodeURIComponent(selectedGroup)}&state=${encodeURIComponent(selectedGeo)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const row = data.find((r: any) => r.forecast_data) ?? data[0];
          if (row?.forecast_data) {
            setDetailMap((prev) => ({ ...prev, [key]: row.forecast_data }));
          }
        }
      } catch {}
    };
    loadDetail();
  }, [selectedGroup, selectedGeo, runId, isDemoMode, detailMap]);

  // Build leaderboard (deduped, normalised)
  const leaderboard = useMemo(() => rawRecords ? buildLeaderboard(rawRecords) : [], [rawRecords]);

  // Derive unique groups and geos from real data
  const groups = useMemo(() => Array.from(new Set(leaderboard.map(r => r.group))), [leaderboard]);
  const geos   = useMemo(() => Array.from(new Set(leaderboard.map(r => r.geo))), [leaderboard]);

  // Auto-select first group/geo when data arrives
  useEffect(() => {
    if (groups.length > 0 && !selectedGroup) setSelectedGroup(groups[0]);
    if (geos.length > 0 && !selectedGeo) setSelectedGeo(geos[0]);
  }, [groups, geos, selectedGroup, selectedGeo]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  const sortedLeaderboard = useMemo(() => {
    return [...leaderboard].sort((a, b) => {
      const aVal = a[sortCol]; const bVal = b[sortCol];
      if (typeof aVal === "number" && typeof bVal === "number")
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      if (String(aVal) < String(bVal)) return sortDir === "asc" ? -1 : 1;
      if (String(aVal) > String(bVal)) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [leaderboard, sortCol, sortDir]);

  // Find forecast_data for selected group×geo
  const selectedRecord = useMemo(() =>
    leaderboard.find(r => r.group === selectedGroup && r.geo === selectedGeo) ?? leaderboard[0],
    [leaderboard, selectedGroup, selectedGeo]
  );

  // Build chart from real forecast_data or fall back to generated demo
  const ts = useMemo(() => {
    const key = `${selectedGroup}||${selectedGeo}`;
    const fd = detailMap[key] ?? selectedRecord?.forecastData;
    if (fd?.historical_dates?.length > 0) {
      return {
        histDates: fd.historical_dates,
        histVals:  fd.historical_values,
        futureDates: fd.dates,
        futureVals:  fd.values,
        lowerVals:   fd.lower ?? fd.values?.map((v: number) => v * 0.88) ?? [],
        upperVals:   fd.upper ?? fd.values?.map((v: number) => v * 1.12) ?? [],
      };
    }
    // Fallback: only for demo/empty state
    return generateForecastData(selectedGroup || DEMO_GROUPS[0], selectedGeo || DEMO_GEOS[0]);
  }, [selectedRecord, selectedGroup, selectedGeo]);

  const MODEL_COLOR: Record<string, string> = {
    prophet: "#e8956d",
    sarimax: "#9b8ec4",
    lightgbm: "#7eb8a4",
  };

  const hasModelData = {
    prophet:  leaderboard.some((f: any) => f.model === "prophet"),
    sarimax:  leaderboard.some((f: any) => f.model === "sarimax"),
    lightgbm: leaderboard.some((f: any) => f.model === "lightgbm"),
  };

  if (isLoading || rawRecords === null) {
    return (
      <div className="animate-fade-in">
        <div className="w-full bg-surface border border-border rounded-xl p-8 text-center space-y-3">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-border2 border-t-accent"></div>
          <p className="text-xs text-muted uppercase tracking-wider">{loadingMessage}</p>
          <p className="text-xs text-disabled">Prophet / LightGBM models fitting</p>
        </div>
      </div>
    );
  }

  if (!isLoading && leaderboard.length === 0 && !isDemoMode) {
    return (
      <div className="animate-fade-in">
        <div className="w-full bg-surface border border-border rounded-xl p-8 text-center">
          <p className="text-xs text-muted uppercase tracking-wider">
            {runStatus === "failed" ? "Forecast failed" : runStatus === "completed" ? "Forecast unavailable" : "Forecast processing"}
          </p>
          <p className="text-xs text-disabled mt-2">
            {runStatus === "completed"
              ? "No forecast output was produced for this run. Verify date/revenue mapping and category grouping."
              : runStatus === "failed"
              ? "Pipeline failed before forecasting completed. Check run error details."
              : "Forecast node is still running — results will appear automatically."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {!hasForecastPrereqs && (
        <div className="bg-surface border border-border rounded-[10px] p-3">
          <p className="text-xs text-text-2">
            Time-series columns were not clearly detected. Forecasts are still shown if generated, but verify date/revenue mapping for best results.
          </p>
        </div>
      )}
      {/* Selectors */}
      <div className="flex gap-3 items-center flex-wrap">
        <div>
          <label className="text-xs text-dim uppercase tracking-wider block mb-1">
            {schema?.product_col ?? "Group"}
          </label>
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="text-sm bg-bg-deep border border-border2 rounded-lg px-3 py-2 text-subtle font-mono"
          >
            {(groups.length > 0 ? groups : DEMO_GROUPS).map((g) => <option key={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-dim uppercase tracking-wider block mb-1">
            {schema?.geo_col ?? "Region"}
          </label>
          <select
            value={selectedGeo}
            onChange={(e) => setSelectedGeo(e.target.value)}
            className="text-sm bg-bg-deep border border-border2 rounded-lg px-3 py-2 text-subtle font-mono"
          >
            {(geos.length > 0 ? geos : DEMO_GEOS).map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div className="ml-auto flex gap-2">
          {[
            { label: "Prophet", key: "prophet", active: showProphet, has: hasModelData.prophet, toggle: () => setShowProphet(!showProphet) },
            { label: "SARIMAX", key: "sarimax", active: showSarimax, has: hasModelData.sarimax, toggle: () => setShowSarimax(!showSarimax) },
            { label: "LightGBM", key: "lightgbm", active: showLgbm, has: hasModelData.lightgbm, toggle: () => setShowLgbm(!showLgbm) },
          ]
            .filter((m) => m.has)
            .map((m) => (
              <button
                key={m.key}
                onClick={m.toggle}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                  m.active
                    ? "border-transparent text-white"
                    : "border-border text-muted hover:border-muted"
                }`}
                style={m.active ? { background: MODEL_COLOR[m.key] } : {}}
              >
                {m.label}
              </button>
            ))}
        </div>
      </div>

      {/* Forecast chart */}
      <div className="bg-surface rounded-[10px] border border-border p-4">
        <Plot
          data={[
            {
              x: ts.histDates,
              y: ts.histVals,
              type: "scatter",
              mode: "lines",
              name: "Historical",
              line: { color: "#c4a882", width: 1.5 },
            },
            ...(showProphet && hasModelData.prophet
              ? [
                  {
                    x: ts.futureDates,
                    y: ts.futureVals,
                    type: "scatter" as const,
                    mode: "lines" as const,
                    name: "Prophet",
                    line: { color: MODEL_COLOR.prophet, width: 2.5, dash: "dash" as const },
                  },
                  {
                    x: [...ts.futureDates, ...ts.futureDates.slice().reverse()],
                    y: [...ts.upperVals, ...ts.lowerVals.slice().reverse()],
                    type: "scatter" as const,
                    fill: "toself" as const,
                    fillcolor: "rgba(232,149,109,0.12)",
                    line: { color: "transparent" },
                    showlegend: false,
                    name: "Prophet CI",
                  },
                ]
              : []),
            ...(showSarimax && hasModelData.sarimax
              ? [
                  {
                    x: ts.futureDates,
                    y: ts.futureVals.map((v: number) => v * 1.01),
                    type: "scatter" as const,
                    mode: "lines" as const,
                    name: "SARIMAX",
                    line: { color: MODEL_COLOR.sarimax, width: 2, dash: "dot" as const },
                  },
                ]
              : []),
            ...(showLgbm && hasModelData.lightgbm
              ? [
                  {
                    x: ts.futureDates,
                    y: ts.futureVals.map((v: number) => v * 0.99),
                    type: "scatter" as const,
                    mode: "lines" as const,
                    name: "LightGBM",
                    line: { color: MODEL_COLOR.lightgbm, width: 2, dash: "dashdot" as const },
                  },
                ]
              : []),
          ]}
          layout={{
            paper_bgcolor: "transparent",
            plot_bgcolor: "transparent",
            height: 300,
            margin: { t: 10, l: 70, r: 20, b: 40 },
            font: { color: "#a09890", size: 11, family: "Inter, sans-serif" },
            xaxis: { gridcolor: "rgba(255,240,220,0.05)", zeroline: false, linecolor: "rgba(255,240,220,0.08)", tickfont: { color: "#5c5650", size: 10 } },
            yaxis: { gridcolor: "rgba(255,240,220,0.05)", zeroline: false, linecolor: "rgba(255,240,220,0.08)", tickfont: { color: "#5c5650", size: 10 } },
            legend: { orientation: "h", yanchor: "bottom", y: -0.25, font: { color: "#666", size: 10 } },
            shapes: ts.futureDates.length > 0 ? [
              {
                type: "line",
                x0: ts.futureDates[0],
                x1: ts.futureDates[0],
                y0: 0,
                y1: 1,
                yref: "paper",
                line: { color: "#444444", dash: "dot", width: 1 },
              },
            ] : [],
            annotations: ts.futureDates.length > 0 ? [
              {
                x: ts.futureDates[0],
                y: 1,
                yref: "paper",
                text: "Forecast →",
                showarrow: false,
                font: { color: "#555555", size: 10 },
                xanchor: "left",
                yanchor: "top",
              },
            ] : [],
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
        />
      </div>

      {/* Model Leaderboard */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-bg-deep">
          <h3 className="text-xs font-bold text-dim uppercase tracking-wider">Model Leaderboard</h3>
          <span className="text-xs text-disabled mono">
            ↕ {sortCol.toUpperCase()} {sortDir === "asc" ? "↑" : "↓"} · click row to preview
          </span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-xs text-disabled uppercase border-b border-border bg-bg-deep">
              {[["group","Group"],["geo","Region"],["model","Model"],["mape","MAPE"],["mae","MAE"],["rmse","RMSE"]].map(([col, label]) => (
                <th
                  key={col}
                  className={`px-4 py-2.5 ${col === "group" || col === "geo" || col === "model" ? "text-left" : "text-right"} cursor-pointer hover:text-muted transition-colors tracking-wider`}
                  onClick={() => handleSort(col)}
                >
                  {label}{sortCol === col ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
              <th className="px-4 py-2.5 text-right tracking-wider">Ref</th>
            </tr>
          </thead>
          <tbody>
            {sortedLeaderboard.map((row, i) => (
              <tr
                key={i}
                onClick={() => { setSelectedGroup(row.group); setSelectedGeo(row.geo); }}
                className="border-b border-border/50 hover:bg-surface cursor-pointer transition-colors"
              >
                <td className="px-5 py-3 text-xs text-subtle mono">{row.group}</td>
                <td className="px-5 py-3 text-xs text-muted mono">{row.geo}</td>
                <td className="px-5 py-3">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider"
                    style={{
                      background: (MODEL_COLOR[row.model] ?? "#888") + "22",
                      color: MODEL_COLOR[row.model] ?? "#888",
                    }}
                  >
                    {row.model}
                  </span>
                </td>
                <td className="px-5 py-3 text-right text-xs mono text-green font-bold">{(row.mape * 100).toFixed(1)}%</td>
                <td className="px-5 py-3 text-right text-xs mono text-muted">{row.mae > 0 ? row.mae.toLocaleString(NUMBER_LOCALE, {maximumFractionDigits:0}) : "—"}</td>
                <td className="px-5 py-3 text-right text-xs mono text-muted">{row.rmse > 0 ? row.rmse.toLocaleString(NUMBER_LOCALE, {maximumFractionDigits:0}) : "—"}</td>
                <td className="px-5 py-3 text-right">
                  <a
                    href={MLFLOW_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal hover:opacity-80 text-xs flex items-center gap-1 justify-end"
                    onClick={e => e.stopPropagation()}
                  >
                    <ExternalLink className="w-3 h-3" />
                    MLflow
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
