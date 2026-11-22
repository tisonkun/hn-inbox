import { NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/auth";
import { ensureScopeDBTables } from "@/lib/scopedb";
import { emitTelemetryAfter } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tables = await ensureScopeDBTables();
    emitTelemetryAfter({
      request,
      status: 200,
      message: "scopedb.init.completed",
      durationMs: Date.now() - startedAt,
      attributes: { tables: tables.map((t) => t.name) },
    });
    return NextResponse.json({ ok: true, tables });
  } catch (error) {
    console.error("ScopeDB table initialization failed:", error);
    emitTelemetryAfter({
      request,
      status: 500,
      message: "scopedb.init.failed",
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Failed to initialize ScopeDB tables" },
      { status: 500 },
    );
  }
}
