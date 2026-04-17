"use client";

import { type AgentEvent } from "@/lib/store";
import { CheckCircle, Circle, Clock, GitBranch } from "lucide-react";

const WORKFLOWS = [
  { id: "wf1", name: "Upload Trigger",  desc: "CSV received → pipeline queued" },
  { id: "wf2", name: "Nightly Refresh", desc: "Scheduled 02:00 UTC cron" },
  { id: "wf3", name: "Anomaly Alert",   desc: "Drift detected → Slack/email" },
  { id: "wf4", name: "Run Complete",    desc: "Pipeline done → notifications" },
  { id: "wf5", name: "Feedback Relay",  desc: "Human constraint → LangGraph" },
];

function detectFired(events: AgentEvent[]): { fired: Set<string>; scheduled: Set<string> } {
  const fired = new Set<string>();
  const scheduled = new Set<string>(["wf2"]); // nightly is always scheduled, never "fired" during a live run

  for (const e of events) {
    const node = (e.node ?? "").toLowerCase();
    const status = (e.status ?? "").toLowerCase();
    const layer = (e.layer ?? "").toLowerCase();
    const reasoning = (e.reasoning ?? "").toLowerCase();

    // wf1 — Upload Trigger: any event at all means upload happened
    if (events.length > 0) fired.add("wf1");

    // wf3 — Anomaly Alert: n8n layer events mentioning alert/anomaly
    if (layer === "n8n" && (reasoning.includes("alert") || reasoning.includes("anomaly") || node.includes("alert"))) {
      fired.add("wf3");
    }

    // wf4 — Run Complete: narrator fires the run-complete webhook
    if (
      layer === "n8n" &&
      (status === "n8n_webhook" || reasoning.includes("run-complete") || reasoning.includes("notification"))
    ) {
      fired.add("wf4");
    }

    // wf5 — Feedback Relay: human_feedback events
    if (
      status === "human_feedback" ||
      node.includes("feedback") ||
      reasoning.includes("human constraint") ||
      reasoning.includes("feedback")
    ) {
      fired.add("wf5");
    }
  }

  return { fired, scheduled };
}

export function N8nStatus({ events }: { events: AgentEvent[] }) {
  const { fired, scheduled } = detectFired(events);

  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-muted uppercase tracking-widest mb-3 font-medium">
        <GitBranch className="w-3 h-3 text-teal" />
        n8n Workflows
      </div>
      <div className="space-y-2">
        {WORKFLOWS.map((wf) => {
          const isFired = fired.has(wf.id);
          const isScheduled = scheduled.has(wf.id) && !isFired;

          return (
            <div key={wf.id} className="flex items-start gap-2">
              {isFired ? (
                <CheckCircle className="w-3.5 h-3.5 text-teal flex-shrink-0 mt-0.5" />
              ) : isScheduled ? (
                <Clock className="w-3.5 h-3.5 text-muted flex-shrink-0 mt-0.5" />
              ) : (
                <Circle className="w-3.5 h-3.5 text-border flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-medium ${isFired ? "text-subtle" : "text-muted"}`}>
                    {wf.name}
                  </span>
                  {isFired && (
                    <span className="text-[10px] text-teal bg-teal/10 px-1.5 py-0.5 rounded font-medium">
                      fired
                    </span>
                  )}
                  {isScheduled && (
                    <span className="text-[10px] text-muted bg-border/30 px-1.5 py-0.5 rounded">
                      cron
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted mt-0.5 truncate">{wf.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
