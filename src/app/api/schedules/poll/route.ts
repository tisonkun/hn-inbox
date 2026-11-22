import { NextResponse } from "next/server";
import { hasValidCronBearer } from "@/lib/auth";
import { runPollCycle } from "@/lib/poll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handleScheduledPoll(request: Request): Promise<Response> {
  if (!hasValidCronBearer(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  try {
    const summary = await runPollCycle();
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Scheduled HN poll failed:", error);
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
