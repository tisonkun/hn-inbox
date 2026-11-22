import { NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/auth";
import { ensureScopeDBTables } from "@/lib/scopedb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tables = await ensureScopeDBTables();
    return NextResponse.json({ ok: true, tables });
  } catch (error) {
    console.error("ScopeDB table initialization failed:", error);
    return NextResponse.json(
      { error: "Failed to initialize ScopeDB tables" },
      { status: 500 },
    );
  }
}
