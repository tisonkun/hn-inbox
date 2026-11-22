import { NextResponse } from "next/server";
import { buildClearSessionCookieHeader } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", buildClearSessionCookieHeader());
  return response;
}
