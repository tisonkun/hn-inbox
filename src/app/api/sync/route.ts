import { NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/auth";
import { runPollCycle } from "@/lib/poll";
import { emitTelemetryAfter } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let dryRun = false;
  let seedOnly = false;
  try {
    const raw = await request.text();
    if (raw.trim().length > 0) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      dryRun = parsed["dryRun"] === true;
      seedOnly = parsed["seedOnly"] === true;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const summary = await runPollCycle({ dryRun, seedOnly });
    const failedChannels = summary.channelResults.filter((r) => !r.ok);
    emitTelemetryAfter({
      request,
      status: 200,
      outcome: failedChannels.length > 0 ? "error" : "ok",
      level: failedChannels.length > 0 ? "error" : "info",
      message:
        failedChannels.length > 0
          ? "manual.sync.partial_failure"
          : "manual.sync.completed",
      durationMs: Date.now() - startedAt,
      attributes: {
        dry_run: dryRun,
        seed_only: seedOnly,
        is_baseline_seed: summary.isBaselineSeed,
        stories_observed: summary.storiesObserved,
        comments_stored: summary.commentsStored,
        notifications_generated: summary.notificationsGenerated,
        channel_results: summary.channelResults,
      },
    });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Manual sync failed:", error);
    emitTelemetryAfter({
      request,
      status: 500,
      message: "manual.sync.failed",
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Poll cycle failed" }, { status: 500 });
  }
}
