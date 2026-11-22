import { describe, expect, it } from "vitest";
import { computePollDiff, deduplicateComments } from "../poll";
import type { HnComment, HnStory } from "../hn";
import type { EventRow } from "../scopedb";

const BASE_TIME = "2026-11-22T10:00:00.000Z";

function makeStory(overrides: Partial<HnStory> = {}): HnStory {
  return {
    storyId: 1001,
    source: "authored",
    author: "alice",
    title: "Show HN: Example",
    url: "https://example.com/post",
    points: 15,
    numComments: 2,
    createdAt: "2026-11-22T09:00:00.000Z",
    frontpageRank: null,
    ...overrides,
  };
}

function makeComment(overrides: Partial<HnComment> = {}): HnComment {
  return {
    commentId: 2001,
    storyId: 1001,
    storyTitle: "Show HN: Example",
    parentId: 1001,
    kind: "story_comment",
    author: "bob",
    text: "Interesting write-up.",
    createdAt: "2026-11-22T09:30:00.000Z",
    ...overrides,
  };
}

describe("deduplicateComments", () => {
  it("prefers reply_to_me over story_comment when the same comment appears twice", () => {
    const deduped = deduplicateComments([
      makeComment({ commentId: 2001, kind: "story_comment" }),
      makeComment({ commentId: 2001, kind: "reply_to_me" }),
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].kind).toBe("reply_to_me");
  });
});

describe("computePollDiff", () => {
  it("seeds baseline without emitting notifications on the very first run", () => {
    const diff = computePollDiff({
      nowIso: BASE_TIME,
      stories: [
        makeStory({ storyId: 1001, points: 46, frontpageRank: 12 }),
        makeStory({
          storyId: 1002,
          source: "mention",
          author: "carol",
          points: 20,
        }),
      ],
      comments: [makeComment({ commentId: 2001 })],
      existingCommentIds: new Set(),
      existingEvents: [],
      scoreMilestones: [10, 30, 50, 100],
    });

    expect(diff.isBaselineSeed).toBe(true);
    expect(diff.notifications).toHaveLength(0);
    expect(diff.newCommentsToStore).toHaveLength(1);
    expect(diff.seedEvents.some((e) => e.event_type === "baseline_seeded")).toBe(
      true,
    );
    expect(
      diff.seedEvents.some(
        (e) => e.event_type === "notified_comment" && e.target_id === 2001,
      ),
    ).toBe(true);
    expect(
      diff.seedEvents.some(
        (e) =>
          e.event_type === "notified_milestone" &&
          e.target_id === 1001 &&
          e.payload["milestone"] === 30,
      ),
    ).toBe(true);
  });

  it("emits only the highest newly crossed milestone and retries failed deliveries", () => {
    const existingEvents: EventRow[] = [
      {
        event_time: "2026-11-22T09:45:00.000Z",
        event_type: "baseline_seeded",
        target_id: 0,
        channel: "system",
        status: "seeded",
        payload: {},
      },
      {
        event_time: "2026-11-22T09:45:00.000Z",
        event_type: "notified_milestone",
        target_id: 1001,
        channel: "email:resend",
        status: "ok",
        payload: { milestone: 10 },
      },
      {
        event_time: "2026-11-22T09:45:00.000Z",
        event_type: "notified_comment",
        target_id: 2001,
        channel: "email:resend",
        status: "failed",
        payload: { error: "temporary 500" },
      },
    ];

    const diff = computePollDiff({
      nowIso: BASE_TIME,
      stories: [makeStory({ storyId: 1001, points: 68, frontpageRank: 9 })],
      comments: [makeComment({ commentId: 2001 })],
      existingCommentIds: new Set([2001]),
      existingEvents,
      scoreMilestones: [10, 30, 50, 100],
    });

    expect(diff.isBaselineSeed).toBe(false);
    expect(diff.newCommentsToStore).toHaveLength(0);

    // Comment 2001 had only a failed delivery, so it should be retried.
    expect(
      diff.notifications.filter((n) => n.kind === "new_comment"),
    ).toHaveLength(1);

    // Jumped from 10 -> 68 across both 30 and 50: emit only the highest (50).
    const milestones = diff.notifications.filter(
      (n) => n.kind === "score_milestone",
    );
    expect(milestones).toHaveLength(1);
    expect(milestones[0].milestone).toBe(50);

    // Entered front page for the first time.
    const fp = diff.notifications.filter((n) => n.kind === "frontpage_entry");
    expect(fp).toHaveLength(1);
    expect(fp[0].rank).toBe(9);
  });
});
