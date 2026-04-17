"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import { Send, Bot, User, Sparkles } from "lucide-react";
import { RunManifest } from "@/lib/manifest";

interface Message {
  role: "user" | "model";
  content: string;
  streaming?: boolean;
}

const SUGGESTED = [
  "What are the top customer segments?",
  "Which SKU has the best forecast accuracy?",
  "What actions should I take based on this data?",
  "How clean is this dataset?",
];

export function ChatTab({ runId, manifest }: { runId: string; manifest: RunManifest | null }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "model",
      content:
        "Hi! I'm SENTINEL, your AI analytics assistant. Ask me anything about your cleaned dataset — segments, forecasts, KPIs, data quality, or recommended actions.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;

    // Build history from settled messages (exclude streaming placeholder)
    const history = messages
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "model", content: "", streaming: true },
    ]);
    setInput("");
    setIsStreaming(true);

    abortRef.current = new AbortController();

    try {
      const res = await fetch(`/api/chat/${runId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.token) {
              accumulated += payload.token;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "model", content: accumulated, streaming: true };
                return next;
              });
            }
            if (payload.done || payload.error) break;
          } catch {}
        }
      }

      if (buffer.startsWith("data: ")) {
        try {
          const payload = JSON.parse(buffer.slice(6));
          if (payload.token) accumulated += payload.token;
        } catch {}
      }

      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "model",
          content: accumulated || "I didn't receive a response. Please try again.",
          streaming: false,
        };
        return next;
      });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "model",
          content: `Chat request failed: ${err?.message || "unknown error"}`,
          streaming: false,
        };
        return next;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const showSuggested = messages.length === 1 && !isStreaming;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 220px)", minHeight: "480px" }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-accent" />
        </div>
        <div>
          <p className="text-xs font-bold text-subtle uppercase tracking-wider">SENTINEL Chat</p>
          <p className="text-xs text-muted">Powered by Gemini · Grounded in your cleaned dataset</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-muted">Live</span>
        </div>
      </div>

      {/* Messages — scrollable area */}
      <div className="flex-1 overflow-auto space-y-4 pr-1 mb-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            {/* Avatar */}
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                msg.role === "user" ? "bg-accent/20" : "bg-surface border border-border"
              }`}
            >
              {msg.role === "user" ? (
                <User className="w-3 h-3 text-accent" />
              ) : (
                <Bot className="w-3 h-3 text-muted" />
              )}
            </div>

            {/* Bubble */}
            <div
              className={`max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-accent/10 text-subtle border border-accent/20"
                  : "bg-surface border border-border text-muted"
              }`}
            >
              {/* Typing dots when streaming with no content yet */}
              {msg.streaming && !msg.content ? (
                <span className="inline-flex gap-1 items-center h-4">
                  <span
                    className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </span>
              ) : (
                <>
                  {msg.content}
                  {/* Cursor blink while still streaming */}
                  {msg.streaming && (
                    <span className="inline-block w-0.5 h-3.5 bg-accent ml-0.5 animate-pulse align-middle" />
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Suggested questions — only on first message */}
      {showSuggested && (
        <div className="flex flex-wrap gap-2 mb-3 flex-shrink-0">
          {SUGGESTED.map((q, i) => (
            <button
              key={i}
              onClick={() => sendMessage(q)}
              className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted hover:text-subtle hover:border-accent/30 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={handleSubmit} className="flex gap-2 flex-shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isStreaming}
          placeholder="Ask about your data..."
          className="flex-1 text-sm px-4 py-2.5 bg-surface border border-border rounded-xl text-subtle placeholder:text-muted focus:outline-none focus:border-accent/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className="px-4 py-2.5 rounded-xl bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
