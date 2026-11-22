import crypto from "node:crypto";
import { getCronSecret, getGitHubAuthConfig, optionalEnv } from "./config";

export const SESSION_COOKIE_NAME = "hn_inbox_session";
export const OAUTH_STATE_COOKIE_NAME = "hn_inbox_oauth_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
const OAUTH_STATE_TTL_SECONDS = 60 * 10; // 10 minutes

export interface SessionInfo {
  login: string;
  exp: number;
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function deriveSigningKey(secret: string): Buffer {
  return crypto
    .createHmac("sha256", "hn-inbox-session-key-v2")
    .update(secret)
    .digest();
}

export function createOAuthState(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function isGitHubUserAllowed(
  login: string,
  allowedUsers: string[],
): boolean {
  const normalized = login.trim().toLowerCase();
  if (!normalized) return false;
  return allowedUsers.some((allowed) => allowed.toLowerCase() === normalized);
}

export function createSessionToken(
  login: string,
  secret: string,
  nowMs: number = Date.now(),
): string {
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const encodedLogin = Buffer.from(login, "utf8").toString("base64url");
  const payload = `v2.${encodedLogin}.${exp}`;
  const sig = crypto
    .createHmac("sha256", deriveSigningKey(secret))
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(
  token: string | undefined | null,
  secret: string,
  allowedUsers: string[],
  nowMs: number = Date.now(),
): SessionInfo | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v2") return null;

  const exp = Number.parseInt(parts[2], 10);
  if (!Number.isFinite(exp) || exp <= Math.floor(nowMs / 1000)) {
    return null;
  }

  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const expectedSig = crypto
    .createHmac("sha256", deriveSigningKey(secret))
    .update(payload)
    .digest("base64url");

  if (!timingSafeEqualString(parts[3], expectedSig)) {
    return null;
  }

  let login: string;
  try {
    login = Buffer.from(parts[1], "base64url").toString("utf8");
  } catch {
    return null;
  }

  if (!isGitHubUserAllowed(login, allowedUsers)) {
    return null;
  }

  return { login, exp };
}

export function hasValidCronBearer(request: Request): boolean {
  const secret = getCronSecret();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  return timingSafeEqualString(token, secret);
}

export function extractCookieValue(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export function getSessionFromRequest(request: Request): SessionInfo | null {
  const authCfg = getGitHubAuthConfig();
  if (!authCfg) return null;
  const token = extractCookieValue(
    request.headers.get("cookie"),
    SESSION_COOKIE_NAME,
  );
  return verifySessionToken(token, authCfg.sessionSecret, authCfg.allowedUsers);
}

export function isAuthorizedAdminRequest(request: Request): boolean {
  return hasValidCronBearer(request) || getSessionFromRequest(request) !== null;
}

export function resolvePublicOrigin(request: Request): string {
  const configured = optionalEnv("APP_BASE_URL");
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return new URL(request.url).origin;
}

export function buildSessionCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function buildClearSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function buildOAuthStateCookieHeader(state: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(state)}; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_STATE_TTL_SECONDS}${secure}`;
}

export function buildClearOAuthStateCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OAUTH_STATE_COOKIE_NAME}=; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
