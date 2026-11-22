import { NextResponse } from "next/server";
import { hasValidCronBearer } from "@/lib/auth";
import { runPollCycle } from "@/lib/poll";
import { emitTelemetryAfter } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handleScheduledPoll(request: Request): Promise<Response> {
  const startedAt = Date.now();
  if (!hasValidCronBearer(request)) {
    emitTelemetryAfter({
      request,
      status: 401,
      message: "schedule.poll.unauthorized",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  try {
    const summary = await runPollCycle();
    const failedChannels = summary.channelResults.filter((r) => !r.ok);
    emitTelemetryAfter({
      request,
      status: 200,
      outcome: failedChannels.length > 0 ? "error" : "ok",
      level: failedChannels.length > 0 ? "error" : "info",
      message:
        failedChannels.length > 0
          ? "schedule.poll.partial_failure"
          : "schedule.poll.completed",
      durationMs: Date.now() - startedAt,
      attributes: {
        is_baseline_seed: summary.isBaselineSeed,
        stories_observed: summary.storiesObserved,
        comments_stored: summary.commentsStored,
        notifications_generated: summary.notificationsGenerated,
        channel_results: summary.channelResults,
      },
    });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Scheduled HN poll failed:", error);
    emitTelemetryAfter({
      request,
      status: 500,
      message: "schedule.poll.failed",
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Scheduled poll failed" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleScheduledPoll(request);
}

// Also accept GET in case an external cron or Vercel legacy cron invokes GET.
export async function GET(request: Request): Promise<Response> {
  return handleScheduledPoll(request);
}
