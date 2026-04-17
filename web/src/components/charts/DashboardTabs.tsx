"use client";

import { useMemo, useState, useEffect } from "react";
import { KpiTab } from "./KpiTab";
import { SegmentsTab } from "./SegmentsTab";
import { ChartTab } from "./ChartTab";
import { ForecastTab } from "./ForecastTab";
import { LineageTab } from "./LineageTab";
import { InsightsTab } from "./InsightsTab";
import { ChatTab } from "./ChatTab";
import { useManifest } from "@/lib/manifest-context";
import { DEMO_MANIFEST } from "@/lib/demo-data";

const ALL_TABS = [
  { id: "kpi",      label: "KPI" },
  { id: "segments", label: "Segments" },
  { id: "chart",    label: "Chart" },
  { id: "forecast", label: "Forecast" },
  { id: "lineage",  label: "Data Quality" },
  { id: "insights", label: "Brief" },
  { id: "chat",     label: "Chat" },
];

export function DashboardTabs({ runId }: { runId: string }) {
  const { manifest, loading } = useManifest();
  const [active, setActive] = useState("kpi");
  const [forceShow, setForceShow] = useState(false);
  const isDemoRun = runId?.startsWith("demo-") ?? false;

  // For demo runs only: force-show after 10s
  // For real runs: keep polling until manifest arrives (ManifestProvider handles its own 60s timeout)
  useEffect(() => {
    if (!isDemoRun) return; // real runs: wait for actual pipeline
    const timer = setTimeout(() => {
      if (loading) {
        console.warn("[tabs] Demo run — force-showing after 10s");
        setForceShow(true);
      }
    }, 10_000);
    return () => clearTimeout(timer);
  }, [loading, isDemoRun]);

  // Use real manifest; for demo runs also fall back to DEMO_MANIFEST
  const activeManifest = manifest ?? (forceShow && isDemoRun ? (DEMO_MANIFEST as any) : null);

  // Determine which tabs to show
  const availableTabs = useMemo(() => {
    if (!activeManifest?.detected_schema) {
      return ALL_TABS; // show all while loading
    }
    
    return ALL_TABS.filter(tab => {
      if (tab.id === "kpi" || tab.id === "lineage" || tab.id === "insights" || tab.id === "chat") return true;
      if (tab.id === "segments") return activeManifest.available_analyses?.can_segment;
      if (tab.id === "chart") return true;
      if (tab.id === "forecast") return activeManifest.available_analyses?.can_forecast;
      return false;
    });
  }, [activeManifest]);

  useEffect(() => {
    // If active tab becomes unavailable, fall back to kpi
    if (activeManifest?.detected_schema) {
      if (!availableTabs.find(t => t.id === active)) {
        setActive("kpi");
      }
    }
  }, [availableTabs, active, activeManifest]);

  if (!activeManifest) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-6">
        <div className="w-6 h-6 border-2 border-border2 border-t-accent rounded-full animate-spin" />
        <div className="text-center space-y-1">
          <p className="text-sm font-bold text-subtle uppercase tracking-wider">
            {isDemoRun ? "Preparing demo..." : "Pipeline running"}
          </p>
          <p className="text-xs text-muted">
            {isDemoRun
              ? "Loading demo dataset schema..."
              : "Joining tables → Profiling → Cleaning → EDA → Segmentation → Forecast"}
          </p>
        </div>
        {isDemoRun && (
          <button
            onClick={() => setForceShow(true)}
            className="text-xs text-accent underline underline-offset-2 hover:opacity-80 mt-2"
          >
            Skip — show demo dashboard now
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-border bg-bg sticky top-0 z-10 px-4 h-10 items-end">
        {availableTabs.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`
                px-3 py-2 text-[13px] transition-all whitespace-nowrap
                ${isActive
                  ? "text-text-1 border-b-2 border-accent -mb-px"
                  : "text-text-3 hover:text-text-2"}
              `}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-5">
        <div className={active === "kpi" ? "block" : "hidden"}>
          <KpiTab runId={runId} manifest={activeManifest} />
        </div>
        <div className={active === "segments" ? "block" : "hidden"}>
          <SegmentsTab runId={runId} manifest={activeManifest} />
        </div>
        <div className={active === "chart" ? "block" : "hidden"}>
          <ChartTab runId={runId} manifest={activeManifest} />
        </div>
        <div className={active === "forecast" ? "block" : "hidden"}>
          <ForecastTab runId={runId} manifest={activeManifest} />
        </div>
        <div className={active === "lineage" ? "block" : "hidden"}>
          <LineageTab runId={runId} manifest={activeManifest} />
        </div>
        <div className={active === "insights" ? "block" : "hidden"}>
          <InsightsTab runId={runId} manifest={activeManifest} setActiveTab={setActive} />
        </div>
        <div className={active === "chat" ? "block" : "hidden"}>
          <ChatTab runId={runId} manifest={activeManifest} />
        </div>
      </div>
    </div>
  );
}
