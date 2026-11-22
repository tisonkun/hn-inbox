import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  isGitHubUserAllowed,
  verifySessionToken,
} from "../auth";

describe("GitHub allowlist and session token signing", () => {
  const secret = "test-session-secret-0123456789abcdef";

  it("matches allowlisted GitHub usernames case-insensitively", () => {
    expect(isGitHubUserAllowed("OctoCat", ["octocat"])).toBe(true);
    expect(isGitHubUserAllowed("mallory", ["octocat"])).toBe(false);
    expect(isGitHubUserAllowed("", ["octocat"])).toBe(false);
  });

  it("verifies valid tokens and rejects wrong secret, allowlist removal, tampering, or expiry", () => {
    const now = Date.parse("2026-11-22T10:00:00.000Z");
    const token = createSessionToken("OctoCat", secret, now);

    const verified = verifySessionToken(token, secret, ["octocat"], now + 1000);
    expect(verified?.login).toBe("OctoCat");

    // Immediately revoked when removed from GITHUB_ALLOWED_USERS.
    expect(verifySessionToken(token, secret, ["someone-else"], now + 1000)).toBeNull();

    // Wrong signing secret.
    expect(verifySessionToken(token, "wrong-secret", ["octocat"], now + 1000)).toBeNull();

    // Tampered signature.
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(verifySessionToken(tampered, secret, ["octocat"], now + 1000)).toBeNull();

    // Expired after 14 days.
    const after15Days = now + 15 * 24 * 60 * 60 * 1000;
    expect(verifySessionToken(token, secret, ["octocat"], after15Days)).toBeNull();
  });
});
