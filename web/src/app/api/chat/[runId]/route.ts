import { NextRequest } from "next/server";

const CANDIDATE_API_BASES = [
  process.env.API_INTERNAL_URL,
  process.env.NEXT_PUBLIC_API_URL,
  "http://api:8000",
  "http://host.docker.internal:8000",
  "http://localhost:8000",
].filter(Boolean) as string[];

export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const body = await req.text();
  let lastErr = "unknown error";
  for (const base of CANDIDATE_API_BASES) {
    try {
      const upstream = await fetch(`${base}/chat/${params.runId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body,
        cache: "no-store",
      });

      if (!upstream.ok || !upstream.body) {
        const errorText = await upstream.text();
        lastErr = `Chat backend error (${upstream.status}) at ${base}: ${errorText || "Upstream unavailable"}`;
        continue;
      }

      return new Response(upstream.body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }
    catch (err: any) {
      lastErr = `Chat service unreachable at ${base}: ${err?.message || "unknown error"}`;
    }
  }

  const token = `${lastErr}. Set API_INTERNAL_URL in web/.env.local to your reachable backend URL.`;
  return new Response(`data: ${JSON.stringify({ token })}\n\ndata: ${JSON.stringify({ done: true })}\n\n`, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
