"use client";

import { useEffect, useState } from "react";

interface Alert {
  id: string;
  metric: string;
  ks_stat: number;
  direction: string;
  diagnosis: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function AlertFeed({ runId }: { runId: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    const es = new EventSource(`${API_URL}/sse/alerts`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "anomaly_alert" && data.run_id === runId) {
          setAlerts((prev) => [{ ...data, id: `${Date.now()}` }, ...prev].slice(0, 20));
        }
      } catch {}
    };
    return () => es.close();
  }, [runId]);

  return (
    <div>
      <div className="text-[10px] text-text-3 uppercase tracking-[0.08em] mb-2">ANOMALIES</div>
      {alerts.length === 0 && (
        <div className="text-xs text-text-3 text-center border border-dashed border-border rounded-[10px] py-4">
          No anomalies detected
        </div>
      )}
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="rounded-[10px] border p-[10px_12px] mb-1.5"
          style={{ background: "var(--surface)", borderColor: "var(--border)", borderLeft: "2px solid var(--red)" }}
        >
          <div className="flex items-center justify-between text-[13px] text-text-1">
            <span>{alert.metric} {alert.direction === "down" ? "↓" : "↑"}</span>
            <button className="text-text-3 hover:text-text-1" onClick={() => setAlerts((p) => p.filter((a) => a.id !== alert.id))}>×</button>
          </div>
          <div className="mt-1">
            <div className="h-1 rounded" style={{ background: "var(--surface-3)" }}>
              <div className="h-1 rounded" style={{ background: "var(--red)", width: `${Math.min(alert.ks_stat * 100, 100)}%` }} />
            </div>
            <div className="mono text-[10px] text-text-3 mt-1">KS {alert.ks_stat.toFixed(3)}</div>
          </div>
          <div className="text-[11px] text-text-2 mt-1">{alert.diagnosis}</div>
          <div className="mt-1.5 flex gap-1.5">
            {alert.ks_stat > 0.3 && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(126,184,164,0.15)", color: "var(--teal)" }}>Slack sent</span>}
            {alert.ks_stat > 0.6 && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(232,149,109,0.15)", color: "var(--accent)" }}>Email sent</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
