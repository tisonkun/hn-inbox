import { describe, expect, it } from "vitest";
import { buildScheduleHealth } from "../inbox";
import { buildVercelEventRow } from "../telemetry";
import type { VercelEventRow } from "../scopedb";

describe("buildVercelEventRow", () => {
  it("strips query parameters from request URLs so OAuth codes never leak", () => {
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
        status: 403,
        message: "auth.github.forbidden",
        durationMs: 42.7,
        attributes: { github_login: "stranger", skipped: undefined },
      },
      "2026-11-23T00:00:00.000Z",
    );

    expect(row.host).toBe("hn-inbox.example.com");
    expect(row.path).toBe("/api/auth/github/callback");
    expect(JSON.stringify(row)).not.toContain("secret_oauth_code");
    expect(JSON.stringify(row)).not.toContain("secret_state");
    expect(row.request_id).toBe("iad1::abc123");
    expect(row.outcome).toBe("client_error");
    expect(row.level).toBe("warn");
    expect(row.attributes["duration_ms"]).toBe(43);
    expect("skipped" in row.attributes).toBe(false);
  });

  it("serializes Error instances safely into attributes", () => {
    const row = buildVercelEventRow(
      {
        status: 500,
        message: "schedule.poll.failed",
        error: new Error("ScopeDB timeout"),
      },
      "2026-11-23T00:00:00.000Z",
    );

    expect(row.outcome).toBe("error");
    expect(row.level).toBe("error");
    expect(row.attributes["error"]).toMatchObject({
      name: "Error",
      message: "ScopeDB timeout",
    });
  });
});

describe("buildScheduleHealth", () => {
  it("filters scheduled poll runs and returns chronological order", () => {
    const makeLog = (
      id: string,
      path: string,
      occurred_at: string,
      outcome: VercelEventRow["outcome"],
    ): VercelEventRow => ({
      event_id: id,
      occurred_at,
      service: "hn-inbox",
      event_type: "vercel.custom_event",
      outcome,
      level: outcome === "error" ? "error" : "info",
      method: "POST",
      host: "hn-inbox.example.com",
      path,
      status: outcome === "error" ? 500 : 200,
      request_id: null,
      message: "schedule.poll",
      attributes: { duration_ms: 120 },
    });

    const health = buildScheduleHealth([
      makeLog("3", "/api/schedules/poll", "2026-11-23T00:30:00.000Z", "ok"),
      makeLog("2", "/api/sync", "2026-11-23T00:20:00.000Z", "ok"),
      makeLog("1", "/api/schedules/poll", "2026-11-23T00:15:00.000Z", "error"),
    ]);

    expect(health.map((h) => h.eventId)).toEqual(["1", "3"]);
    expect(health[0].outcome).toBe("error");
    expect(health[1].outcome).toBe("ok");
  });
});
