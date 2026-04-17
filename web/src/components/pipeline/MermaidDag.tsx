"use client";

import { useEffect, useRef } from "react";
import { type AgentEvent, getActiveNode, getCompletedNodes } from "@/lib/store";

const NODES = [
  "n8nUpload",
  "SchemaJoinNode",
  "ProfilerNode",
  "CleaningNode",
  "FeatureEngineeringNode",
  "EDANode",
  "SegmentationNode",
  "ForecastNode",
  "NarratorNode",
];

function buildMermaid(activeNode: string | null, completed: Set<string>): string {
  const style = (nodeId: string, label: string, layer: "n8n" | "lg" | "lc") => {
    const shapes: Record<string, [string, string]> = {
      n8n: ["([", "])"],
      lg: ["[", "]"],
      lc: ["(", ")"],
    };
    const [open, close] = shapes[layer];
    return `  ${nodeId}${open}${label}${close}`;
  };

  let chart = "graph TD\n";
  chart += style("n8nUpload", "n8n: Upload Trigger", "n8n") + "\n";
  chart += style("SchemaJoinNode", "SchemaJoin", "lg") + "\n";
  chart += style("ProfilerNode", "Profiler", "lg") + "\n";
  chart += style("CleaningNode", "Cleaning", "lg") + "\n";
  chart += style("FeatureEngineeringNode", "Feature Eng.", "lg") + "\n";
  chart += style("EDANode", "EDA", "lg") + "\n";
  chart += style("SegmentationNode", "Segmentation", "lc") + "\n";
  chart += style("ForecastNode", "Forecast", "lc") + "\n";
  chart += style("NarratorNode", "Narrator", "lg") + "\n";

  chart += "  n8nUpload --> SchemaJoinNode\n";
  chart += "  SchemaJoinNode --> ProfilerNode\n";
  chart += "  ProfilerNode --> CleaningNode\n";
  chart += "  CleaningNode --> FeatureEngineeringNode\n";
  chart += "  FeatureEngineeringNode --> EDANode\n";
  chart += "  EDANode --> SegmentationNode\n";
  chart += "  EDANode --> ForecastNode\n";
  chart += "  SegmentationNode --> NarratorNode\n";
  chart += "  ForecastNode --> NarratorNode\n";

  // Styles
  chart += `  classDef n8n fill:#0EA5E9,stroke:#0EA5E9,color:#fff,font-size:10px\n`;
  chart += `  classDef lg fill:#7C3AED,stroke:#7C3AED,color:#fff,font-size:10px\n`;
  chart += `  classDef lc fill:#E8FF47,stroke:#E8FF47,color:#000,font-size:10px\n`;
  chart += `  classDef active fill:#E8FF47,stroke:#fff,stroke-width:3px,color:#000,font-weight:bold\n`;
  chart += `  classDef done fill:#10B981,stroke:#10B981,color:#fff\n`;

  chart += "  class n8nUpload n8n\n";
  ["SchemaJoinNode", "ProfilerNode", "CleaningNode", "FeatureEngineeringNode", "EDANode", "NarratorNode"].forEach((n) => {
    chart += `  class ${n} ${completed.has(n) ? "done" : n === activeNode ? "active" : "lg"}\n`;
  });
  ["SegmentationNode", "ForecastNode"].forEach((n) => {
    chart += `  class ${n} ${completed.has(n) ? "done" : n === activeNode ? "active" : "lc"}\n`;
  });

  return chart;
}

export function MermaidDag({ events, runId }: { events: AgentEvent[]; runId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeNode = getActiveNode(events);
  const completed = getCompletedNodes(events);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = buildMermaid(activeNode, completed);
    // Write chart directly
    containerRef.current.innerHTML = `<pre class="mermaid">${chart}</pre>`;

    import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: {
          background: "#1a1a2e",
          primaryColor: "#7C3AED",
          edgeLabelBackground: "#1a1a2e",
          lineColor: "#475569",
        },
      });
      // Allow Mermaid to process the newly injected HTML
      m.default.contentLoaded();
      try {
        m.default.init(undefined, containerRef.current!.querySelectorAll('.mermaid'));
      } catch (e) {}
    });
  }, [activeNode, completed.size, runId]);

  return (
    <div className="border-b border-border p-3 bg-surface/30">
      <div className="text-xs text-muted uppercase tracking-widest mb-2 font-medium">
        Pipeline DAG — Live
      </div>
      <div
        ref={containerRef}
        className="overflow-auto"
        style={{ minHeight: "180px", maxHeight: "200px" }}
      />
      <div className="flex items-center gap-4 mt-2 text-xs">
        <LegendDot color="bg-teal" label="n8n" />
        <LegendDot color="bg-purple" label="LangGraph" />
        <LegendDot color="bg-accent" label="LangChain" />
        <LegendDot color="bg-green" label="Done" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-muted">{label}</span>
    </div>
  );
}
