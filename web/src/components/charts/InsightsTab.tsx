"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Download, ChevronRight, Sparkles, Target, TrendingUp, AlertTriangle, Loader2 } from "lucide-react";
import { RunManifest } from "@/lib/manifest";
import { DEMO_BRIEF } from "@/lib/demo-data";

type BriefReport = {
  summary: string;
  findings: string[];
  impact: string[];
  actions: string[];
  brief_source?: string;
};

function normalizeBrief(input: any): BriefReport {
  if (input && typeof input === "object" && Array.isArray(input.findings) && Array.isArray(input.impact) && Array.isArray(input.actions)) {
    return {
      summary: String(input.summary ?? ""),
      findings: input.findings.map((x: any) => String(x)),
      impact: input.impact.map((x: any) => String(x)),
      actions: input.actions.map((x: any) => String(x)),
      brief_source: input.brief_source,
    };
  }

  return {
    summary: String(input?.full_text ?? input?.insight_brief ?? ""),
    findings: [String(input?.what_we_found ?? "No clearly distinct customer groups were identified from the current dataset.")],
    impact: [String(input?.why_it_matters ?? "Current insight quality is too weak for high-confidence decisions.")],
    actions: Array.isArray(input?.recommended_actions) && input.recommended_actions.length > 0
      ? input.recommended_actions.map((x: any) => String(x))
      : ["Validate data completeness before taking major commercial decisions."],
    brief_source: input?.brief_source,
  };
}

export function InsightsTab({
  runId,
  manifest,
  setActiveTab
}: {
  runId: string,
  manifest: RunManifest | null,
  setActiveTab?: (tab: string) => void
}) {
  const isDemoRun = runId?.startsWith("demo-") ?? false;
  const [brief, setBrief] = useState<BriefReport | null>(isDemoRun ? normalizeBrief(DEMO_BRIEF) : null);
  const [loading, setLoading] = useState(!isDemoRun);
  const [showEvidence, setShowEvidence] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    if (!runId || isDemoRun) return;
    setLoading(true);

    const pollBrief = async () => {
      try {
        const res = await fetch(`/api/run/${runId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const ib = data?.insight_brief;

        if (ib && typeof ib === "object") {
          setBrief(normalizeBrief(ib));
          setLoading(false);
        } else if (ib && typeof ib === "string") {
          setBrief(normalizeBrief({ summary: ib, findings: [ib], impact: [], actions: [] }));
          setLoading(false);
        } else if (data?.status === "completed" || data?.status === "failed") {
          setLoading(false);
        } else {
          setTimeout(pollBrief, 5000);
        }
      } catch (err) {
        console.warn("[InsightsTab] Fetch failed:", (err as Error).message);
        setLoading(false);
      }
    };
    pollBrief();
  }, [runId, isDemoRun]);

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/report/${runId}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `report_${runId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error("PDF download failed:", error);
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5 max-w-3xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 py-4">
          <Loader2 className="w-4 h-4 text-accent animate-spin" />
          <span className="text-sm text-text-2 mono uppercase tracking-wider">Generating business brief...</span>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-[10px] bg-surface border border-border skeleton" />
        ))}
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <p className="text-sm text-text-2">Brief not yet available. Pipeline may still be running.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-text-1 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            Executive Business Brief
          </h2>
          <p className="text-xs text-text-3 mt-0.5 mono uppercase tracking-wider" style={{ fontSize: "10px", letterSpacing: "2px" }}>
            Decision-ready summary
          </p>
        </div>
        <button
          onClick={handleDownloadPdf}
          disabled={downloadingPdf}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-bg rounded-lg font-medium text-xs hover:opacity-90 disabled:opacity-50 transition-all uppercase tracking-wider"
        >
          {downloadingPdf ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Downloading...
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5" />
              Export PDF
            </>
          )}
        </button>
      </div>

      {brief.brief_source === "fallback" && (
        <div className="text-xs px-3 py-2 rounded-lg border inline-flex items-center gap-2" style={{ background: "rgba(196,168,74,0.12)", color: "var(--yellow)", borderColor: "var(--border)" }}>
          <span>⚠</span> Showing rule-based brief due to temporary generation issue
        </div>
      )}

      <div className="bg-surface border border-border rounded-[10px] p-6">
        <p className="text-sm text-text-2 leading-relaxed">{brief.summary || "No brief available."}</p>
      </div>

      <BriefSection
        icon={<TrendingUp className="w-4 h-4" />}
        title="What We Found"
        color="teal"
        evidenceKey="kpi"
        showEvidence={showEvidence}
        onToggleEvidence={setShowEvidence}
        onShowEvidence={() => {
          setShowEvidence(null);
          setActiveTab?.("kpi");
        }}
      >
        <ul className="space-y-2">
          {brief.findings.map((line, i) => <li key={i} className="text-sm text-text-2 leading-relaxed">• {line}</li>)}
        </ul>
      </BriefSection>

      <BriefSection
        icon={<AlertTriangle className="w-4 h-4" />}
        title="Why It Matters"
        color="purple"
        evidenceKey="segments"
        showEvidence={showEvidence}
        onToggleEvidence={setShowEvidence}
        onShowEvidence={() => {
          setShowEvidence(null);
          setActiveTab?.("segments");
        }}
      >
        <ul className="space-y-2">
          {brief.impact.map((line, i) => <li key={i} className="text-sm text-text-2 leading-relaxed">• {line}</li>)}
        </ul>
      </BriefSection>

      <BriefSection
        icon={<Target className="w-4 h-4" />}
        title="Recommended Actions"
        color="amber"
        evidenceKey="forecast"
        showEvidence={showEvidence}
        onToggleEvidence={setShowEvidence}
        onShowEvidence={() => {
          setShowEvidence(null);
          setActiveTab?.("forecast");
        }}
      >
        <ol className="space-y-3">
          {brief.actions.map((action: string, i: number) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.07 }}
              className="flex items-start gap-3"
            >
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-medium mt-0.5 mono">
                {i + 1}
              </span>
              <span className="text-sm text-text-2">{action}</span>
            </motion.li>
          ))}
        </ol>
      </BriefSection>
    </div>
  );
}

function BriefSection({
  icon,
  title,
  color,
  evidenceKey,
  showEvidence,
  onToggleEvidence,
  onShowEvidence,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  color: "teal" | "purple" | "amber";
  evidenceKey: string;
  showEvidence: string | null;
  onToggleEvidence: (key: string | null) => void;
  onShowEvidence: () => void;
  children: React.ReactNode;
}) {
  const colorMap = {
    teal: "border-teal/20 text-teal",
    purple: "border-purple/20 text-purple",
    amber: "border-accent/20 text-accent",
  };

  const isOpen = showEvidence === evidenceKey;

  return (
    <div className={`bg-surface border rounded-[10px] overflow-hidden ${colorMap[color]}`}>
      <div className="flex items-center justify-between p-5">
        <div className="flex items-center gap-3">
          {icon}
          <h3 className="font-medium text-sm">{title}</h3>
        </div>
        <button
          onClick={() => {
            isOpen ? onToggleEvidence(null) : onShowEvidence();
          }}
          className="text-xs text-text-3 hover:text-text-2 flex items-center gap-1 transition-colors"
        >
          Show evidence
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
        </button>
      </div>
      <div className="px-5 pb-5">{children}</div>
    </div>
  );
}
