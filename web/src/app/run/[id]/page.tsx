"use client";

import { useEffect, useRef } from "react";
import { AgentFeed } from "@/components/pipeline/AgentFeed";
import { MermaidDag } from "@/components/pipeline/MermaidDag";
import { PipelineStepper } from "@/components/pipeline/PipelineStepper";
import { AlertFeed } from "@/components/pipeline/AlertFeed";
import { FeedbackPanel } from "@/components/pipeline/FeedbackPanel";
import { DashboardTabs } from "@/components/charts/DashboardTabs";
import { useRunStore } from "@/lib/store";
import { ManifestProvider } from "@/lib/manifest-context";

export default function RunPage({ params }: { params: { id: string } }) {
  const { id: runId } = params;
  const { events, addEvent, setRunId, clearEvents } = useRunStore();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    clearEvents();
    setRunId(runId);
    const wsBase = process.env.NEXT_PUBLIC_WS_URL
      || process.env.NEXT_PUBLIC_API_URL?.replace(/^http/, "ws")
      || (typeof window !== "undefined" ? window.location.origin.replace(/^http/, "ws") : "ws://localhost:8000");
    const wsUrl = `${wsBase}/ws/pipeline/${runId}`;

    let retryDelay = 1000;
    let mounted = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function pollEvents() {
      try {
        const res = await fetch(`/api/events/${runId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data?.events) ? data.events : [];
        list.forEach((e) => addEvent(e));
      } catch {}
    }

    function connect() {
      if (!mounted) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try { addEvent(JSON.parse(e.data)); } catch {}
      };

      ws.onclose = () => {
        if (!mounted) return;
        if (!pollTimer) {
          pollTimer = setInterval(pollEvents, 5000);
        }
        setTimeout(connect, retryDelay + Math.random() * 500);
        retryDelay = Math.min(retryDelay * 1.5, 30000);
      };

      ws.onopen = () => {
        retryDelay = 1000;
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };
    }

    pollEvents();
    connect();
    return () => {
      mounted = false;
      wsRef.current?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [runId, addEvent, setRunId, clearEvents]);

  return (
    <div className="h-[calc(100vh-44px)] flex overflow-hidden bg-bg">
      <div className="w-[260px] flex flex-col border-r border-border overflow-hidden">
        <div className="hidden">
          <MermaidDag events={events} runId={runId} />
        </div>
        <AgentFeed events={events} />
        <FeedbackPanel runId={runId} />
      </div>

      <div className="flex-1 overflow-auto bg-bg">
        <ManifestProvider runId={runId}>
          <DashboardTabs runId={runId} />
        </ManifestProvider>
      </div>

      <div className="w-[260px] flex flex-col border-l border-border overflow-hidden">
        <div className="border-b border-border">
          <PipelineStepper events={events} />
        </div>
        <div className="flex-1 overflow-auto p-4">
          <AlertFeed runId={runId} />
        </div>
      </div>
    </div>
  );
}
