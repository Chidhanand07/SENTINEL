"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { RunManifest } from "@/lib/manifest";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const NUMBER_LOCALE = "en-US";

type SegmentRecord = {
  persona_name?: string;
  size?: number;
  avg_ltv?: number;
  avg_recency?: number;
  avg_frequency?: number;
  color?: string;
};

type ForecastRecord = {
  sku_id?: string;
  state?: string;
  forecast_value?: number;
  model_used?: string;
  mape?: number;
};

export function ChartTab({ runId, manifest }: { runId: string; manifest: RunManifest | null }) {
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [forecasts, setForecasts] = useState<ForecastRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) return;
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const [segRes, fcRes] = await Promise.all([
          fetch(`/api/segments/${runId}`),
          fetch(`/api/forecast/${runId}?summary=true`),
        ]);

        const segData = segRes.ok ? await segRes.json() : [];
        const fcData = fcRes.ok ? await fcRes.json() : [];

        if (!mounted) return;
        setSegments(Array.isArray(segData) ? segData : []);
        setForecasts(Array.isArray(fcData) ? fcData : []);
      } catch {
        if (!mounted) return;
        setSegments([]);
        setForecasts([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [runId]);

  const topSegments = useMemo(
    () =>
      [...segments]
        .filter((s) => typeof s.size === "number" && typeof s.avg_ltv === "number")
        .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
        .slice(0, 10),
    [segments]
  );

  const topForecasts = useMemo(
    () =>
      [...forecasts]
        .filter((f) => typeof f.forecast_value === "number")
        .sort((a, b) => (b.forecast_value ?? 0) - (a.forecast_value ?? 0))
        .slice(0, 12),
    [forecasts]
  );

  const modelSpread = useMemo(() => {
    const modelMap = new Map<string, number>();
    for (const row of forecasts) {
      const model = row.model_used || "unknown";
      modelMap.set(model, (modelMap.get(model) || 0) + 1);
    }
    return Array.from(modelMap.entries()).map(([model, count]) => ({ model, count }));
  }, [forecasts]);

  const hasData = segments.length > 0 || forecasts.length > 0;
  const resolvedCategory =
    manifest?.detected_schema?.semantic_fields?.category_col
    || manifest?.detected_schema?.product_col
    || manifest?.detected_schema?.semantic_fields?.category_candidates?.[0]
    || "category";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bg-surface border border-border rounded-xl px-5 py-4">
        <p className="text-xs text-muted uppercase tracking-wider">Chart Node</p>
        <h3 className="text-lg font-semibold text-subtle mt-1">High-Visibility Visual Analytics</h3>
        <p className="text-xs text-text-3 mt-1">Using primary category field: {resolvedCategory}</p>
      </div>

      {loading ? (
        <div className="bg-surface border border-border rounded-xl p-10 text-center">
          <div className="inline-block animate-spin rounded-full h-7 w-7 border-2 border-border2 border-t-accent" />
          <p className="text-sm text-muted mt-3">Loading chart node data...</p>
        </div>
      ) : !hasData ? (
        <div className="bg-surface border border-border rounded-xl p-10 text-center">
          <p className="text-sm text-muted">No chartable records yet for this run.</p>
          <p className="text-xs text-muted mt-1">Please wait for Segmentation and Forecast nodes to complete.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5">
            <div className="bg-surface border border-border rounded-xl p-4">
              <p className="text-xs text-muted uppercase tracking-wider mb-3">3D Segment Landscape</p>
              <Plot
                data={[
                  {
                    x: topSegments.map((s) => s.avg_recency ?? 0),
                    y: topSegments.map((s) => s.avg_frequency ?? 0),
                    z: topSegments.map((s) => s.avg_ltv ?? 0),
                    text: topSegments.map((s) => s.persona_name ?? "segment"),
                    type: "scatter3d",
                    mode: "markers",
                    marker: {
                      size: topSegments.map((s) => Math.max(4, Math.min(20, Math.sqrt(s.size ?? 1)))),
                      color: topSegments.map((s) => s.color || "#E8FF47"),
                      opacity: 0.9,
                    },
                    hovertemplate:
                      "<b>%{text}</b><br>Recency: %{x:.1f}<br>Frequency: %{y:.1f}<br>LTV: %{z:,.0f}<extra></extra>",
                  } as any,
                ]}
                layout={{
                  height: 520,
                  margin: { t: 10, l: 0, r: 0, b: 0 },
                  paper_bgcolor: "transparent",
                  scene: {
                    xaxis: { title: "Recency" },
                    yaxis: { title: "Frequency" },
                    zaxis: { title: "Avg LTV" },
                  },
                }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            </div>

            <div className="bg-surface border border-border rounded-xl p-4">
              <p className="text-xs text-muted uppercase tracking-wider mb-3">3D Forecast Volume by SKU</p>
              <Plot
                data={[
                  {
                    x: topForecasts.map((f) => f.sku_id || "sku"),
                    y: topForecasts.map((f) => f.state || "region"),
                    z: topForecasts.map((f) => f.forecast_value || 0),
                    text: topForecasts.map((f) => `${f.model_used || "model"} · MAPE ${(f.mape ?? 0) * 100}%`),
                    type: "scatter3d",
                    mode: "markers",
                    marker: {
                      size: 7,
                      color: topForecasts.map((f) => f.mape ?? 0),
                      colorscale: "Viridis",
                      colorbar: { title: "MAPE" },
                    },
                    hovertemplate: "<b>%{x}</b><br>%{y}<br>Forecast: %{z:,.0f}<br>%{text}<extra></extra>",
                  } as any,
                ]}
                layout={{
                  height: 520,
                  margin: { t: 10, l: 0, r: 0, b: 0 },
                  paper_bgcolor: "transparent",
                  scene: {
                    xaxis: { title: `${resolvedCategory} / Group` },
                    yaxis: { title: "State / Region" },
                    zaxis: { title: "Forecast Value" },
                  },
                }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl p-4">
            <p className="text-xs text-muted uppercase tracking-wider mb-3">3D Forecast Accuracy vs Value</p>
            <Plot
              data={[
                {
                  x: topForecasts.map((f) => String(f.sku_id || "SKU")),
                  y: topForecasts.map((f) => Number(((f.mape ?? 0) * 100).toFixed(2))),
                  z: topForecasts.map((f) => Number((f.forecast_value ?? 0).toFixed(2))),
                  text: topForecasts.map((f) => `${f.sku_id || "SKU"} · ${f.state || "Region"} · ${f.model_used || "model"}`),
                  type: "scatter3d",
                  mode: "markers",
                  marker: {
                    size: 6,
                    color: topForecasts.map((f) => f.model_used || "unknown"),
                  },
                  hovertemplate:
                    "<b>%{text}</b><br>Category: %{x}<br>MAPE: %{y:.2f}%<br>Forecast: %{z:,.0f}<extra></extra>",
                } as any,
              ]}
              layout={{
                height: 560,
                margin: { t: 10, l: 0, r: 0, b: 0 },
                paper_bgcolor: "transparent",
                scene: {
                  xaxis: { title: `${resolvedCategory}` },
                  yaxis: { title: "MAPE (%)" },
                  zaxis: { title: "Forecast Value" },
                },
              }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: "100%" }}
            />
          </div>

          <div className="grid grid-cols-1 gap-5">
            <div className="bg-surface border border-border rounded-xl p-4">
              <p className="text-xs text-muted uppercase tracking-wider mb-3">Top Segment Sizes by {resolvedCategory}</p>
              <Plot
                data={[
                  {
                    x: topSegments.map((s) => s.persona_name ?? "segment"),
                    y: topSegments.map((s) => s.size ?? 0),
                    type: "bar",
                    marker: { color: topSegments.map((s) => s.color || "#E8FF47") },
                    hovertemplate: "<b>%{x}</b><br>Customers: %{y:,}<extra></extra>",
                  },
                ]}
                layout={{
                  height: 460,
                  margin: { t: 10, l: 70, r: 20, b: 80 },
                  paper_bgcolor: "transparent",
                  xaxis: { tickangle: -20 },
                }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            </div>

            <div className="bg-surface border border-border rounded-xl p-4">
              <p className="text-xs text-muted uppercase tracking-wider mb-3">Top Forecast Values</p>
              <Plot
                data={[
                  {
                    x: topForecasts.map((f) => `${f.sku_id || "sku"} · ${f.state || "region"}`),
                    y: topForecasts.map((f) => f.forecast_value ?? 0),
                    type: "scatter",
                    mode: "lines+markers",
                    line: { color: "#E8FF47", width: 3 },
                    marker: { size: 8, color: "#D4A017" },
                    hovertemplate: "<b>%{x}</b><br>Forecast: %{y:,.0f}<extra></extra>",
                  },
                ]}
                layout={{
                  height: 460,
                  margin: { t: 10, l: 70, r: 20, b: 95 },
                  paper_bgcolor: "transparent",
                  xaxis: { tickangle: -25 },
                }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl px-5 py-4">
            <p className="text-xs text-muted uppercase tracking-wider">Data Summary</p>
            <p className="text-sm text-subtle mt-1">
              Segments: <span className="mono">{segments.length.toLocaleString(NUMBER_LOCALE)}</span> · Forecast rows:{" "}
              <span className="mono">{forecasts.length.toLocaleString(NUMBER_LOCALE)}</span>
            </p>
          </div>
        </>
      )}
    </div>
  );
}
