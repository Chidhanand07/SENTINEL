"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { Download, Users, DollarSign, RefreshCw } from "lucide-react";
import { RunManifest } from "@/lib/manifest";
import { DEMO_SEGMENTS } from "@/lib/demo-data";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const NUMBER_LOCALE = "en-US";

export function SegmentsTab({ runId, manifest }: { runId: string, manifest: RunManifest | null }) {
  const canSegment = manifest?.available_analyses?.can_segment ?? true;
  const canRfm = manifest?.available_analyses?.can_rfm ?? true;
  const schema = manifest?.detected_schema ?? null;
  const isDemoMode = runId?.startsWith("demo-") ?? false;

  // Initialize with NULL (loading state), NOT demo data
  const [segments, setSegments] = useState<any[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dataSource, setDataSource] = useState<"demo" | "live" | "pending">("pending");
  const [loadingMessage, setLoadingMessage] = useState("Fetching segments from database...");

  // Fetch live data - ALWAYS try to fetch real data first
  useEffect(() => {
    if (!runId) return;
    
    const fetchSegments = async () => {
      setIsLoading(true);
      setDataSource("pending");
      setLoadingMessage("Fetching segments from database...");
      
      try {
        console.log(`[SegmentsTab] Fetching segments for ${runId}`);
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(`/api/segments/${runId}`, { signal: ctrl.signal });
        clearTimeout(timeout);
        
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        
        const data = await res.json();
        console.log(`[SegmentsTab] API returned ${data.length} segments`, data);
        
        if (Array.isArray(data) && data.length > 0) {
          setSegments(data);
          setDataSource("live");
        } else if (isDemoMode) {
          console.log("[SegmentsTab] Empty API result, using demo");
          setSegments(DEMO_SEGMENTS);
          setDataSource("demo");
        } else {
          console.warn("[SegmentsTab] Empty API result for non-demo run");
          setSegments([]);
          setDataSource("live");
        }
      } catch (err) {
        console.error("[SegmentsTab] Fetch error:", err);
        if (isDemoMode) {
          setSegments(DEMO_SEGMENTS);
          setDataSource("demo");
        } else {
          setSegments([]);
          setDataSource("live");
        }
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchSegments();
    
    // Polling: Re-fetch every 2 seconds while data is empty
    let pollInterval: NodeJS.Timeout | null = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 30;
    const checkEmpty = async () => {
      attempts += 1;
      try {
        const [segRes, runRes] = await Promise.all([
          fetch(`/api/segments/${runId}`),
          fetch(`/api/run/${runId}`),
        ]);
        const runJson = runRes.ok ? await runRes.json() : { status: "unknown" };
        if (runJson?.status === "failed") {
          setLoadingMessage("Pipeline failed before segmentation completed.");
          setSegments([]);
          setIsLoading(false);
          if (pollInterval) clearInterval(pollInterval);
          return;
        }
        if (segRes.ok) {
          const data = await segRes.json();
          if (data.length > 0) {
            console.log("[SegmentsTab] Poll detected data, updating");
            setSegments(data);
            setDataSource("live");
            setIsLoading(false);
            if (pollInterval) clearInterval(pollInterval);
            return;
          }
        }
        if (runJson?.status === "completed" || attempts >= MAX_ATTEMPTS) {
          setLoadingMessage("No segment results were produced for this run.");
          setSegments([]);
          setIsLoading(false);
          if (pollInterval) clearInterval(pollInterval);
        }
      } catch {}
    };
    
    if (!isDemoMode) {
      pollInterval = setInterval(checkEmpty, 2000);
    }
    
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [runId, isDemoMode]);

  if (!canSegment) {
    return (
      <div className="animate-fade-in">
        <div className="w-full bg-surface border border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted">Segmentation analysis is not available for this dataset.</p>
          <p className="text-xs text-muted mt-2">Ensure your data includes customer identifiers and transaction history.</p>
        </div>
      </div>
    );
  }

  if (isLoading || segments === null) {
    return (
      <div className="animate-fade-in">
        <div className="w-full bg-surface border border-border rounded-xl p-8 text-center">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-border border-t-accent"></div>
          <p className="text-sm text-muted mt-4">{loadingMessage}</p>
          <p className="text-xs text-muted mt-1">(Source: {dataSource})</p>
        </div>
      </div>
    );
  }

  if (!isLoading && segments.length === 0 && !isDemoMode) {
    return (
      <div className="animate-fade-in">
        <div className="w-full bg-surface border border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted">No segments available yet. Pipeline may still be processing...</p>
          <p className="text-xs text-muted mt-2">Check back in a few moments or refresh the page.</p>
        </div>
      </div>
    );
  }

  if (!canSegment) {
    return (
      <div className="animate-fade-in">
        <div className="w-full bg-surface border border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted">Segmentation analysis is not available for this dataset.</p>
          <p className="text-xs text-muted mt-2">Ensure your data includes customer identifiers and transaction history.</p>
        </div>
      </div>
    );
  }

  const safeSegments = segments
    .filter((s: any) => s && (typeof s.name === "string" || typeof s.persona_name === "string"))
    .map((seg: any) => {
      // API returns avg_recency, avg_frequency — use those as scatter centre points
      const recency = seg.avg_recency ?? seg.recency ?? seg.axes?.[0]?.value ?? 0;
      const frequency = seg.avg_frequency ?? seg.frequency ?? seg.axes?.[1]?.value ?? 0;
      const value = seg.avg_ltv ?? seg.primary_metric?.value ?? 0;
      return {
        id: seg.id ?? `seg-${seg.segment_id ?? seg.cluster_id}`,
        name: seg.name ?? seg.persona_name ?? "Segment",
        persona_name: seg.persona_name ?? seg.name ?? "Segment",
        size: seg.size ?? seg.customer_count ?? 0,
        customer_count: seg.customer_count ?? seg.size ?? 0,
        cluster_id: seg.cluster_id ?? seg.segment_id ?? 0,
        avg_ltv: value,
        traits: Array.isArray(seg.traits) ? seg.traits : [],
        recommended_action: seg.recommended_action ?? seg.action ?? "",
        color: seg.color ?? "#E8FF47",
        // Build scatter_data from real API fields so the plots show meaningful data
        scatter_data: seg.scatter_data ?? { x: [], y: [], z: [], recency, frequency, value },
      };
    });

  const totalCustomers = safeSegments.reduce((s: number, seg: any) => s + (seg.size ?? 0), 0);

  const downloadSegmentCsv = (segment: any) => {
    const headers = ["Field", "Value"];
    const rows = [
      ["Segment Name", segment.persona_name],
      ["Size", (segment.size ?? 0).toString()],
      ["Avg LTV", (segment.avg_ltv ?? 0).toFixed(2)],
      ["Traits", (segment.traits ?? []).join("; ")],
      ["Recommendation", segment.recommended_action ?? "N/A"],
    ];

    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${segment.persona_name.toLowerCase().replace(/\s+/g, "-")}_segment.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 gap-4">
        {safeSegments.map((seg: any, i: number) => (
          <motion.div
            key={seg.cluster_id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            whileHover={{ scale: 1.01 }}
            className="bg-surface border border-border rounded-[10px] p-5 relative overflow-hidden transition-transform"
            style={{ borderLeftColor: seg.color, borderLeftWidth: 4 }}
          >
            {/* Background glow */}
            <div
              className="absolute inset-0 opacity-5"
              style={{ background: `radial-gradient(circle at 0 50%, ${seg.color}, transparent 60%)` }}
            />

            <div className="relative">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-medium text-[15px] text-text-1">
                    {seg.persona_name}
                  </h3>
                  <div className="flex items-center gap-3 mt-1 text-sm text-muted">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {(seg.size ?? 0).toLocaleString(NUMBER_LOCALE)}
                    </span>
                    <span className="flex items-center gap-1">
                      <DollarSign className="w-3 h-3" />
                      {seg.avg_ltv ? `$${seg.avg_ltv?.toFixed(0)}` : "N/A"}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => downloadSegmentCsv(seg)}
                  className="text-xs text-muted hover:text-subtle border border-border rounded-lg px-2 py-1 flex items-center gap-1 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  CSV
                </button>
              </div>

              {/* Stat rows */}
              {canRfm && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-bg/50 rounded-lg p-2 text-center">
                    <div className="text-xs text-muted">Avg recency (days)</div>
                    <div className="text-sm font-bold mono" style={{ color: seg.color }}>
                      {seg.scatter_data?.recency != null ? Number(seg.scatter_data.recency).toFixed(0) : "N/A"}
                    </div>
                  </div>
                  <div className="bg-bg/50 rounded-lg p-2 text-center">
                    <div className="text-xs text-muted">Avg purchase frequency</div>
                    <div className="text-sm font-bold mono" style={{ color: seg.color }}>
                      {seg.scatter_data?.frequency != null ? Number(seg.scatter_data.frequency).toFixed(1) : "N/A"}
                    </div>
                  </div>
                </div>
              )}

              {/* Traits */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {(seg.traits || []).map((t: string) => (
                  <span
                    key={t}
                    className="text-xs px-2 py-0.5 rounded-full border"
                    style={{ borderColor: seg.color + "40", color: seg.color, background: seg.color + "10" }}
                  >
                    {t}
                  </span>
                ))}
              </div>

              {/* Action */}
              <div className="flex items-start gap-2 text-xs">
                <RefreshCw className="w-3 h-3 text-green flex-shrink-0 mt-0.5" />
                <span className="text-subtle">{seg.recommended_action}</span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Donut + Scatter row */}
      <div className="grid grid-cols-1 gap-4">
        <div className="bg-surface rounded-[10px] border border-border p-4">
          <h3 className="text-sm font-medium text-subtle mb-3">Segment Size Distribution</h3>
          <Plot
            data={[
              {
                values: safeSegments.map((s: any) => s.size ?? 0),
                labels: safeSegments.map((s: any) => s.persona_name ?? "Segment"),
                type: "pie",
                hole: 0.55,
                marker: { colors: safeSegments.map((s: any) => s.color ?? "#E8FF47") },
                textinfo: "percent",
                hovertemplate: "<b>%{label}</b><br>%{value:,} customers<br>%{percent}<extra></extra>",
              },
            ]}
            layout={{
              paper_bgcolor: "transparent",
              height: 220,
              margin: { t: 10, b: 10, l: 10, r: 10 },
              showlegend: false,
              annotations: [
                {
                  text: `${totalCustomers.toLocaleString(NUMBER_LOCALE)}<br><span style="font-size:10px;color:#5c5650">total</span>`,
                  showarrow: false,
                  x: 0.5,
                  y: 0.5,
                  font: { size: 16, color: "#f0ebe4" },
                },
              ],
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </div>

        <div className="bg-surface rounded-[10px] border border-border p-4">
          <h3 className="text-sm font-medium text-subtle mb-3">
            {canRfm ? "RFM Scatter (3D)" : "Segment Scatter (2D)"}
          </h3>
          {canRfm ? (
            <Plot
              data={safeSegments.map((seg: any) => {
                const points = Math.min(seg.size ?? 0, 50);
                return {
                  x: Array.from({ length: points }, () => seg.scatter_data?.recency + (Math.random() - 0.5) * 20),
                  y: Array.from({ length: points }, () => seg.scatter_data?.frequency + (Math.random() - 0.5) * 2),
                  z: Array.from({ length: points }, () => seg.scatter_data?.value + (Math.random() - 0.5) * seg.scatter_data?.value * 0.3),
                  mode: "markers",
                  type: "scatter3d",
                  name: seg.persona_name,
                  marker: { color: seg.color, size: 4, opacity: 0.8 },
                  hovertemplate: `Recency (days): %{x:.0f}<br>Frequency: %{y:.1f}<br>Avg value: $%{z:.0f}<extra></extra>`,
                } as any;
              })}
              layout={{
                paper_bgcolor: "transparent",
                plot_bgcolor: "transparent",
                height: 260,
                margin: { t: 0, l: 0, r: 0, b: 0 },
                font: { color: "#94a3b8", size: 10 },
                scene: {
                  xaxis: { title: { text: "Recency (days)" }, gridcolor: "#1e293b", backgroundcolor: "transparent", showbackground: false },
                  yaxis: { title: { text: "Frequency" }, gridcolor: "#1e293b", backgroundcolor: "transparent", showbackground: false },
                  zaxis: { title: { text: "Average value" }, gridcolor: "#1e293b", backgroundcolor: "transparent", showbackground: false },
                },
                legend: { font: { size: 10, color: "#e2e8f0" }, x: 0, y: 1 },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%" }}
            />
          ) : (
            <Plot
              data={safeSegments.map((seg: any) => {
                const points = Math.min(seg.size ?? 0, 50);
                return {
                  x: Array.from({ length: points }, () => seg.scatter_data?.recency + (Math.random() - 0.5) * 20),
                  y: Array.from({ length: points }, () => seg.scatter_data?.value + (Math.random() - 0.5) * seg.scatter_data?.value * 0.3),
                  mode: "markers",
                  type: "scatter",
                  name: seg.persona_name,
                  marker: { color: seg.color, size: 6, opacity: 0.8 },
                  hovertemplate: "%{x:.0f}<br>%{y:.0f}<extra></extra>",
                } as any;
              })}
              layout={{
                paper_bgcolor: "transparent",
                plot_bgcolor: "transparent",
                height: 260,
                margin: { t: 10, l: 30, r: 10, b: 30 },
                font: { color: "#94a3b8", size: 10 },
                xaxis: { title: { text: manifest?.detected_schema?.date_col || "Feature 1" }, gridcolor: "#1e293b" },
                yaxis: { title: { text: manifest?.detected_schema?.revenue_col || "Feature 2" }, gridcolor: "#1e293b" },
                legend: { font: { size: 10, color: "#e2e8f0" }, orientation: "h", y: -0.2 },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
