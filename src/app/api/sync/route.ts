import { NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/auth";
import { runPollCycle } from "@/lib/poll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
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
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Manual sync failed:", error);
    return NextResponse.json({ error: "Poll cycle failed" }, { status: 500 });
  }
}
