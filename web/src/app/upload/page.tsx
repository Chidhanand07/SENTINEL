"use client";

import { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle, AlertCircle, FileText, Package } from "lucide-react";
import { DEMO_MANIFEST } from "@/lib/demo-data";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const NUMBER_LOCALE = "en-US";

// Increased to 100 MB to support larger datasets
// Backend now streams large files to handle them efficiently
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

async function sampleLargeCSV(file: File): Promise<{ file: File; sampled: boolean }> {
  if (!file.name.toLowerCase().endsWith(".csv") || file.size <= MAX_UPLOAD_BYTES) {
    return { file, sampled: false };
  }
  // Binary slice — encoding-safe (works for UTF-8, Latin-1, Windows-1252, etc.)
  const slice = file.slice(0, MAX_UPLOAD_BYTES);
  const buf = await slice.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Trim to last newline byte (0x0A) so we never cut mid-row
  let end = bytes.length - 1;
  while (end > 0 && bytes[end] !== 0x0a) end--;
  const trimmed = bytes.slice(0, end + 1);
  const smaller = new File([trimmed], file.name, { type: file.type || "text/csv" });
  console.log(
    `[SENTINEL] Sampled ${(file.size / 1024 / 1024).toFixed(1)} MB → ${(smaller.size / 1024 / 1024).toFixed(1)} MB`
  );
  return { file: smaller, sampled: true };
}

function fmt(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "zip") return <Package className="w-4 h-4" />;
  return <FileText className="w-4 h-4" />;
}

