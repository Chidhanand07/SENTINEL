import { create } from "zustand";

export interface AgentEvent {
  run_id: string;
  node: string;
  status: string;
  layer: "n8n" | "langgraph" | "langchain";
  tool_called?: string;
  reasoning?: string;
  rows_in?: number;
  rows_out?: number;
  latency_ms?: number;
  artifact_key?: string;
  ts: string;
  [key: string]: unknown;
}

interface RunStore {
  runId: string | null;
  events: AgentEvent[];
  setRunId: (id: string) => void;
  addEvent: (event: AgentEvent) => void;
  clearEvents: () => void;
}

export const useRunStore = create<RunStore>((set) => ({
  runId: null,
  events: [],
  setRunId: (id) => set({ runId: id }),
  addEvent: (event) =>
    set((state) => ({
      events: state.events.some(
        (e) =>
          e.ts === event.ts &&
          e.node === event.node &&
          e.status === event.status &&
          e.layer === event.layer
      )
        ? state.events
        : [...state.events.slice(-300), event],
    })),
  clearEvents: () => set({ events: [] }),
}));

// Active node derived from events
export function getActiveNode(events: AgentEvent[]): string | null {
  const langgraphEvents = events.filter((e) => e.layer === "langgraph");
  const started = langgraphEvents.filter((e) => e.status === "started");
  const completed = new Set(
    langgraphEvents.filter((e) => e.status === "completed").map((e) => e.node)
  );
  const activeNode = started.find((e) => !completed.has(e.node));
  return activeNode?.node || null;
}

export function getCompletedNodes(events: AgentEvent[]): Set<string> {
  return new Set(
    events.filter((e) => e.layer === "langgraph" && e.status === "completed").map((e) => e.node)
  );
}
