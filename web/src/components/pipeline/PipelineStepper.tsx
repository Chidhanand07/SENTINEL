"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface AgentEvent {
  node?: string;
  agent?: string;
  status?: string;
  layer?: string;
}

const STEPS = [
  { name: "n8n Upload", layer: "n8n", keys: ["upload", "n8n"] },
  { name: "Schema Join", layer: "langgraph", keys: ["schemajoin", "schema", "join"] },
  { name: "Profiler", layer: "langgraph", keys: ["profiler", "profile"] },
  { name: "Cleaning", layer: "langgraph", keys: ["cleaning", "clean"] },
  { name: "Feature Engineering", layer: "langgraph", keys: ["featureengineering", "feature"] },
  { name: "EDA", layer: "langgraph", keys: ["eda"] },
  { name: "Segmentation", layer: "langchain", keys: ["segmentation", "segment"] },
  { name: "Forecasting", layer: "langchain", keys: ["forecasting", "forecast"] },
  { name: "Narrator", layer: "langgraph", keys: ["narrator", "narrat"] },
];

const N8N_WORKFLOWS = [
  { id: "upload", name: "Upload Trigger", desc: "CSV received → pipeline queued", cron: false },
  { id: "refresh", name: "Nightly Refresh", desc: "Scheduled 02:00 UTC cron", cron: true },
  { id: "anomaly", name: "Anomaly Alert", desc: "Drift detected → Slack / email", cron: false },
  { id: "complete", name: "Run Complete", desc: "Pipeline done → notifications", cron: false },
  { id: "feedback", name: "Feedback Relay", desc: "Human constraint → LangGraph", cron: false },
];

const layerColor: Record<string, string> = { n8n: "var(--teal)", langgraph: "var(--purple)", langchain: "var(--accent)" };

function matchStep(nodeName: string): number {
  const normalized = nodeName.toLowerCase().replace(/[^a-z]/g, "");
  for (let i = 0; i < STEPS.length; i++) {
    if (STEPS[i].keys.some((k) => normalized.includes(k))) return i;
  }
  return -1;
}

export function PipelineStepper({ events }: { events: AgentEvent[] }) {
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [clock, setClock] = useState(Date.now());
  const firedMapRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!events.length) {
      setActiveStep(0);
      setCompletedSteps(new Set());
      return;
    }

    const completed = new Set<number>();
    let latest = 0;

    events.forEach((event, index) => {
      const node = (event.node ?? event.agent ?? "").toLowerCase();
      const stepIdx = matchStep(node);
      if (stepIdx >= 0) {
        if (["complete", "completed", "done"].includes((event.status ?? "").toLowerCase())) {
          completed.add(stepIdx);
          latest = Math.max(latest, Math.min(stepIdx + 1, STEPS.length - 1));
        } else if (["running", "started"].includes((event.status ?? "").toLowerCase())) {
          latest = Math.max(latest, stepIdx);
        }
      }

      if ((event.layer ?? "").toLowerCase() === "n8n") {
        if (index === 0) firedMapRef.current.upload = Date.now();
        N8N_WORKFLOWS.forEach((wf) => {
          if (node.includes(wf.id)) firedMapRef.current[wf.id] = Date.now();
        });
      }
    });

    setCompletedSteps(completed);
    setActiveStep(latest);
  }, [events]);

  const firedStates = useMemo(() => {
    const now = clock;
    return N8N_WORKFLOWS.map((wf) => {
      const firedAt = firedMapRef.current[wf.id];
      const ageSec = firedAt ? Math.floor((now - firedAt) / 1000) : null;
      const fired = ageSec !== null && ageSec <= 30;
      return { ...wf, fired, ageSec };
    });
  }, [clock]);

  return (
    <div className="p-3">
      <div className="text-[10px] text-text-3 uppercase tracking-[0.08em] pb-2">PIPELINE</div>
      {STEPS.map((step, i) => {
        const isComplete = completedSteps.has(i);
        const isActive = activeStep === i && !isComplete;
        return (
          <div key={step.name} className="flex gap-2.5">
            <div className="flex flex-col items-center">
              <div
                className={`w-4 h-4 rounded-full flex items-center justify-center ${isActive ? "step-active-ring" : ""}`}
                style={{
                  border: `1px solid ${isComplete || isActive ? "var(--accent)" : "var(--border)"}`,
                  background: isComplete ? "var(--accent)" : "transparent",
                }}
              >
                {isComplete && <span className="text-[9px]" style={{ color: "var(--bg)" }}>✓</span>}
              </div>
              {i < STEPS.length - 1 && (
                <div className="w-px min-h-5" style={{ background: isComplete ? "rgba(232,149,109,0.5)" : "var(--border)" }} />
              )}
            </div>
            <div className="pb-3">
              <div className="text-xs" style={{ color: isComplete || isActive ? "var(--text-1)" : "var(--text-3)" }}>{step.name}</div>
              <div className="text-[10px]" style={{ color: layerColor[step.layer] }}>[{step.layer}]</div>
            </div>
          </div>
        );
      })}

      <div className="text-[10px] text-text-3 uppercase tracking-[0.08em] pt-2 pb-2">N8N WORKFLOWS</div>
      <div className="space-y-1.5">
        {firedStates.map((wf) => (
          <div key={wf.id} className="flex items-center gap-2">
            <span
              className={`w-1.5 h-1.5 rounded-full ${wf.fired ? "animate-pulse-bg" : ""}`}
              style={{ background: wf.fired ? "var(--green)" : "var(--surface-3)" }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text-1">{wf.name}</div>
              <div className="text-[11px] text-text-3">{wf.desc}</div>
            </div>
            {wf.fired ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full border" style={{ background: "var(--accent-dim)", color: "var(--accent)", borderColor: "rgba(232,149,109,0.3)" }}>
                {wf.ageSec}s ago
              </span>
            ) : wf.cron ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(155,142,196,0.15)", color: "var(--purple)" }}>cron</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
