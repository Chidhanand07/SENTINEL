import { NextResponse } from "next/server";
import { DEMO_MANIFEST } from "@/lib/demo-data";

export const dynamic = "force-dynamic"; // No caching
export const revalidate = 0; // No ISR

export async function GET(
  _req: Request,
  { params }: { params: { runId: string } }
) {
  const { runId } = params;

  // Always return demo manifest for demo- prefixed run IDs
  if (runId.startsWith("demo-")) {
    return NextResponse.json(DEMO_MANIFEST);
  }

  try {
    const bases = [
      process.env.API_INTERNAL_URL,
      process.env.NEXT_PUBLIC_API_URL,
      "http://api:8000",
      "http://host.docker.internal:8000",
      "http://localhost:8000",
    ].filter(Boolean) as string[];
    let resp: Response | null = null;
    for (const apiBase of bases) {
      try {
        const candidate = await fetch(`${apiBase}/manifest/${runId}`);
        if (candidate.ok || candidate.status === 404) {
          resp = candidate;
          break;
        }
      } catch {
        continue;
      }
    }
    if (!resp) {
      return NextResponse.json(
        { status: "error", detected_schema: null },
        { status: 202 }
      );
    }

    if (!resp.ok) {
      // Run exists in pipeline but not in DB yet — return 202
      if (resp.status === 404) {
        return NextResponse.json(
          { status: "pending", detected_schema: null },
          { status: 202 }
        );
      }
      // Other errors — return 202 to keep polling
      return NextResponse.json(
        { status: "processing", detected_schema: null },
        { status: 202 }
      );
    }

    const data = await resp.json();
    console.error("[manifest] Backend returned:", JSON.stringify(data).slice(0, 200));

    // Pipeline running but schema not detected yet
    if (!data?.detected_schema) {
      return NextResponse.json(
        { status: data?.status ?? "running", detected_schema: null },
        { status: 202 }
      );
    }

    // Schema ready — return full manifest
    return NextResponse.json({
      run_id: runId,
      dataset_name: data.dataset_name ?? "Uploaded dataset",
      detected_schema: data.detected_schema,
      available_analyses: data.available_analyses ?? {
        can_segment: false,
        can_forecast: false,
        can_choropleth: false,
        can_rfm: false,
      },
    });
  } catch (err) {
    console.error("[manifest] Fetch error:", err);
    // On any error, return 202 so UI keeps polling, or eventually times out to demo
    return NextResponse.json(
      { status: "error", detected_schema: null },
      { status: 202 }
    );
  }
}
