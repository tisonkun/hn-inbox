import crypto from "node:crypto";
import { after } from "next/server";
import { optionalEnv } from "./config";
import { appendVercelEvents, type VercelEventRow } from "./scopedb";

export interface TelemetryEventInput {
  request?: Request;
  eventType?: VercelEventRow["event_type"];
  message: string;
  status?: number | null;
  outcome?: VercelEventRow["outcome"];
  level?: VercelEventRow["level"];
  durationMs?: number;
  error?: unknown;
  attributes?: Record<string, unknown>;
}

const MAX_MESSAGE_LEN = 2048;
const MAX_STACK_LEN = 4096;

function deriveOutcome(
  status: number | null,
  explicit?: VercelEventRow["outcome"],
): VercelEventRow["outcome"] {
  if (explicit) return explicit;
  if (status === null) return "ok";
  if (status >= 500) return "error";
  if (status >= 400) return "client_error";
  return "ok";
}

function deriveLevel(
  outcome: VercelEventRow["outcome"],
  explicit?: VercelEventRow["level"],
): VercelEventRow["level"] {
  if (explicit) return explicit;
  if (outcome === "error") return "error";
  if (outcome === "client_error") return "warn";
  return "info";
}

function sanitizeAttributeValue(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      return String(value);
    }
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : "Invalid Date";
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message.slice(0, MAX_MESSAGE_LEN),
      ...(typeof value.stack === "string"
        ? { stack: value.stack.slice(0, MAX_STACK_LEN) }
        : {}),
    };
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (seen.has(value)) return "[Circular]";
  if (depth >= 6) return "[MaxDepth]";

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeAttributeValue(item, depth + 1, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = sanitizeAttributeValue(v, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

export function buildVercelEventRow(
  input: TelemetryEventInput,
  nowIso: string = new Date().toISOString(),
): VercelEventRow {
  let method: string | null = null;
  let host: string | null = null;
  let path: string | null = null;
  let requestId: string | null = null;

  if (input.request) {
    method = input.request.method || null;
    requestId = input.request.headers.get("x-vercel-id") ?? null;
    try {
      // Only capture pathname; omit query string so OAuth codes/states never leak.
      const parsed = new URL(input.request.url);
      host = parsed.hostname || null;
      path = parsed.pathname || null;
    } catch {
      host = null;
      path = null;
    }
  }

  const status =
    typeof input.status === "number" && Number.isSafeInteger(input.status)
      ? input.status
      : null;
  const outcome = deriveOutcome(status, input.outcome);
  const level = deriveLevel(outcome, input.level);

  const attrs: Record<string, unknown> = {
    source: "nextjs.after",
  };
  const envName = optionalEnv("VERCEL_ENV");
  if (envName) attrs["environment"] = envName;
  const deploymentId = optionalEnv("VERCEL_DEPLOYMENT_ID");
  if (deploymentId) attrs["deployment_id"] = deploymentId;
  if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs)) {
    attrs["duration_ms"] = Math.max(0, Math.round(input.durationMs));
  }
  if (input.error !== undefined) {
    attrs["error"] = sanitizeAttributeValue(input.error);
  }
  if (input.attributes) {
    for (const [k, v] of Object.entries(input.attributes)) {
      if (v === undefined) continue;
      attrs[k] = sanitizeAttributeValue(v);
    }
  }

  return {
    event_id: crypto.randomUUID(),
    occurred_at: nowIso,
    service: optionalEnv("VERCEL_PROJECT_NAME") ?? "hn-inbox",
    event_type: input.eventType ?? "vercel.custom_event",
    outcome,
    level,
    method,
    host,
    path,
    status,
    request_id: requestId,
    message: input.message.slice(0, MAX_MESSAGE_LEN),
    attributes: attrs,
  };
}

/**
 * Schedules a non-blocking append into `scopedb.public.vercel_events` via Next.js `after()`.
 * Never throws into the caller so telemetry outages cannot disrupt app requests.
 */
export function emitTelemetryAfter(input: TelemetryEventInput): void {
  const row = buildVercelEventRow(input);
  const flush = async () => {
    try {
      await appendVercelEvents([row]);
    } catch (err) {
      console.error("Failed to append telemetry event to vercel_events:", err);
    }
  };

  try {
    after(flush);
  } catch {
    // Fallback when invoked outside a Next.js request lifecycle (e.g. CLI or tests).
    void flush();
  }
}
