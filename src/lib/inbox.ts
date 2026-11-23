import { hnItemUrl, hnReplyUrl } from "./hn";
import {
  queryRecentComments,
  queryRecentEvents,
  queryRecentSnapshots,
  queryRecentVercelEvents,
  type CommentRow,
  type EventRow,
  type StorySnapshotRow,
  type VercelEventRow,
} from "./scopedb";

export type InboxItemStatus = "unread" | "read" | "replied";

export interface InboxCommentItem {
  commentId: number;
  storyId: number;
  storyTitle: string;
  parentId: number;
  kind: "story_comment" | "reply_to_me";
  author: string;
  text: string;
  createdAt: string;
  status: InboxItemStatus;
  itemUrl: string;
  replyUrl: string;
}

export interface StoryTrendPoint {
  observedAt: string;
  points: number;
  numComments: number;
  frontpageRank: number | null;
}

export interface StoryOverviewItem {
  storyId: number;
  source: "authored" | "mention";
  author: string;
  title: string;
  url: string;
  points: number;
  numComments: number;
  frontpageRank: number | null;
  bestFrontpageRank: number | null;
  lastObservedAt: string;
  itemUrl: string;
  history: StoryTrendPoint[];
}

export interface ScheduleHealthPoint {
  eventId: string;
  occurredAt: string;
  outcome: VercelEventRow["outcome"];
  status: number | null;
  durationMs: number | null;
  message: string;
}

export interface DashboardData {
  lastSyncedAt: string | null;
  unreadCount: number;
  errorCount: number;
  logsAckedAt: string | null;
  logsInitialized: boolean;
  comments: InboxCommentItem[];
  stories: StoryOverviewItem[];
  logs: VercelEventRow[];
  scheduleHealth: ScheduleHealthPoint[];
}

export function buildScheduleHealth(
  logs: VercelEventRow[],
  limit = 24,
): ScheduleHealthPoint[] {
  return logs
    .filter((log) => log.path === "/api/schedules/poll")
    .slice(0, limit)
    .reverse()
    .map((log) => {
      const rawDur = log.attributes["duration_ms"];
      const durationMs =
        typeof rawDur === "number" && Number.isFinite(rawDur) ? rawDur : null;
      return {
        eventId: log.event_id,
        occurredAt: log.occurred_at,
        outcome: log.outcome,
        status: log.status,
        durationMs,
        message: log.message,
      };
    });
}

export function buildDashboardData(
  snapshots: StorySnapshotRow[],
  comments: CommentRow[],
  events: EventRow[],
  logs: VercelEventRow[] = [],
  logsInitialized = true,
): DashboardData {
  // Determine latest inbox status per comment_id (events are sorted DESC by event_time).
  const statusByCommentId = new Map<number, InboxItemStatus>();
  for (const ev of events) {
    if (statusByCommentId.has(ev.target_id)) continue;
    if (ev.event_type === "inbox_replied") {
      statusByCommentId.set(ev.target_id, "replied");
    } else if (ev.event_type === "inbox_read") {
      statusByCommentId.set(ev.target_id, "read");
    } else if (ev.event_type === "inbox_unread") {
      statusByCommentId.set(ev.target_id, "unread");
    }
  }

  // Deduplicate comments by comment_id.
  const uniqueComments = new Map<number, CommentRow>();
  for (const row of comments) {
    if (!uniqueComments.has(row.comment_id)) {
      uniqueComments.set(row.comment_id, row);
    }
  }

  const inboxComments: InboxCommentItem[] = Array.from(uniqueComments.values())
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((c) => ({
      commentId: c.comment_id,
      storyId: c.story_id,
      storyTitle: c.story_title,
      parentId: c.parent_id,
      kind: c.kind,
      author: c.author,
      text: c.text,
      createdAt: c.created_at,
      status: statusByCommentId.get(c.comment_id) ?? "unread",
      itemUrl: hnItemUrl(c.comment_id),
      replyUrl: hnReplyUrl(c.comment_id),
    }));

  // Group story snapshots (input is ordered DESC by observed_at).
  const storyMap = new Map<number, StoryOverviewItem>();
  for (const snap of snapshots) {
    const existing = storyMap.get(snap.story_id);
    const point: StoryTrendPoint = {
      observedAt: snap.observed_at,
      points: snap.points,
      numComments: snap.num_comments,
      frontpageRank: snap.frontpage_rank,
    };

    if (!existing) {
      storyMap.set(snap.story_id, {
        storyId: snap.story_id,
        source: snap.source,
        author: snap.author,
        title: snap.title,
        url: snap.url,
        points: snap.points,
        numComments: snap.num_comments,
        frontpageRank: snap.frontpage_rank,
        bestFrontpageRank: snap.frontpage_rank,
        lastObservedAt: snap.observed_at,
        itemUrl: hnItemUrl(snap.story_id),
        history: [point],
      });
    } else {
      if (snap.frontpage_rank !== null) {
        existing.bestFrontpageRank =
          existing.bestFrontpageRank === null
            ? snap.frontpage_rank
            : Math.min(existing.bestFrontpageRank, snap.frontpage_rank);
      }
      if (existing.history.length < 48) {
        existing.history.push(point);
      }
    }
  }

  const stories = Array.from(storyMap.values())
    .map((story) => ({
      ...story,
      history: [...story.history].reverse(),
    }))
    .sort((a, b) => b.storyId - a.storyId);

  const lastSyncedAt = snapshots.length > 0 ? snapshots[0].observed_at : null;
  const unreadCount = inboxComments.filter((c) => c.status === "unread").length;

  // Latest logs_acked watermark (events are ordered DESC by event_time).
  let logsAckedAt: string | null = null;
  for (const ev of events) {
    if (ev.event_type === "logs_acked" && ev.status === "ok") {
      const explicit = ev.payload["acked_until"];
      logsAckedAt =
        typeof explicit === "string" && Number.isFinite(Date.parse(explicit))
          ? explicit
          : ev.event_time;
      break;
    }
  }
  const ackedMs = logsAckedAt ? Date.parse(logsAckedAt) : Number.NEGATIVE_INFINITY;
  const errorCount = logs.filter(
    (l) =>
      (l.level === "error" || l.outcome === "error") &&
      Date.parse(l.occurred_at) > ackedMs,
  ).length;
  const scheduleHealth = buildScheduleHealth(logs, 24);

  return {
    lastSyncedAt,
    unreadCount,
    errorCount,
    logsAckedAt,
    logsInitialized,
    comments: inboxComments,
    stories,
    logs,
    scheduleHealth,
  };
}

export async function loadDashboardData(): Promise<DashboardData> {
  const [snapshots, comments, events, logsResult] = await Promise.all([
    queryRecentSnapshots(2000),
    queryRecentComments(500),
    queryRecentEvents(3000),
    queryRecentVercelEvents(100)
      .then((rows) => ({ ok: true as const, rows }))
      .catch(() => ({ ok: false as const, rows: [] as VercelEventRow[] })),
  ]);
  return buildDashboardData(
    snapshots,
    comments,
    events,
    logsResult.rows,
    logsResult.ok,
  );
}
