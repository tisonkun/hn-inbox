import { NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/auth";
import { appendEvents, type EventType } from "@/lib/scopedb";
import { emitTelemetryAfter } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUS_MAP: Record<string, EventType> = {
  read: "inbox_read",
  replied: "inbox_replied",
  unread: "inbox_unread",
};

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const commentId = record["commentId"];
  const status = record["status"];

  if (
    typeof commentId !== "number" ||
    !Number.isSafeInteger(commentId) ||
    commentId <= 0
  ) {
    return NextResponse.json({ error: "Invalid commentId" }, { status: 400 });
  }

  if (typeof status !== "string" || !(status in ALLOWED_STATUS_MAP)) {
    return NextResponse.json(
      { error: "status must be 'unread', 'read', or 'replied'" },
      { status: 400 },
    );
  }

  try {
    await appendEvents([
      {
        event_time: new Date().toISOString(),
        event_type: ALLOWED_STATUS_MAP[status],
        target_id: commentId,
        channel: "ui",
        status: "ok",
        payload: {},
      },
    ]);
    return NextResponse.json({ ok: true, commentId, status });
  } catch (error) {
    console.error("Failed to update comment inbox state:", error);
    emitTelemetryAfter({
      request,
      status: 500,
      message: "inbox.state.update_failed",
      durationMs: Date.now() - startedAt,
      error,
      attributes: { comment_id: commentId, target_status: status },
    });
    return NextResponse.json(
      { error: "Failed to persist status event" },
      { status: 500 },
    );
  }
}
