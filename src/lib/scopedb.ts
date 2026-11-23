import {
  Client,
  encodeAppendRecord,
  type CatalogTable,
  type Table,
  type Value,
} from "scopedb";
import { getScopeDBConfig } from "./config";

export const TABLE_STORY_SNAPSHOTS = "hn_story_snapshots";
export const TABLE_COMMENTS = "hn_comments";
export const TABLE_EVENTS = "hn_events";
export const TABLE_VERCEL_EVENTS = "vercel_events";

export interface StorySnapshotRow {
  observed_at: string;
  story_id: number;
  source: "authored" | "mention";
  author: string;
  title: string;
  url: string;
  points: number;
  num_comments: number;
  frontpage_rank: number | null;
}

export interface CommentRow {
  observed_at: string;
  comment_id: number;
  story_id: number;
  story_title: string;
  parent_id: number;
  kind: "story_comment" | "reply_to_me";
  author: string;
  text: string;
  created_at: string;
}

export type EventType =
  | "baseline_seeded"
  | "notified_comment"
  | "notified_milestone"
  | "notified_frontpage"
  | "notified_mention"
  | "inbox_read"
  | "inbox_replied"
  | "inbox_unread"
  | "logs_acked";

export interface EventRow {
  event_time: string;
  event_type: EventType;
  target_id: number;
  channel: string;
  status: "ok" | "failed" | "seeded";
  payload: Record<string, unknown>;
}

/**
 * Matches the 13-column `scopedb.public.vercel_events` contract defined in
 * `scopedb/vercel-drain` so prebuilt views (`v_vercel_errors`, `v_vercel_requests`)
 * work seamlessly with Next.js `after()` application telemetry on any Vercel plan.
 */
export interface VercelEventRow {
  event_id: string;
  occurred_at: string;
  service: string;
  event_type:
    | "vercel.request"
    | "vercel.log"
    | "vercel.pageview"
    | "vercel.custom_event"
    | "vercel.web_vital";
  outcome: "ok" | "client_error" | "error";
  level: "debug" | "info" | "warn" | "error";
  method: string | null;
  host: string | null;
  path: string | null;
  status: number | null;
  request_id: string | null;
  message: string;
  attributes: Record<string, unknown>;
}

export const TABLE_DEFINITIONS: CatalogTable[] = [
  {
    name: TABLE_STORY_SNAPSHOTS,
    comment: "Periodic Hacker News story score and ranking snapshots",
    columns: [
      { name: "observed_at", data_type: "timestamp" },
      { name: "story_id", data_type: "int" },
      { name: "source", data_type: "string" },
      { name: "author", data_type: "string" },
      { name: "title", data_type: "string" },
      { name: "url", data_type: "string" },
      { name: "points", data_type: "int" },
      { name: "num_comments", data_type: "int" },
      { name: "frontpage_rank", data_type: "int" },
    ],
  },
  {
    name: TABLE_COMMENTS,
    comment: "Captured Hacker News comments and direct replies",
    columns: [
      { name: "observed_at", data_type: "timestamp" },
      { name: "comment_id", data_type: "int" },
      { name: "story_id", data_type: "int" },
      { name: "story_title", data_type: "string" },
      { name: "parent_id", data_type: "int" },
      { name: "kind", data_type: "string" },
      { name: "author", data_type: "string" },
      { name: "text", data_type: "string" },
      { name: "created_at", data_type: "timestamp" },
    ],
  },
  {
    name: TABLE_EVENTS,
    comment: "Append-only notification audit and inbox state log",
    columns: [
      { name: "event_time", data_type: "timestamp" },
      { name: "event_type", data_type: "string" },
      { name: "target_id", data_type: "int" },
      { name: "channel", data_type: "string" },
      { name: "status", data_type: "string" },
      { name: "payload", data_type: "object" },
    ],
  },
  {
    name: TABLE_VERCEL_EVENTS,
    comment:
      "Vercel runtime and application telemetry compatible with scopedb/vercel-drain views",
    columns: [
      { name: "event_id", data_type: "string" },
      { name: "occurred_at", data_type: "timestamp" },
      { name: "service", data_type: "string" },
      { name: "event_type", data_type: "string" },
      { name: "outcome", data_type: "string" },
      { name: "level", data_type: "string" },
      { name: "method", data_type: "string" },
      { name: "host", data_type: "string" },
      { name: "path", data_type: "string" },
      { name: "status", data_type: "int" },
      { name: "request_id", data_type: "string" },
      { name: "message", data_type: "string" },
      { name: "attributes", data_type: "object" },
    ],
    cluster_by: ["service", "occurred_at"],
  },
];

