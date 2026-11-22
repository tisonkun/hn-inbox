import type { NotificationEvent } from "./types";

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(input: string, maxLen: number): string {
  if (input.length <= maxLen) return input;
  return `${input.slice(0, maxLen - 1)}…`;
}

export function buildEmailSubject(events: NotificationEvent[]): string {
  if (events.length === 1) {
    const ev = events[0];
    switch (ev.kind) {
      case "new_comment":
        return `[HN] ${ev.commentKind === "reply_to_me" ? "Reply" : "Comment"} from ${ev.author} on "${truncate(ev.storyTitle, 52)}"`;
      case "frontpage_entry":
        return `[HN] Front page #${ev.rank}: "${truncate(ev.title, 56)}" (${ev.points} pts)`;
      case "score_milestone":
        return `[HN] Crossed ${ev.milestone} pts (${ev.points} pts): "${truncate(ev.title, 48)}"`;
      case "domain_mention":
        return `[HN] External mention by ${ev.author}: "${truncate(ev.title, 52)}"`;
    }
  }

  const commentCount = events.filter((e) => e.kind === "new_comment").length;
  const parts: string[] = [];
  if (commentCount > 0) {
    parts.push(`${commentCount} new comment${commentCount === 1 ? "" : "s"}`);
  }
  const otherCount = events.length - commentCount;
  if (otherCount > 0) {
    parts.push(`${otherCount} story alert${otherCount === 1 ? "" : "s"}`);
  }
  return `[HN] ${parts.join(" & ")}`;
}

function renderEventText(ev: NotificationEvent): string {
  switch (ev.kind) {
    case "new_comment":
      return [
        `[${ev.commentKind === "reply_to_me" ? "DIRECT REPLY" : "NEW COMMENT"}] by ${ev.author}`,
        `Story: ${ev.storyTitle}`,
        "",
        ev.text,
        "",
        `Reply on HN: ${ev.replyUrl}`,
        `View comment: ${ev.itemUrl}`,
      ].join("\n");
    case "frontpage_entry":
      return [
        `[FRONT PAGE #${ev.rank}] ${ev.title}`,
        `Current stats: ${ev.points} points, ${ev.numComments} comments`,
        `Thread: ${ev.itemUrl}`,
      ].join("\n");
    case "score_milestone":
      return [
        `[MILESTONE ${ev.milestone}+ PTS] ${ev.title}`,
        `Current stats: ${ev.points} points, ${ev.numComments} comments${ev.frontpageRank ? `, Front page #${ev.frontpageRank}` : ""}`,
        `Thread: ${ev.itemUrl}`,
      ].join("\n");
    case "domain_mention":
      return [
        `[DOMAIN MENTION] Submitted by ${ev.author}`,
        `Title: ${ev.title}`,
        `URL: ${ev.url}`,
        `Stats: ${ev.points} points, ${ev.numComments} comments`,
        `Thread: ${ev.itemUrl}`,
      ].join("\n");
  }
}

function renderEventHtml(ev: NotificationEvent): string {
  switch (ev.kind) {
    case "new_comment": {
      const badge = ev.commentKind === "reply_to_me" ? "Direct Reply" : "New Comment";
      const safeBody = escapeHtml(ev.text).replace(/\n/g, "<br />");
      return `
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:14px;background:#ffffff;">
          <div style="font-size:12px;font-weight:600;color:#c2410c;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">
            ${escapeHtml(badge)} · ${escapeHtml(ev.author)}
          </div>
          <div style="font-size:14px;font-weight:600;color:#111827;margin-bottom:10px;">
            ${escapeHtml(ev.storyTitle)}
          </div>
          <div style="font-size:14px;line-height:1.6;color:#1f2937;background:#f9fafb;border-left:3px solid #f97316;padding:10px 12px;margin-bottom:12px;">
            ${safeBody}
          </div>
          <div>
            <a href="${escapeHtml(ev.replyUrl)}" style="display:inline-block;background:#ea580c;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:8px 14px;border-radius:6px;margin-right:8px;">Reply on HN</a>
            <a href="${escapeHtml(ev.itemUrl)}" style="display:inline-block;color:#374151;text-decoration:none;font-size:13px;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;">View Thread</a>
          </div>
        </div>`;
    }
    case "frontpage_entry":
      return `
        <div style="border:1px solid #fed7aa;border-radius:8px;padding:16px;margin-bottom:14px;background:#fff7ed;">
          <div style="font-size:12px;font-weight:600;color:#c2410c;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">
            Front Page #${ev.rank}
          </div>
          <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:6px;">
            ${escapeHtml(ev.title)}
          </div>
          <div style="font-size:13px;color:#4b5563;margin-bottom:12px;">
            ${ev.points} points · ${ev.numComments} comments
          </div>
          <a href="${escapeHtml(ev.itemUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:8px 14px;border-radius:6px;">Open HN Thread</a>
        </div>`;
    case "score_milestone":
      return `
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:14px;background:#ffffff;">
          <div style="font-size:12px;font-weight:600;color:#047857;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">
            Milestone: ${ev.milestone}+ Points
          </div>
          <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:6px;">
            ${escapeHtml(ev.title)}
          </div>
          <div style="font-size:13px;color:#4b5563;margin-bottom:12px;">
            Now at ${ev.points} points · ${ev.numComments} comments${ev.frontpageRank ? ` · Front Page #${ev.frontpageRank}` : ""}
          </div>
          <a href="${escapeHtml(ev.itemUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:8px 14px;border-radius:6px;">Open HN Thread</a>
        </div>`;
    case "domain_mention":
      return `
        <div style="border:1px solid #dbeafe;border-radius:8px;padding:16px;margin-bottom:14px;background:#eff6ff;">
          <div style="font-size:12px;font-weight:600;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">
            External Domain Mention · by ${escapeHtml(ev.author)}
          </div>
          <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:6px;">
            ${escapeHtml(ev.title)}
          </div>
          <div style="font-size:13px;color:#4b5563;margin-bottom:12px;">
            ${escapeHtml(ev.url)}<br />
            ${ev.points} points · ${ev.numComments} comments
          </div>
          <a href="${escapeHtml(ev.itemUrl)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:8px 14px;border-radius:6px;">Open HN Thread</a>
        </div>`;
  }
}

export function renderDigestEmail(
  events: NotificationEvent[],
  appBaseUrl: string | null,
): RenderedEmail {
  const subject = buildEmailSubject(events);
  const textSections = events.map(renderEventText);
  if (appBaseUrl) {
    textSections.push(`Open Web Inbox: ${appBaseUrl}`);
  }
  const text = textSections.join("\n\n----------------------------------------\n\n");

  const footerLink = appBaseUrl
    ? `<p style="margin-top:20px;font-size:13px;color:#6b7280;">Manage all threads in your <a href="${escapeHtml(appBaseUrl)}" style="color:#ea580c;">HN Inbox Dashboard</a>.</p>`
    : "";

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:640px;margin:0 auto;">
      <div style="font-size:13px;font-weight:600;color:#6b7280;margin-bottom:14px;">
        HN Inbox Update (${events.length} event${events.length === 1 ? "" : "s"})
      </div>
      ${events.map(renderEventHtml).join("\n")}
      ${footerLink}
    </div>
  </body>
</html>`;

  return { subject, text, html };
}
