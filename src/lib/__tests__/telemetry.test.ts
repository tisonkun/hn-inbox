import { encodeAppendRecord } from "scopedb";
import { describe, expect, it } from "vitest";
import { buildVercelEventRow } from "../telemetry";

describe("telemetry ScopeDB encoding contract", () => {
  it("strips OAuth query parameters and produces a strict ScopeDB append record", () => {
    const req = new Request(
      "https://hn-inbox.example.com/api/auth/github/callback?code=secret_oauth_code&state=secret_state",
      {
        method: "GET",
        headers: { "x-vercel-id": "iad1::abc123" },
      },
    );

    const row = buildVercelEventRow(
      {
        request: req,
        status: 500,
        message: "auth.github.callback_error",
        durationMs: 42.7,
        error: new Error("upstream timeout"),
        attributes: { skipped: undefined, badNum: Number.NaN },
      },
      "2026-11-23T00:00:00.000Z",
    );

    // Must pass ScopeDB 0.4 strict encoding; otherwise after() silently drops telemetry.
    const encoded = encodeAppendRecord({ ...row });
    expect(encoded).not.toContain("secret_oauth_code");
    expect(encoded).not.toContain("secret_state");
    expect(row.path).toBe("/api/auth/github/callback");
  });
});
