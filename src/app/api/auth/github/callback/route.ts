import { NextResponse } from "next/server";
import {
  buildClearOAuthStateCookieHeader,
  buildSessionCookieHeader,
  createSessionToken,
  extractCookieValue,
  isGitHubUserAllowed,
  OAUTH_STATE_COOKIE_NAME,
  resolvePublicOrigin,
  timingSafeEqualString,
} from "@/lib/auth";
import { getGitHubAuthConfig } from "@/lib/config";
import { emitTelemetryAfter } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectWithClearState(targetUrl: string): NextResponse {
  const response = NextResponse.redirect(targetUrl);
  response.headers.append("Set-Cookie", buildClearOAuthStateCookieHeader());
  return response;
}

export async function GET(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const origin = resolvePublicOrigin(request);
  const authCfg = getGitHubAuthConfig();
  if (!authCfg) {
    return redirectWithClearState(`${origin}/?error=not_configured`);
  }

  const reqUrl = new URL(request.url);
  const code = reqUrl.searchParams.get("code");
  const state = reqUrl.searchParams.get("state");
  const oauthError = reqUrl.searchParams.get("error");

  if (oauthError) {
    emitTelemetryAfter({
      request,
      status: 400,
      message: "auth.github.denied",
      durationMs: Date.now() - startedAt,
      attributes: { oauth_error: oauthError },
    });
    return redirectWithClearState(`${origin}/?error=oauth_denied`);
  }

  const expectedState = extractCookieValue(
    request.headers.get("cookie"),
    OAUTH_STATE_COOKIE_NAME,
  );
  if (
    !code ||
    !state ||
    !expectedState ||
    !timingSafeEqualString(state, expectedState)
  ) {
    emitTelemetryAfter({
      request,
      status: 400,
      message: "auth.github.state_mismatch",
      durationMs: Date.now() - startedAt,
    });
    return redirectWithClearState(`${origin}/?error=oauth_state`);
  }

  try {
    const redirectUri = `${origin}/api/auth/github/callback`;
    const tokenResp = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "hn-inbox/0.1",
        },
        body: JSON.stringify({
          client_id: authCfg.clientId,
          client_secret: authCfg.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!tokenResp.ok) {
      emitTelemetryAfter({
        request,
        status: 502,
        message: "auth.github.token_exchange_failed",
        durationMs: Date.now() - startedAt,
        attributes: { upstream_status: tokenResp.status },
      });
      return redirectWithClearState(`${origin}/?error=oauth_failed`);
    }

    const tokenPayload = (await tokenResp.json()) as {
      access_token?: string;
      error?: string;
    };
    if (!tokenPayload.access_token) {
      emitTelemetryAfter({
        request,
        status: 502,
        message: "auth.github.missing_access_token",
        durationMs: Date.now() - startedAt,
        attributes: { upstream_error: tokenPayload.error ?? "unknown" },
      });
      return redirectWithClearState(`${origin}/?error=oauth_failed`);
    }

    const userResp = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "hn-inbox/0.1",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!userResp.ok) {
      emitTelemetryAfter({
        request,
        status: 502,
        message: "auth.github.user_fetch_failed",
        durationMs: Date.now() - startedAt,
        attributes: { upstream_status: userResp.status },
      });
      return redirectWithClearState(`${origin}/?error=oauth_failed`);
    }

    const userPayload = (await userResp.json()) as { login?: string };
    const login = userPayload.login?.trim();
    if (!login || !isGitHubUserAllowed(login, authCfg.allowedUsers)) {
      emitTelemetryAfter({
        request,
        status: 403,
        message: "auth.github.forbidden",
        durationMs: Date.now() - startedAt,
        attributes: { github_login: login ?? "unknown" },
      });
      return redirectWithClearState(`${origin}/?error=forbidden`);
    }

    const sessionToken = createSessionToken(login, authCfg.sessionSecret);
    emitTelemetryAfter({
      request,
      status: 200,
      message: "auth.github.signed_in",
      durationMs: Date.now() - startedAt,
      attributes: { github_login: login },
    });
    const response = NextResponse.redirect(`${origin}/`);
    response.headers.append("Set-Cookie", buildClearOAuthStateCookieHeader());
    response.headers.append("Set-Cookie", buildSessionCookieHeader(sessionToken));
    return response;
  } catch (error) {
    console.error("GitHub OAuth callback failed:", error);
    emitTelemetryAfter({
      request,
      status: 500,
      message: "auth.github.callback_error",
      durationMs: Date.now() - startedAt,
      error,
    });
    return redirectWithClearState(`${origin}/?error=oauth_failed`);
  }
}
