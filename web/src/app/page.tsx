"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] },
});

export default function HomePage() {
  const router = useRouter();

  return (
    <div className="min-h-[calc(100vh-48px)] flex flex-col items-center justify-center relative overflow-hidden">
      {/* Subtle grid */}
      <div className="absolute inset-0 grid-bg opacity-60" />

      {/* Radial glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-accent/5 blur-[100px] rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-2xl mx-auto px-6 text-center">

        {/* Badge */}
        <motion.div {...fadeUp(0)} className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-card text-2xs text-muted mb-8 font-medium tracking-wide uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          SOLARIS X · Autonomous Analytics Track
        </motion.div>

        {/* Headline */}
        <motion.h1 {...fadeUp(0.05)} className="text-5xl sm:text-6xl font-bold tracking-tight mb-4 leading-[1.05]" style={{ letterSpacing: "0.02em" }}>
          <span className="text-hi">AUTONOMOUS</span>
          <br />
          <span className="gradient-text">ANALYTICS</span>
        </motion.h1>

        <motion.p {...fadeUp(0.1)} className="text-muted text-sm leading-relaxed mb-10 max-w-md mx-auto" style={{ letterSpacing: "0.5px" }}>
          Three tools. One pipeline. Upload any dataset and watch seven AI agents
          ingest, clean, engineer features, cluster, forecast, and brief — zero human intervention.
        </motion.p>

        {/* CTA */}
        <motion.div {...fadeUp(0.15)} className="flex items-center justify-center gap-3 mb-16">
          <button
            onClick={() => router.push("/upload")}
            className="px-6 py-3 bg-accent text-bg text-sm font-bold rounded-lg hover:opacity-90 transition-all uppercase tracking-wider shadow-accent-sm"
          >
            Start Analysis →
          </button>
          <button
            onClick={() => router.push("/history")}
            className="px-6 py-3 text-dim text-sm font-bold rounded-lg border border-border2 hover:border-accent/30 hover:text-subtle transition-all uppercase tracking-wider"
          >
            View History
          </button>
        </motion.div>

        {/* Stats */}
        <motion.div {...fadeUp(0.2)} className="grid grid-cols-4 gap-px bg-border rounded-lg overflow-hidden border border-border">
          {[
            { value: "100K+", label: "Rows processed" },
            { value: "8",     label: "Agent nodes" },
            { value: "5",     label: "n8n workflows" },
            { value: "3",     label: "Forecast horizons" },
          ].map((s) => (
            <div key={s.label} className="bg-card px-6 py-5 text-center">
              <div className="text-2xl font-bold mono text-accent tabular-nums" style={{ letterSpacing: "2px" }}>{s.value}</div>
              <div className="text-xs text-disabled mt-1 uppercase tracking-wider" style={{ fontSize: "9px" }}>{s.label}</div>
            </div>
          ))}
        </motion.div>

        {/* Tool stack */}
        <motion.div {...fadeUp(0.25)} className="mt-8 flex items-center justify-center gap-6">
          {[
            { label: "n8n",       color: "#22d3ee",  desc: "Workflow automation" },
            { label: "LangGraph", color: "#a78bfa",  desc: "Agent orchestration" },
            { label: "LangChain", color: "#E8FF47",  desc: "Tool execution" },
          ].map((t) => (
            <div key={t.label} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: t.color }} />
              <span className="text-xs text-muted">
                <span className="text-subtle font-medium">{t.label}</span>
                {" · "}{t.desc}
              </span>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
