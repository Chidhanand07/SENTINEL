import { NextRequest, NextResponse } from "next/server";

const CANDIDATE_API_BASES = [
  process.env.API_INTERNAL_URL,
  process.env.NEXT_PUBLIC_API_URL,
  "http://api:8000",
  "http://host.docker.internal:8000",
  "http://localhost:8000",
].filter(Boolean) as string[];

export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  let lastStatus = 502;
  for (const base of CANDIDATE_API_BASES) {
    try {
      const upstream = await fetch(`${base}/segments/${params.runId}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (!upstream.ok) {
        lastStatus = upstream.status;
        continue;
      }

      const data = await upstream.json();
      return NextResponse.json(data, { status: 200 });
    } catch {
      continue;
    }
  }
  return NextResponse.json([], { status: lastStatus });
}