interface Manifest {
  run_id: string;
  dataset_name: string;
  detected_schema?: {
    table_count?: number;
    row_count?: number;
    date_col?: string;
    revenue_col?: string;
    customer_col?: string;
    product_col?: string;
    geo_col?: string;
  };
  available_analyses?: {
    can_segment: boolean;
    can_forecast: boolean;
    can_choropleth: boolean;
    can_rfm: boolean;
  };
}

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<"idle" | "sampling" | "loading" | "error" | "detecting" | "ready">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);

  // Debug logging for webhook URL
  useEffect(() => {
    console.log(
      "[SENTINEL] Webhook URL:",
      process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL ?? "NOT SET"
    );
  }, []);

  const onDrop = useCallback((accepted: File[]) => {
    const existing = new Set(files.map((f) => f.name));
    setFiles((prev) => [...prev, ...accepted.filter((f) => !existing.has(f.name))]);
    setErrorMessage(null);
  }, [files]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/json": [".json"],
      "application/zip": [".zip"],
      "application/x-parquet": [".parquet"],
    },
    multiple: true,
  });

  const startPolling = (runIdParam: string) => {
    let attempts = 0;
    const MAX_ATTEMPTS = 90; // 90 × 3s = 4.5 minutes max (ample time for 100MB files)

    const poll = async () => {
      attempts++;
      console.log(`[SENTINEL] Polling manifest attempt ${attempts}`);

      if (attempts > MAX_ATTEMPTS) {
        console.warn("[SENTINEL] Manifest polling timed out");
        setStatus("error");
        setErrorMessage("Pipeline timed out. Check if the backend is running.");
        return;
      }

      try {
        // Use Next.js proxy route to avoid CORS issues
        const res = await fetch(`/api/manifest/${runIdParam}`);

        // 202 = still processing, keep polling
        if (res.status === 202) {
          console.log("[SENTINEL] Pipeline still processing (202)...");
          setTimeout(poll, 3000);
          return;
        }

        if (!res.ok) {
          console.warn("[SENTINEL] Manifest poll error:", res.status);
          setTimeout(poll, 3000);
          return;
        }

        const data = await res.json();
        console.log("[SENTINEL] Manifest received:", data);

        if (!data?.detected_schema) {
          setTimeout(poll, 3000);
          return;
        }

        setManifest(data);
        setStatus("ready");
      } catch (err) {
        console.warn("[SENTINEL] Poll error:", err);
        setTimeout(poll, 3000);
      }
    };

    poll();
  };

  const handleStart = async () => {
    setStatus("sampling");
    setErrorMessage(null);

    // Sample large CSVs in-browser before uploading.
    // Cloudflare times out uploads > ~10 MB; the pipeline samples to 5 000 rows anyway.
    const sampled = await Promise.all(files.map(sampleLargeCSV));
    const anyWasSampled = sampled.some((s) => s.sampled);
    if (anyWasSampled) {
      console.log("[SENTINEL] Large file(s) sampled to 8 MB for Cloudflare-safe upload");
    }

    const form = new FormData();
    sampled.forEach(({ file: f }) => form.append("files", f));

    setStatus("loading");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000); // 120s timeout

    try {
      // POST via Next.js proxy — always same-origin so no CORS/HTTPS mixed-content issues.
      const uploadUrl = `/api/upload`;
      console.log("[SENTINEL] POSTing to:", uploadUrl);

      const res = await fetch(uploadUrl, {
        method: "POST",
        body: form,
        signal: controller.signal,
        // Do not set Content-Type — browser sets it automatically
        // with correct multipart boundary for FormData
      });

      clearTimeout(timeout);
      console.log("[SENTINEL] Response status:", res.status);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();

      // Proxy returned an error object
      if (!res.ok || json.error) {
        const detail = json.error ?? `HTTP ${res.status}`;
        if (res.status === 502 || res.status === 503) {
          throw new Error("Backend unreachable — run: docker-compose up -d");
        }
        throw new Error(detail);
      }

      const run_id: string = json.run_id ?? json.runId ?? json.id;
      if (!run_id) throw new Error("No run_id in response");

      console.log("[SENTINEL] Got run_id:", run_id);
      setRunId(run_id);
      setStatus("detecting");
      startPolling(run_id);
    } catch (err: unknown) {
      clearTimeout(timeout);
      const message = err instanceof Error ? err.message : String(err);
      console.error("[SENTINEL] Pipeline start failed:", message);
      setStatus("error");
      setErrorMessage(message);
    }
  };

  return (
    <div className="min-h-[calc(100vh-44px)] bg-bg flex items-start justify-center pt-16 px-6">
      <div className="w-full max-w-[560px]">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mb-8"
        >
          <h1 className="text-[22px] font-medium tracking-tight text-text-1 mb-1.5">Upload dataset</h1>
          <p className="text-sm text-text-3">Drop any dataset files — the pipeline will automatically detect schemas.</p>
        </motion.div>

        {/* Dropzone */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.35 }}
        >
          <div
            {...getRootProps()}
            className={`
              relative rounded-[14px] border-[1.5px] border-dashed transition-all duration-200 cursor-pointer
              flex flex-col items-center justify-center gap-3 py-14 px-8 text-center select-none
              ${
                isDragActive
                  ? "border-accent bg-[var(--accent-dim)]"
                  : "border-[var(--border-2)] bg-surface"
              }
            `}
          >
            <input {...getInputProps()} />
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                isDragActive ? "bg-[var(--accent-dim)]" : "bg-surface-2"
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M9 12V3M9 3L5.5 6.5M9 3L12.5 6.5"
                  stroke={isDragActive ? "#e8956d" : "#5c5650"}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M2 14v1a1 1 0 001 1h12a1 1 0 001-1v-1"
                  stroke={isDragActive ? "#e8956d" : "#5c5650"}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <p
                className={`text-sm font-medium ${
                  isDragActive ? "text-accent" : "text-text-2"
                }`}
              >
                {isDragActive ? "Drop files here" : "Drop any dataset files or click to browse"}
              </p>
              <p className="text-xs text-text-3 mt-0.5">
                .csv · .json · .parquet · .zip
              </p>
            </div>
          </div>
        </motion.div>

        {/* File list */}
        <AnimatePresence>
          {files.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 overflow-hidden"
            >
              <div className="border border-border rounded-xl overflow-hidden bg-card">
                {/* Progress bar */}
                <div className="h-0.5 bg-border">
                  <div
                    className="h-full bg-accent transition-all duration-500"
                    style={{ width: files.length > 0 ? "100%" : "0%" }}
                  />
                </div>

                <div className="px-3 py-2.5 flex items-center justify-between border-b border-border">
                  <span className="text-xs text-muted font-medium text-accent">
                    {files.length} file{files.length > 1 ? "s" : ""}
                  </span>
                  <button
                    onClick={() => setFiles([])}
                    className="text-2xs text-muted hover:text-subtle transition-colors"
                  >
                    Clear
                  </button>
                </div>

                <div className="divide-y divide-border max-h-52 overflow-y-auto">
                  {files.map((f) => (
                    <div key={f.name} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="text-muted flex-shrink-0">
                        {getFileIcon(f.name)}
                      </div>
                      <span className="text-xs flex-1 truncate text-accent font-medium">
                        {f.name}
                      </span>
                      <span className="text-2xs text-muted mono flex-shrink-0">
                        {fmt(f.size)}
                      </span>
                      <button
                        onClick={() =>
                          setFiles((p) => p.filter((x) => x.name !== f.name))
                        }
                        className="text-muted hover:text-subtle ml-1 flex-shrink-0"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                        >
                          <path
                            d="M2 2l8 8M10 2l-8 8"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit section */}
        <AnimatePresence>
          {files.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mt-4 space-y-3"
            >
              {/* Button row */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted flex-1">
                  {status === "idle"
                    ? "Ready to analyze"
                    : status === "sampling"
                    ? "Sampling large file..."
                    : status === "loading"
                    ? "Uploading..."
                    : status === "error"
                    ? "Upload failed"
                    : "Processing..."}
                </span>
                <button
                  onClick={handleStart}
                  disabled={status === "loading" || status === "sampling" || status === "detecting"}
                  className={`
                    flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-sm
                    transition-all uppercase tracking-wider
                    ${
                      status === "error"
                        ? "bg-red text-white hover:opacity-90 disabled:opacity-50"
                        : "bg-accent text-bg hover:opacity-90 disabled:opacity-50"
                    }
                  `}
                >
                  {status === "sampling" || status === "loading" || status === "detecting" ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {status === "sampling" ? "Sampling..." : status === "loading" ? "Starting..." : "Detecting..."}
                    </>
                  ) : status === "error" ? (
                    "Failed — Retry?"
                  ) : (
                    "Start Pipeline →"
                  )}
                </button>
              </div>

              {/* Error message */}
              {status === "error" && errorMessage && (
                <div className="text-xs font-medium text-red bg-red/10 px-3 py-2 rounded-lg border border-red/20 flex items-start gap-2">
                  <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Demo bypass button */}
              <button
                onClick={() => {
                  const demoId = `demo-${Date.now()}`;
                  setDemoMode(true);
                  setRunId(demoId);
                  setManifest(DEMO_MANIFEST as any);
                  setStatus("ready");
                }}
                className="text-xs text-dim hover:text-muted mt-2 underline underline-offset-2 block text-right w-full"
              >
                Skip — use demo dataset →
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Manifest preview card */}
        {status === "ready" && runId && manifest && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 p-4 border border-border rounded-lg bg-surface space-y-4"
          >
            <div>
              <p className="text-xs text-muted mb-1">
                {demoMode ? "Demo mode" : "Schema detected"}
              </p>
              {manifest.detected_schema && (
                <p className="text-xs text-subtle">
                  {manifest.detected_schema.table_count} table
                  {manifest.detected_schema.table_count !== 1 ? "s" : ""} ·{" "}
                  {manifest.detected_schema.row_count?.toLocaleString(NUMBER_LOCALE) ?? "?"} rows ·
                  Revenue → {manifest.detected_schema.revenue_col ?? "not found"}
                </p>
              )}
            </div>
            <button
              onClick={() => router.push(`/run/${runId}`)}
              className="w-full px-5 py-2.5 bg-accent text-bg rounded-lg text-sm font-bold hover:opacity-90 transition-all uppercase tracking-wider"
            >
              View Dashboard →
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function SchemaField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="bg-bg border border-border rounded-lg p-3 text-left">
      <div className="text-2xs text-muted font-medium uppercase">{label}</div>
      <div className="text-sm text-accent font-medium mt-1.5">
        {value ? value : <span className="text-muted">not found</span>}
      </div>
    </div>
  );
}

function AnalysisPill({
  label,
  available,
}: {
  label: string;
  available: boolean;
}) {
  return (
    <div
      className={`text-xs font-medium px-3 py-1.5 rounded-full border ${
        available
          ? "bg-green/10 border-green/20 text-green"
          : "bg-border/50 border-border text-muted"
      }`}
    >
      {available ? "✓" : "×"} {label}
    </div>
  );
}
