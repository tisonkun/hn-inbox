import { getMonitorConfig, type MonitorConfig } from "./config";
import {
  fetchAuthoredStories,
  fetchCommentsForStories,
  fetchDirectRepliesToUserComments,
  fetchFrontpageRanks,
  fetchWatchedDomainStories,
  hnItemUrl,
  hnReplyUrl,
  type HnComment,
  type HnStory,
} from "./hn";
import { dispatchNotifications } from "./notify/dispatcher";
import type {
  ChannelDispatchResult,
  NotificationChannel,
  NotificationEvent,
} from "./notify/types";
import {
  appendComments,
  appendEvents,
  appendStorySnapshots,
  queryRecentComments,
  queryRecentEvents,
  type CommentRow,
  type EventRow,
  type StorySnapshotRow,
} from "./scopedb";

export interface PollDiffInput {
  nowIso: string;
  stories: HnStory[];
  comments: HnComment[];
  existingCommentIds: Set<number>;
  existingEvents: EventRow[];
  scoreMilestones: number[];
  forceSeedOnly?: boolean;
}

export interface PollDiffOutput {
  isBaselineSeed: boolean;
  newCommentsToStore: CommentRow[];
  snapshotsToStore: StorySnapshotRow[];
  notifications: NotificationEvent[];
  seedEvents: EventRow[];
}

