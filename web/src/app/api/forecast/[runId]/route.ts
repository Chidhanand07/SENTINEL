import { NextRequest, NextResponse } from "next/server";

const CANDIDATE_API_BASES = [
  process.env.API_INTERNAL_URL,
  process.env.NEXT_PUBLIC_API_URL,
  "http://api:8000",
  "http://host.docker.internal:8000",
  "http://localhost:8000",
].filter(Boolean) as string[];

export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const q = req.nextUrl.search;
  for (const base of CANDIDATE_API_BASES) {
    try {
      const upstream = await fetch(`${base}/forecast/${params.runId}${q}`, { cache: "no-store" });
      if (!upstream.ok) continue;
      const data = await upstream.json();
      return NextResponse.json(data, { status: 200 });
    } catch {
      continue;
    }
  }
  return NextResponse.json([], { status: 200 });
}
