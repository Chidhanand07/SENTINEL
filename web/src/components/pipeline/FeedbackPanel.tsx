"use client";

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const NODES = ["CleaningNode", "ProfilerNode", "SegmentationNode", "ForecastNode", "NarratorNode"];

export function FeedbackPanel({ runId }: { runId: string }) {
  const [node, setNode] = useState("CleaningNode");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sent" | "sending">("idle");

  const handleSend = async () => {
    if (!message.trim() || status === "sending") return;
    setStatus("sending");
    try {
      const res = await fetch(`${API_URL}/feedback/${runId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inject_at: node, message: message.trim() }),
      });
      if (!res.ok) throw new Error("failed");
      setMessage("");
      setStatus("sent");
      setTimeout(() => setStatus("idle"), 800);
    } catch {
      setStatus("idle");
    }
  };

  return (
    <div className="p-3 border-t border-border">
      <div className="text-[10px] text-text-3 uppercase tracking-[0.08em] mb-2">INJECT CONSTRAINT</div>
      <select className="w-full mb-2" value={node} onChange={(e) => setNode(e.target.value)}>
        {NODES.map((n) => <option key={n}>{n}</option>)}
      </select>
      <textarea
        rows={2}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="e.g. exclude: review_score < 2"
        className="w-full resize-none text-text-1 placeholder:text-text-2"
      />
      <button
        onClick={handleSend}
        className="w-full mt-2 rounded-[6px] py-2 text-[13px] font-medium"
        style={{
          background: "var(--accent)",
          color: "var(--bg)",
          border: `1px solid ${status === "sent" ? "var(--green)" : "var(--border)"}`,
          opacity: status === "sending" ? 0.88 : 1,
        }}
      >
        Inject constraint →
      </button>
    </div>
  );
}