let cachedClient: { key: string; client: Client } | null = null;

export function getScopeDBClient(): Client {
  const cfg = getScopeDBConfig();
  const cacheKey = `${cfg.endpoint}|${cfg.apiKey}`;
  if (cachedClient && cachedClient.key === cacheKey) {
    return cachedClient.client;
  }
  const client = new Client(cfg.endpoint, {
    apiKey: cfg.apiKey,
    writeTimeoutMs: 25_000,
  });
  cachedClient = { key: cacheKey, client };
  return client;
}

export function getTables() {
  const cfg = getScopeDBConfig();
  const client = getScopeDBClient();
  const opts = { database: cfg.database, schema: cfg.schema };
  return {
    client,
    snapshots: client.table(TABLE_STORY_SNAPSHOTS, opts),
    comments: client.table(TABLE_COMMENTS, opts),
    events: client.table(TABLE_EVENTS, opts),
    vercelEvents: client.table(TABLE_VERCEL_EVENTS, opts),
  };
}

export async function ensureScopeDBTables(): Promise<
  Array<{ name: string; version: string }>
> {
  const cfg = getScopeDBConfig();
  const client = getScopeDBClient();
  const results: Array<{ name: string; version: string }> = [];

  for (const def of TABLE_DEFINITIONS) {
    const resource = client
      .table(def.name, { database: cfg.database, schema: cfg.schema })
      .catalog();
    const res = await resource.apply(def, {
      timeoutMs: 25_000,
    });
    results.push({ name: def.name, version: res.version });
  }

  return results;
}

async function appendRecords(
  table: Table,
  rows: Array<Record<string, unknown>>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const ndjson = rows.map((row) => encodeAppendRecord(row)).join("\n");
  const result = await table.append(ndjson, {
    signal: AbortSignal.timeout(25_000),
  });
  return result.num_rows_inserted;
}

export async function appendStorySnapshots(
  rows: StorySnapshotRow[],
): Promise<number> {
  const { snapshots } = getTables();
  return appendRecords(
    snapshots,
    rows.map((r) => ({
      observed_at: r.observed_at,
      story_id: r.story_id,
      source: r.source,
      author: r.author,
      title: r.title,
      url: r.url,
      points: r.points,
      num_comments: r.num_comments,
      frontpage_rank: r.frontpage_rank ?? null,
    })),
  );
}

export async function appendComments(rows: CommentRow[]): Promise<number> {
  const { comments } = getTables();
  return appendRecords(
    comments,
    rows.map((r) => ({
      observed_at: r.observed_at,
      comment_id: r.comment_id,
      story_id: r.story_id,
      story_title: r.story_title,
      parent_id: r.parent_id,
      kind: r.kind,
      author: r.author,
      text: r.text,
      created_at: r.created_at,
    })),
  );
}

export async function appendEvents(rows: EventRow[]): Promise<number> {
  const { events } = getTables();
  return appendRecords(
    events,
    rows.map((r) => ({
      event_time: r.event_time,
      event_type: r.event_type,
      target_id: r.target_id,
      channel: r.channel,
      status: r.status,
      payload: r.payload,
    })),
  );
}

export async function appendVercelEvents(
  rows: VercelEventRow[],
): Promise<number> {
  const { vercelEvents } = getTables();
  return appendRecords(
    vercelEvents,
    rows.map((r) => ({
      event_id: r.event_id,
      occurred_at: r.occurred_at,
      service: r.service,
      event_type: r.event_type,
      outcome: r.outcome,
      level: r.level,
      method: r.method ?? null,
      host: r.host ?? null,
      path: r.path ?? null,
      status: r.status ?? null,
      request_id: r.request_id ?? null,
      message: r.message,
      attributes: r.attributes,
    })),
  );
}

function asIsoString(value: Value | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date(0).toISOString();
}

