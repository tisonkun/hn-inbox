import { NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/auth";
import { loadDashboardData } from "@/lib/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await loadDashboardData();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to load inbox data:", error);
    return NextResponse.json(
      { error: "Failed to query ScopeDB" },
      { status: 500 },
    );
  }
}
