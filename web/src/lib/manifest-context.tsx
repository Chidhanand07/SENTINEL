"use client";

import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { RunManifest } from "./manifest";
import { DEMO_MANIFEST } from "./demo-data";

interface ManifestContextValue {
  manifest: RunManifest | null;
  loading: boolean;
  error: string | null;
}

const ManifestContext = createContext<ManifestContextValue | undefined>(undefined);

export function ManifestProvider({ runId, children }: { runId: string; children: React.ReactNode }) {
  const [manifest, setManifest] = useState<RunManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (!runId) return;
    attemptRef.current = 0;

    const poll = async () => {
      attemptRef.current++;
      console.log(`[manifest] Poll attempt ${attemptRef.current} for ${runId}`);

      // Hard limit: after 40 attempts (120s), give up with an error for real runs
      if (attemptRef.current > 40) {
        const isDemo = runId.startsWith("demo-");
        if (isDemo) {
          console.warn("[manifest] Demo timeout — using demo manifest");
          setManifest({ ...DEMO_MANIFEST, run_id: runId });
        } else {
          console.error("[manifest] Pipeline timeout — backend may be down");
          setError("Pipeline timed out. Check if the backend is running.");
        }
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/manifest/${runId}`);

        // 202 = still processing, keep polling
        if (res.status === 202) {
          console.log("[manifest] Still processing (202), retrying...");
          timerRef.current = setTimeout(poll, 3000);
          return;
        }

        if (!res.ok) {
          console.warn("[manifest] Error status:", res.status);
          timerRef.current = setTimeout(poll, 3000);
          return;
        }

        const data = await res.json();

        // If detected_schema is null, pipeline hasn't run SchemaJoin yet
        if (!data.detected_schema) {
          console.log("[manifest] Schema not ready yet, retrying...");
          timerRef.current = setTimeout(poll, 3000);
          return;
        }

        console.log("[manifest] Manifest ready:", data);
        setManifest(data);
        setLoading(false);
      } catch (err) {
        console.warn("[manifest] Fetch error:", err);
        timerRef.current = setTimeout(poll, 3000);
      }
    };

    poll();
    return () => clearTimeout(timerRef.current);
  }, [runId]);

  return (
    <ManifestContext.Provider value={{ manifest, loading, error }}>
      {children}
    </ManifestContext.Provider>
  );
}

export function useManifest() {
  const ctx = useContext(ManifestContext);
  if (ctx === undefined) {
    throw new Error("useManifest must be used within a ManifestProvider");
  }
  return ctx;
}