function asNumber(value: Value | undefined, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asNullableNumber(value: Value | undefined): number | null {
  if (value === null || value === undefined) return null;
  return asNumber(value);
}

function asString(value: Value | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asJsonObject(value: Value | undefined): Record<string, unknown> {
  if (typeof value !== "string" || value.length === 0) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export async function queryRecentSnapshots(
  limit = 2000,
): Promise<StorySnapshotRow[]> {
  const { client, snapshots } = getTables();
  const sql = `
    FROM ${snapshots.identifier()}
    SELECT observed_at, story_id, source, author, title, url, points, num_comments, frontpage_rank
    ORDER BY observed_at DESC
    LIMIT ${limit}
  `;
  const result = await client.query(sql, { signal: AbortSignal.timeout(25_000) });
  return result.toObjects({ integerMode: "number" }).map((row) => ({
    observed_at: asIsoString(row["observed_at"]),
    story_id: asNumber(row["story_id"]),
    source:
      asString(row["source"]) === "mention" ? "mention" : "authored",
    author: asString(row["author"]),
    title: asString(row["title"]),
    url: asString(row["url"]),
    points: asNumber(row["points"]),
    num_comments: asNumber(row["num_comments"]),
    frontpage_rank: asNullableNumber(row["frontpage_rank"]),
  }));
}

export async function queryRecentComments(limit = 500): Promise<CommentRow[]> {
  const { client, comments } = getTables();
  const sql = `
    FROM ${comments.identifier()}
    SELECT observed_at, comment_id, story_id, story_title, parent_id, kind, author, text, created_at
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  const result = await client.query(sql, { signal: AbortSignal.timeout(25_000) });
  return result.toObjects({ integerMode: "number" }).map((row) => ({
    observed_at: asIsoString(row["observed_at"]),
    comment_id: asNumber(row["comment_id"]),
    story_id: asNumber(row["story_id"]),
    story_title: asString(row["story_title"]),
    parent_id: asNumber(row["parent_id"]),
    kind:
      asString(row["kind"]) === "reply_to_me" ? "reply_to_me" : "story_comment",
    author: asString(row["author"]),
    text: asString(row["text"]),
    created_at: asIsoString(row["created_at"]),
  }));
}

export async function queryRecentEvents(limit = 3000): Promise<EventRow[]> {
  const { client, events } = getTables();
  const sql = `
    FROM ${events.identifier()}
    SELECT event_time, event_type, target_id, channel, status, payload
    ORDER BY event_time DESC
    LIMIT ${limit}
  `;
  const result = await client.query(sql, { signal: AbortSignal.timeout(25_000) });
  return result.toObjects({ integerMode: "number" }).map((row) => ({
    event_time: asIsoString(row["event_time"]),
    event_type: asString(row["event_type"]) as EventType,
    target_id: asNumber(row["target_id"]),
    channel: asString(row["channel"]),
    status: asString(row["status"]) as EventRow["status"],
    payload: asJsonObject(row["payload"]),
  }));
}

export async function queryRecentVercelEvents(
  limit = 100,
): Promise<VercelEventRow[]> {
  const { client, vercelEvents } = getTables();
  const sql = `
    FROM ${vercelEvents.identifier()}
    SELECT event_id, occurred_at, service, event_type, outcome, level, method, host, path, status, request_id, message, attributes
    ORDER BY occurred_at DESC
    LIMIT ${limit}
  `;
  const result = await client.query(sql, { signal: AbortSignal.timeout(25_000) });
  return result.toObjects({ integerMode: "number" }).map((row) => {
    const rawOutcome = asString(row["outcome"]);
    const outcome: VercelEventRow["outcome"] =
      rawOutcome === "error" || rawOutcome === "client_error"
        ? rawOutcome
        : "ok";
    const rawLevel = asString(row["level"]);
    const level: VercelEventRow["level"] =
      rawLevel === "error" ||
      rawLevel === "warn" ||
      rawLevel === "debug"
        ? rawLevel
        : "info";

    return {
      event_id: asString(row["event_id"]),
      occurred_at: asIsoString(row["occurred_at"]),
      service: asString(row["service"]),
      event_type: (asString(row["event_type"]) ||
        "vercel.custom_event") as VercelEventRow["event_type"],
      outcome,
      level,
      method: row["method"] === null ? null : asString(row["method"]),
      host: row["host"] === null ? null : asString(row["host"]),
      path: row["path"] === null ? null : asString(row["path"]),
      status: asNullableNumber(row["status"]),
      request_id:
        row["request_id"] === null ? null : asString(row["request_id"]),
      message: asString(row["message"]),
      attributes: asJsonObject(row["attributes"]),
    };
  });
}