export function deduplicateComments(comments: HnComment[]): HnComment[] {
  const byId = new Map<number, HnComment>();
  for (const comment of comments) {
    const prev = byId.get(comment.commentId);
    if (!prev) {
      byId.set(comment.commentId, comment);
    } else if (comment.kind === "reply_to_me" && prev.kind !== "reply_to_me") {
      // Prefer the more specific direct-reply classification.
      byId.set(comment.commentId, comment);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

function highestCrossedMilestone(
  points: number,
  milestones: number[],
): number | null {
  let highest: number | null = null;
  for (const m of milestones) {
    if (points >= m && (highest === null || m > highest)) {
      highest = m;
    }
  }
  return highest;
}

export function computePollDiff(input: PollDiffInput): PollDiffOutput {
  const {
    nowIso,
    stories,
    existingCommentIds,
    existingEvents,
    scoreMilestones,
    forceSeedOnly = false,
  } = input;

  const dedupedComments = deduplicateComments(input.comments);

  const hasBaseline = existingEvents.some(
    (ev) =>
      ev.event_type === "baseline_seeded" ||
      ev.status === "ok" ||
      ev.status === "seeded",
  );
  const isBaselineSeed = forceSeedOnly || !hasBaseline;

  const notifiedComments = new Set<number>();
  const notifiedFrontpage = new Set<number>();
  const notifiedMentions = new Set<number>();
  const maxNotifiedMilestone = new Map<number, number>();

  for (const ev of existingEvents) {
    if (ev.status !== "ok" && ev.status !== "seeded") continue;
    switch (ev.event_type) {
      case "notified_comment":
        notifiedComments.add(ev.target_id);
        break;
      case "notified_frontpage":
        notifiedFrontpage.add(ev.target_id);
        break;
      case "notified_mention":
        notifiedMentions.add(ev.target_id);
        break;
      case "notified_milestone": {
        const raw = ev.payload["milestone"];
        const val = typeof raw === "number" ? raw : Number(raw);
        if (Number.isFinite(val)) {
          const prev = maxNotifiedMilestone.get(ev.target_id) ?? 0;
          if (val > prev) {
            maxNotifiedMilestone.set(ev.target_id, val);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  const snapshotsToStore: StorySnapshotRow[] = stories.map((s) => ({
    observed_at: nowIso,
    story_id: s.storyId,
    source: s.source,
    author: s.author,
    title: s.title,
    url: s.url,
    points: s.points,
    num_comments: s.numComments,
    frontpage_rank: s.frontpageRank,
  }));

  const newCommentsToStore: CommentRow[] = dedupedComments
    .filter((c) => !existingCommentIds.has(c.commentId))
    .map((c) => ({
      observed_at: nowIso,
      comment_id: c.commentId,
      story_id: c.storyId,
      story_title: c.storyTitle,
      parent_id: c.parentId,
      kind: c.kind,
      author: c.author,
      text: c.text,
      created_at: c.createdAt,
    }));

  const notifications: NotificationEvent[] = [];
  const seedEvents: EventRow[] = [];

  if (isBaselineSeed) {
    seedEvents.push({
      event_time: nowIso,
      event_type: "baseline_seeded",
      target_id: 0,
      channel: "system",
      status: "seeded",
      payload: {
        stories: stories.length,
        comments: dedupedComments.length,
      },
    });
  }

  for (const comment of dedupedComments) {
    if (notifiedComments.has(comment.commentId)) continue;
    if (isBaselineSeed) {
      seedEvents.push({
        event_time: nowIso,
        event_type: "notified_comment",
        target_id: comment.commentId,
        channel: "system",
        status: "seeded",
        payload: { story_id: comment.storyId, author: comment.author },
      });
    } else {
      notifications.push({
        kind: "new_comment",
        commentId: comment.commentId,
        storyId: comment.storyId,
        storyTitle: comment.storyTitle,
        commentKind: comment.kind,
        author: comment.author,
        text: comment.text,
        createdAt: comment.createdAt,
        itemUrl: hnItemUrl(comment.commentId),
        replyUrl: hnReplyUrl(comment.commentId),
      });
    }
  }

  for (const story of stories) {
    if (story.source === "mention") {
      if (!notifiedMentions.has(story.storyId)) {
        if (isBaselineSeed) {
          seedEvents.push({
            event_time: nowIso,
            event_type: "notified_mention",
            target_id: story.storyId,
            channel: "system",
            status: "seeded",
            payload: { title: story.title, author: story.author },
          });
        } else {
          notifications.push({
            kind: "domain_mention",
            storyId: story.storyId,
            title: story.title,
            author: story.author,
            url: story.url,
            points: story.points,
            numComments: story.numComments,
            itemUrl: hnItemUrl(story.storyId),
          });
        }
      }
      continue;
    }

    // Authored story: frontpage entry
    if (
      story.frontpageRank !== null &&
      !notifiedFrontpage.has(story.storyId)
    ) {
      if (isBaselineSeed) {
        seedEvents.push({
          event_time: nowIso,
          event_type: "notified_frontpage",
          target_id: story.storyId,
          channel: "system",
          status: "seeded",
          payload: { rank: story.frontpageRank, points: story.points },
        });
      } else {
        notifications.push({
          kind: "frontpage_entry",
          storyId: story.storyId,
          title: story.title,
          rank: story.frontpageRank,
          points: story.points,
          numComments: story.numComments,
          itemUrl: hnItemUrl(story.storyId),
        });
      }
    }

    // Authored story: score milestones (emit only the highest newly crossed milestone)
    const crossed = highestCrossedMilestone(story.points, scoreMilestones);
    const prevMilestone = maxNotifiedMilestone.get(story.storyId) ?? 0;
    if (crossed !== null && crossed > prevMilestone) {
      if (isBaselineSeed) {
        seedEvents.push({
          event_time: nowIso,
          event_type: "notified_milestone",
          target_id: story.storyId,
          channel: "system",
          status: "seeded",
          payload: { milestone: crossed, points: story.points },
        });
      } else {
        notifications.push({
          kind: "score_milestone",
          storyId: story.storyId,
          title: story.title,
          milestone: crossed,
          points: story.points,
          numComments: story.numComments,
          frontpageRank: story.frontpageRank,
          itemUrl: hnItemUrl(story.storyId),
        });
      }
    }
  }

  return {
    isBaselineSeed,
    newCommentsToStore,
    snapshotsToStore,
    notifications,
    seedEvents,
  };
}

function buildDeliveryAuditEvents(
  nowIso: string,
  notifications: NotificationEvent[],
  results: ChannelDispatchResult[],
): EventRow[] {
  const rows: EventRow[] = [];
  for (const result of results) {
    const status = result.ok ? "ok" : "failed";
    for (const ev of notifications) {
      const errorMeta = result.error ? { error: result.error } : {};
      switch (ev.kind) {
        case "new_comment":
          rows.push({
            event_time: nowIso,
            event_type: "notified_comment",
            target_id: ev.commentId,
            channel: result.channelId,
            status,
            payload: {
              story_id: ev.storyId,
              author: ev.author,
              ...errorMeta,
            },
          });
          break;
        case "score_milestone":
          rows.push({
            event_time: nowIso,
            event_type: "notified_milestone",
            target_id: ev.storyId,
            channel: result.channelId,
            status,
            payload: {
              milestone: ev.milestone,
              points: ev.points,
              ...errorMeta,
            },
          });
          break;
        case "frontpage_entry":
          rows.push({
            event_time: nowIso,
            event_type: "notified_frontpage",
            target_id: ev.storyId,
            channel: result.channelId,
            status,
            payload: {
              rank: ev.rank,
              points: ev.points,
              ...errorMeta,
            },
          });
          break;
        case "domain_mention":
          rows.push({
            event_time: nowIso,
            event_type: "notified_mention",
            target_id: ev.storyId,
            channel: result.channelId,
            status,
            payload: {
              title: ev.title,
              author: ev.author,
              ...errorMeta,
            },
          });
          break;
      }
    }
  }
  return rows;
}

export interface PollCycleSummary {
  observedAt: string;
  isBaselineSeed: boolean;
  dryRun: boolean;
  storiesObserved: number;
  commentsStored: number;
  notificationsGenerated: number;
  channelResults: ChannelDispatchResult[];
}

export interface RunPollOptions {
  dryRun?: boolean;
  seedOnly?: boolean;
  config?: MonitorConfig;
  channels?: NotificationChannel[];
}

export async function runPollCycle(
  options: RunPollOptions = {},
): Promise<PollCycleSummary> {
  const cfg = options.config ?? getMonitorConfig();
  const dryRun = options.dryRun ?? false;
  const nowIso = new Date().toISOString();

  // 1. Fetch live Hacker News data in parallel.
  const frontpageRanks = await fetchFrontpageRanks();
  const [authoredStories, mentionStories, directReplies] = await Promise.all([
    fetchAuthoredStories(cfg.hnUsername, frontpageRanks),
    fetchWatchedDomainStories(
      cfg.watchDomains,
      cfg.hnUsername,
      frontpageRanks,
      cfg.lookbackDays,
    ),
    fetchDirectRepliesToUserComments(cfg.hnUsername, cfg.lookbackDays),
  ]);

  const allStories = [...authoredStories, ...mentionStories];
  const storyComments = await fetchCommentsForStories(
    authoredStories,
    cfg.hnUsername,
    cfg.lookbackDays,
  );
  const allComments = [...storyComments, ...directReplies];

  // 2. Load recent state from ScopeDB.
  const [existingComments, existingEvents] = await Promise.all([
    queryRecentComments(1000),
    queryRecentEvents(3000),
  ]);

  const existingCommentIds = new Set(existingComments.map((c) => c.comment_id));

  // 3. Compute diff.
  const diff = computePollDiff({
    nowIso,
    stories: allStories,
    comments: allComments,
    existingCommentIds,
    existingEvents,
    scoreMilestones: cfg.scoreMilestones,
    forceSeedOnly: options.seedOnly,
  });

  if (dryRun) {
    return {
      observedAt: nowIso,
      isBaselineSeed: diff.isBaselineSeed,
      dryRun: true,
      storiesObserved: diff.snapshotsToStore.length,
      commentsStored: diff.newCommentsToStore.length,
      notificationsGenerated: diff.notifications.length,
      channelResults: [],
    };
  }

  // 4. Persist observed snapshots and newly discovered comments.
  await Promise.all([
    appendStorySnapshots(diff.snapshotsToStore),
    appendComments(diff.newCommentsToStore),
  ]);

  if (diff.seedEvents.length > 0) {
    await appendEvents(diff.seedEvents);
  }

  // 5. Dispatch notifications across enabled channels and audit delivery.
  let channelResults: ChannelDispatchResult[] = [];
  if (diff.notifications.length > 0) {
    channelResults = await dispatchNotifications(
      diff.notifications,
      cfg.appBaseUrl,
      options.channels,
    );
    const auditRows = buildDeliveryAuditEvents(
      nowIso,
      diff.notifications,
      channelResults,
    );
    if (auditRows.length > 0) {
      await appendEvents(auditRows);
    }
  }

  return {
    observedAt: nowIso,
    isBaselineSeed: diff.isBaselineSeed,
    dryRun: false,
    storiesObserved: diff.snapshotsToStore.length,
    commentsStored: diff.newCommentsToStore.length,
    notificationsGenerated: diff.notifications.length,
    channelResults,
  };
}
