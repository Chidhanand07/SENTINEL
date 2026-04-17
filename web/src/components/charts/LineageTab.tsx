"use client";

import { useState, useEffect } from "react";
import { RunManifest } from "@/lib/manifest";
import { DEMO_LINEAGE, DEMO_QUALITY } from "@/lib/demo-data";

interface LineageStep {
  step_order: number;
  agent: string;
  transformation: string;
  rows_in: number;
  rows_out: number;
  duration_ms: number;
}

interface QualityMetrics {
  completeness: number;
  duplicate_rate: number;
  outlier_count: number;
  schema_coverage?: number;
}

export function LineageTab({ runId, manifest }: { runId: string, manifest: RunManifest | null }) {
  const schema = manifest?.detected_schema ?? null;
  const NUMBER_LOCALE = "en-US";
  const [lineage, setLineage] = useState<LineageStep[]>(DEMO_LINEAGE);
  const [quality, setQuality] = useState<QualityMetrics>(DEMO_QUALITY);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<LineageStep | null>(null);
  const [dataSource, setDataSource] = useState<"demo" | "live">("demo");

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    if (!runId) return;
    setLineage(DEMO_LINEAGE);
    setQuality(DEMO_QUALITY);
    setDataSource("demo");

    fetch(`${API_URL}/lineage/${runId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        // API returns { steps: [...], quality: {...} } shape
        const steps = Array.isArray(data.steps) ? data.steps : (Array.isArray(data) ? data : []);
        const qual = data.quality ?? null;
        if (steps.length > 0) {
          setLineage(steps);
          if (qual) setQuality(qual);
          setDataSource("live");
        }
      })
      .catch(err => console.warn("[LineageTab] Fetch failed:", err));
  }, [runId]);

  const filtered = lineage.filter(l =>
    l.agent.toLowerCase().includes(filter.toLowerCase()) ||
    l.transformation.toLowerCase().includes(filter.toLowerCase())
  );

  const LAYER_COLORS: Record<string, string> = {
    n8n: "#7eb8a4",
    langgraph: "#9b8ec4",
    langchain: "#e8956d",
  };

  const getColor = (agent: string) => {
    const a = agent.toLowerCase();
    if (a.includes("n8n")) return LAYER_COLORS.n8n;
    if (a.includes("langgraph") || a.includes("node")) return LAYER_COLORS.langgraph;
    return LAYER_COLORS.langchain;
  };

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Quality scorecard */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-surface border border-border rounded-[10px] p-4">
          <p className="text-xs text-muted uppercase tracking-wide mb-1">Completeness</p>
          <p className="text-2xl font-medium tabular-nums mono" style={{ color: quality.completeness > 95 ? "#1A7A45" : "#D4A017" }}>
            {quality.completeness.toFixed(1)}%
          </p>
        </div>
        <div className="bg-surface border border-border rounded-[10px] p-4">
          <p className="text-xs text-muted uppercase tracking-wide mb-1">Duplicate rate</p>
          <p className="text-2xl font-medium tabular-nums mono" style={{ color: quality.duplicate_rate < 1 ? "#1A7A45" : "#C0392B" }}>
            {quality.duplicate_rate.toFixed(2)}%
          </p>
        </div>
        <div className="bg-surface border border-border rounded-[10px] p-4">
          <p className="text-xs text-muted uppercase tracking-wide mb-1">Outliers</p>
          <p className="text-2xl font-medium tabular-nums text-subtle">
            {quality.outlier_count.toLocaleString(NUMBER_LOCALE)}
          </p>
        </div>
        <div className="bg-surface border border-border rounded-[10px] p-4">
          <p className="text-xs text-muted uppercase tracking-wide mb-1">Schema coverage</p>
          <p className="text-2xl font-medium tabular-nums mono" style={{ color: (quality.schema_coverage ?? 100) === 100 ? "#1A7A45" : "#D4A017" }}>
            {(quality.schema_coverage ?? 100).toFixed(0)}%
          </p>
        </div>
      </div>

      {/* Transformation log table */}
      <div className="bg-surface border border-border rounded-xl p-4 overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-muted uppercase tracking-wide font-medium">Transformation log</p>
          <input
            type="text"
            placeholder="Filter by agent or transformation..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="text-xs px-3 py-1.5 bg-surface border border-border rounded-lg text-subtle placeholder:text-muted focus:outline-none focus:border-accent w-72"
          />
        </div>
        <div className="overflow-auto max-h-96">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border sticky top-0 bg-surface">
                <th className="text-left py-2 px-3 text-muted font-medium">Step</th>
                <th className="text-left py-2 px-3 text-muted font-medium">Agent</th>
                <th className="text-left py-2 px-3 text-muted font-medium">Transformation</th>
                <th className="text-right py-2 px-3 text-muted font-medium">Rows in</th>
                <th className="text-right py-2 px-3 text-muted font-medium">Rows out</th>
                <th className="text-right py-2 px-3 text-muted font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={i}
                    onClick={() => setSelected(row)}
                    className="border-b border-border cursor-pointer hover:bg-surface/50 transition-colors">
                  <td className="py-2 px-3 text-subtle">{row.step_order}</td>
                  <td className="py-2 px-3">
                    <span className="px-2 py-0.5 rounded-full text-xs"
                          style={{ background: getColor(row.agent) + "20", color: getColor(row.agent) }}>
                      {row.agent}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-muted max-w-xs truncate">{row.transformation}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-subtle">{row.rows_in.toLocaleString(NUMBER_LOCALE)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-subtle">{row.rows_out.toLocaleString(NUMBER_LOCALE)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-muted">{row.duration_ms.toLocaleString(NUMBER_LOCALE)}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Details panel */}
      {selected && (
        <div className="bg-surface border border-border rounded-xl p-4">
          <p className="text-sm font-medium text-subtle mb-4">Selected: {selected.agent}</p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted mb-1">Transformation</p>
              <p className="text-sm text-subtle">{selected.transformation}</p>
            </div>
            <div>
              <p className="text-xs text-muted mb-1">Row delta</p>
              <p className="text-sm tabular-nums text-subtle">{(selected.rows_out - selected.rows_in > 0 ? "+" : "") + (selected.rows_out - selected.rows_in).toLocaleString(NUMBER_LOCALE)}</p>
            </div>
            <div>
              <p className="text-xs text-muted mb-1">Duration</p>
              <p className="text-sm tabular-nums text-subtle">{selected.duration_ms.toLocaleString(NUMBER_LOCALE)}ms</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
