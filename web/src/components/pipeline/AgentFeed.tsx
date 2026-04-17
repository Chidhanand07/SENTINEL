"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { type AgentEvent } from "@/lib/store";

const LAYER_COLORS: Record<string, string> = {
  n8n: "var(--teal)",
  langgraph: "var(--purple)",
  langchain: "var(--accent)",
};

export function AgentFeed({ events }: { events: AgentEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [openTrace, setOpenTrace] = useState<Record<string, boolean>>({});
  const latestByNode = new Map<string, AgentEvent>();

  for (const event of events) {
    const node = event.node ?? "event";
    latestByNode.set(node, event);
  }
  const displayEvents = Array.from(latestByNode.values());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="text-[10px] text-text-2 uppercase tracking-[0.08em] px-3 pt-3 pb-2 border-b border-border">AGENT TRACE</div>
      <div className="px-3 pb-2">
        {displayEvents.length === 0 && (
          <div className="rounded-[10px] border border-border bg-surface p-3 mt-2">
            <p className="text-xs text-text-3">Waiting for pipeline events...</p>
          </div>
        )}
        {displayEvents.map((event, i) => {
          const key = `${event.ts ?? i}-${event.node ?? "node"}`;
          const layer = (event.layer ?? "langgraph").toLowerCase();
          const color = LAYER_COLORS[layer] ?? "var(--purple)";
          const isRunning = event.status === "running" || event.status === "started";
          const isComplete = ["complete", "completed", "done"].includes(event.status ?? "");
          const isError = event.status === "error";

          return (
            <div
              key={key}
              className="rounded-[10px] border p-[10px_12px] mb-1.5 animate-fade-in"
              style={{ background: "var(--surface)", borderColor: "var(--border)", borderLeft: `2px solid ${color}` }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ color, background: `${color}25` }}>
                  {layer}
                </span>
                <span className="text-xs text-text-1 truncate flex-1">{event.node ?? "event"}</span>
                {isRunning && <Loader2 className="w-3 h-3 animate-spin text-accent" />}
                {isComplete && <CheckCircle2 className="w-3 h-3 text-green" />}
                {isError && <XCircle className="w-3 h-3 text-red" />}
              </div>

              {event.tool_called && <div className="mono text-[11px] text-text-3 mt-1">⚡ {event.tool_called}</div>}

              <div className="flex items-center mt-1 mono text-[11px] text-text-3">
                <span>{event.rows_in ?? 0} → {event.rows_out ?? 0} rows</span>
                <span className="ml-auto">{event.latency_ms ?? 0}ms</span>
              </div>

              {event.reasoning && (
                <div className="mt-1.5">
                  <button className="text-[11px] text-text-3" onClick={() => setOpenTrace((p) => ({ ...p, [key]: !p[key] }))}>
                    Trace {openTrace[key] ? "▴" : "▾"}
                  </button>
                  {openTrace[key] && <p className="text-xs text-text-2 leading-[1.5] mt-1">{event.reasoning}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}
