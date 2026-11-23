import { NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/auth";
import { appendEvents } from "@/lib/scopedb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let ackedUntil = new Date().toISOString();
  try {
    const raw = await request.text();
    if (raw.trim().length > 0) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const candidate = parsed["ackedUntil"];
      if (typeof candidate === "string" && Number.isFinite(Date.parse(candidate))) {
        const candidateMs = Date.parse(candidate);
        ackedUntil = new Date(Math.max(Date.now(), candidateMs)).toISOString();
      }
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    await appendEvents([
      {
        event_time: new Date().toISOString(),
        event_type: "logs_acked",
        target_id: 0,
        channel: "ui",
        status: "ok",
        payload: { acked_until: ackedUntil },
      },
    ]);
    return NextResponse.json({ ok: true, ackedUntil });
  } catch (error) {
    console.error("Failed to acknowledge log errors:", error);
    return NextResponse.json(
      { error: "Failed to persist log acknowledgement" },
      { status: 500 },
    );
  }
}
