import { describe, expect, it } from "vitest";
import { renderDigestEmail } from "../notify/email-template";
import type { NotificationEvent } from "../notify/types";

describe("renderDigestEmail", () => {
  it("escapes untrusted HTML in comment text and includes direct reply link", () => {
    const events: NotificationEvent[] = [
      {
        kind: "new_comment",
        commentId: 999,
        storyId: 123,
        storyTitle: 'Test <script>alert("x")</script>',
        commentKind: "reply_to_me",
        author: "mallory",
        text: '<img src=x onerror="alert(1)"> & hello',
        createdAt: "2026-11-22T10:00:00.000Z",
        itemUrl: "https://news.ycombinator.com/item?id=999",
        replyUrl: "https://news.ycombinator.com/reply?id=999",
      },
    ];

    const email = renderDigestEmail(events, "https://inbox.example.com");
    expect(email.subject).toContain("Reply from mallory");
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img ");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(email.html).toContain("https://news.ycombinator.com/reply?id=999");
    expect(email.text).toContain("https://inbox.example.com");
  });

  it("summarizes multiple events into a single digest subject", () => {
    const events: NotificationEvent[] = [
      {
        kind: "new_comment",
        commentId: 1,
        storyId: 10,
        storyTitle: "Post A",
        commentKind: "story_comment",
        author: "u1",
        text: "First",
        createdAt: "2026-11-22T10:00:00.000Z",
        itemUrl: "https://news.ycombinator.com/item?id=1",
        replyUrl: "https://news.ycombinator.com/reply?id=1",
      },
      {
        kind: "frontpage_entry",
        storyId: 10,
        title: "Post A",
        rank: 14,
        points: 52,
        numComments: 8,
        itemUrl: "https://news.ycombinator.com/item?id=10",
      },
    ];

    const email = renderDigestEmail(events, null);
    expect(email.subject).toBe("[HN] 1 new comment & 1 story alert");
  });
});
