import { NextRequest, NextResponse } from "next/server";

const BACKEND =
  process.env.API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

export const runtime = "nodejs";
export const maxDuration = 120; // 2 minute timeout for large file uploads

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "500mb",
    },
  },
};

// Now supports files up to 500 MB with streaming backend
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const upstream = new FormData();
    for (const [key, value] of formData.entries()) {
      if (value instanceof Blob) {
        const file = value as File;
        upstream.append(key, file, file.name || "upload.csv");
      } else {
        upstream.append(key, value);
      }
    }

    const controller = new AbortController();
    // 120 second timeout for backend processing
    const timeout = setTimeout(() => controller.abort(), 120_000);

    const res = await fetch(`${BACKEND}/n8n/upload`, {
      method: "POST",
      body: upstream,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const text = await res.text();

    if (!res.ok) {
      console.error(`[api/upload] backend ${res.status}:`, text);
      return NextResponse.json(
        { error: `Backend error ${res.status}: ${text}` },
        { status: res.status }
      );
    }

    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json(
        { error: "Non-JSON response from backend", detail: text },
        { status: 502 }
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/upload] proxy error:", message);
    
    if (message.includes("abort")) {
      return NextResponse.json(
        { error: "Upload timeout - file may be too large or network is slow" },
        { status: 408 }
      );
    }
    
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
