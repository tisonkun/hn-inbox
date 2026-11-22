import { NextResponse } from "next/server";
import {
  buildOAuthStateCookieHeader,
  createOAuthState,
  resolvePublicOrigin,
} from "@/lib/auth";
import { getGitHubAuthConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const origin = resolvePublicOrigin(request);
  const authCfg = getGitHubAuthConfig();
  if (!authCfg) {
    return NextResponse.redirect(`${origin}/?error=not_configured`);
  }

  const state = createOAuthState();
  const redirectUri = `${origin}/api/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: authCfg.clientId,
    redirect_uri: redirectUri,
    scope: "read:user",
    state,
  });

  const response = NextResponse.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`,
  );
  response.headers.set("Set-Cookie", buildOAuthStateCookieHeader(state));
  return response;
}
