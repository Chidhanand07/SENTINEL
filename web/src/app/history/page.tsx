"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CheckCircle, Clock, XCircle, Loader2, ArrowRight, Search } from "lucide-react";
import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const STATUS_ICON = {
  completed: <CheckCircle className="w-4 h-4 text-green" />,
  running: <Loader2 className="w-4 h-4 text-purple animate-spin" />,
  failed: <XCircle className="w-4 h-4 text-red" />,
  queued: <Clock className="w-4 h-4 text-amber" />,
};

export default function HistoryPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["runs"],
    queryFn: () => fetch(`${API_URL}/runs`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const filtered = runs.filter(
    (r: { run_id: string; status: string }) =>
      r.run_id.includes(search) || r.status.includes(search)
  );

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-bold mb-2">Run History</h1>
      <p className="text-muted text-sm mb-8">All past pipeline executions</p>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by run ID or status..."
          className="w-full bg-surface border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-text placeholder-muted focus:border-amber/40 focus:outline-none"
        />
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-muted">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          Loading runs...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-2xl">
          <p className="text-muted mb-4">No runs found</p>
          <button
            onClick={() => router.push("/upload")}
            className="px-6 py-2 bg-amber text-bg rounded-xl font-medium text-sm"
          >
            Start your first analysis
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((run: {
            run_id: string;
            status: keyof typeof STATUS_ICON;
            created_at: string;
            completed_at?: string;
            kpi_summary?: { total_forecast_revenue_30d?: number; num_segments?: number };
          }, i: number) => (
            <motion.div
              key={run.run_id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => router.push(`/run/${run.run_id}`)}
              className="bg-surface border border-border rounded-xl p-5 hover:border-amber/30 cursor-pointer transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {STATUS_ICON[run.status] || STATUS_ICON.queued}
                  <div>
                    <div className="font-mono text-sm text-subtle">{run.run_id.slice(0, 16)}...</div>
                    <div className="text-xs text-muted mt-0.5">
                      {new Date(run.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  {run.kpi_summary && (
                    <>
                      <div className="text-right">
                        <div className="text-xs text-muted">30d Forecast</div>
                        <div className="text-sm font-bold mono text-amber">
                          R$ {((run.kpi_summary.total_forecast_revenue_30d || 0) / 1000).toFixed(0)}K
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted">Segments</div>
                        <div className="text-sm font-bold mono text-purple">
                          {run.kpi_summary.num_segments || "–"}
                        </div>
                      </div>
                    </>
                  )}
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                      run.status === "completed"
                        ? "bg-green/10 text-green"
                        : run.status === "running"
                        ? "bg-purple/10 text-purple"
                        : run.status === "failed"
                        ? "bg-red/10 text-red"
                        : "bg-amber/10 text-amber"
                    }`}
                  >
                    {run.status}
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted group-hover:text-amber transition-colors" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
