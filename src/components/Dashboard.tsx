"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DashboardData,
  InboxCommentItem,
  InboxItemStatus,
} from "@/lib/inbox";
import { Sparkline } from "./Sparkline";

interface DashboardProps {
  hnUsername: string;
  signedInAs: string;
  initialData: DashboardData | null;
  initialError: string | null;
}

function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function Dashboard({
  hnUsername,
  signedInAs,
  initialData,
  initialError,
}: DashboardProps) {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(initialData);
  const [error, setError] = useState<string | null>(initialError);
  const [tab, setTab] = useState<"inbox" | "stories" | "logs">("inbox");
  const [filter, setFilter] = useState<"unread" | "all" | "replied">("unread");
  const [logFilter, setLogFilter] = useState<"all" | "errors" | "polls">("all");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  async function refreshData() {
    const res = await fetch("/api/inbox", { cache: "no-store" });
    if (res.status === 401) {
      router.refresh();
      return;
    }
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Failed to refresh inbox");
    }
    const fresh = (await res.json()) as DashboardData;
    setData(fresh);
    setError(null);
  }

  async function handleSync() {
    setSyncing(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Sync failed");
      }
      const summary = (await res.json()) as {
        isBaselineSeed: boolean;
        storiesObserved: number;
        commentsStored: number;
        notificationsGenerated: number;
      };
      await refreshData();
      setNotice(
        summary.isBaselineSeed
          ? `Baseline seeded (${summary.storiesObserved} stories, ${summary.commentsStored} comments). Future runs will trigger alerts.`
          : `Synced ${summary.storiesObserved} stories, ${summary.commentsStored} new comments, ${summary.notificationsGenerated} alert(s).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleInitDb() {
    setInitializing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/init", { method: "POST" });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Initialization failed");
      }
      setNotice("ScopeDB tables initialized. Click Sync Now to fetch your HN data.");
      await refreshData().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Initialization failed");
    } finally {
      setInitializing(false);
    }
  }

  async function handleStatusChange(
    commentId: number,
    status: InboxItemStatus,
  ) {
    if (!data) return;
    const prev = data;
    const updatedComments = data.comments.map((c) =>
      c.commentId === commentId ? { ...c, status } : c,
    );
    setData({
      ...data,
      comments: updatedComments,
      unreadCount: updatedComments.filter((c) => c.status === "unread").length,
    });

    try {
      const res = await fetch("/api/inbox/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId, status }),
      });
      if (!res.ok) {
        setData(prev);
        setError("Failed to persist status update");
      }
    } catch {
      setData(prev);
      setError("Network error while updating status");
    }
  }

  async function handleCopyContext(comment: InboxCommentItem) {
    const context = [
      `HN Story: ${comment.storyTitle}`,
      `Comment by ${comment.author} (${comment.itemUrl}):`,
      "",
      comment.text,
    ].join("\n");
    await navigator.clipboard.writeText(context);
    setCopiedId(comment.commentId);
    setTimeout(() => {
      setCopiedId((cur) => (cur === comment.commentId ? null : cur));
    }, 2000);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  const visibleComments = (data?.comments ?? []).filter((c) => {
    if (filter === "unread") return c.status === "unread";
    if (filter === "replied") return c.status === "replied";
    return true;
  });

  const visibleLogs = (data?.logs ?? []).filter((l) => {
    if (logFilter === "errors") {
      return l.level === "error" || l.outcome === "error";
    }
    if (logFilter === "polls") {
      return l.path === "/api/schedules/poll" || l.path === "/api/sync";
    }
    return true;
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 pb-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-orange-600 text-sm font-bold text-white">
            Y
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-stone-900">
              HN Inbox
              {hnUsername && (
                <span className="ml-2 text-sm font-normal text-stone-500">
                  @{hnUsername}
                </span>
              )}
            </h1>
            <p className="text-xs text-stone-500">
              {data?.lastSyncedAt
                ? `Last synced ${formatRelativeTime(data.lastSyncedAt)}`
                : "Not synced yet"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-stone-500 sm:inline">
            @{signedInAs}
          </span>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="rounded-lg bg-stone-900 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-100"
          >
            Sign out
          </button>
        </div>
      </header>

      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </div>
      )}

      {error && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span>{error}</span>
          <button
            type="button"
            onClick={handleInitDb}
            disabled={initializing}
            className="rounded-md bg-red-700 px-3 py-1 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
          >
            {initializing ? "Initializing..." : "Initialize ScopeDB Tables"}
          </button>
        </div>
      )}

      <nav className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-1 rounded-lg bg-stone-200/70 p-1">
          <button
            type="button"
            onClick={() => setTab("inbox")}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
              tab === "inbox"
                ? "bg-white text-stone-900 shadow-2xs"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            Inbox
            {(data?.unreadCount ?? 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-orange-600 px-1.5 py-0.5 text-xs text-white">
                {data?.unreadCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab("stories")}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
              tab === "stories"
                ? "bg-white text-stone-900 shadow-2xs"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            Stories ({data?.stories.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setTab("logs")}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
              tab === "logs"
                ? "bg-white text-stone-900 shadow-2xs"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            Logs
            {(data?.errorCount ?? 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-xs text-white">
                {data?.errorCount}
              </span>
            )}
          </button>
        </div>

        {tab === "inbox" && (
          <div className="flex items-center gap-1 text-xs">
            {(["unread", "all", "replied"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-md px-2.5 py-1 font-medium capitalize transition ${
                  filter === f
                    ? "bg-stone-900 text-white"
                    : "text-stone-600 hover:bg-stone-200/70"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        {tab === "logs" && (
          <div className="flex items-center gap-1 text-xs">
            {(["all", "errors", "polls"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setLogFilter(f)}
                className={`rounded-md px-2.5 py-1 font-medium capitalize transition ${
                  logFilter === f
                    ? "bg-stone-900 text-white"
                    : "text-stone-600 hover:bg-stone-200/70"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </nav>

      {tab === "inbox" ? (
        <section className="space-y-3">
          {visibleComments.length === 0 ? (
            <div className="rounded-xl border border-stone-200 bg-white px-6 py-12 text-center text-sm text-stone-500">
              {filter === "unread"
                ? "All caught up. No unread HN comments."
                : "No comments captured yet. Click Sync Now to fetch recent threads."}
            </div>
          ) : (
            visibleComments.map((comment) => (
              <article
                key={comment.commentId}
                className={`rounded-xl border bg-white p-5 transition ${
                  comment.status === "unread"
                    ? "border-orange-200 shadow-2xs"
                    : "border-stone-200 opacity-85"
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        comment.kind === "reply_to_me"
                          ? "bg-orange-100 text-orange-800"
                          : "bg-stone-100 text-stone-700"
                      }`}
                    >
                      {comment.kind === "reply_to_me"
                        ? "Direct Reply"
                        : "Comment"}
                    </span>
                    <span className="font-medium text-stone-800">
                      {comment.author}
                    </span>
                    <span>·</span>
                    <span>{formatRelativeTime(comment.createdAt)}</span>
                  </div>
                  <span className="capitalize text-stone-400">
                    {comment.status}
                  </span>
                </div>

                <a
                  href={comment.itemUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mb-2.5 block text-sm font-medium text-stone-900 hover:text-orange-700"
                >
                  {comment.storyTitle}
                </a>

                <p className="mb-4 whitespace-pre-wrap rounded-lg border-l-2 border-orange-500 bg-stone-50 px-3.5 py-2.5 text-sm leading-relaxed text-stone-800">
                  {comment.text}
                </p>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <a
                    href={comment.replyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md bg-orange-600 px-3 py-1.5 font-medium text-white transition hover:bg-orange-700"
                  >
                    Reply on HN ↗
                  </a>
                  <button
                    type="button"
                    onClick={() => handleCopyContext(comment)}
                    className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-medium text-stone-700 transition hover:bg-stone-100"
                  >
                    {copiedId === comment.commentId
                      ? "Copied"
                      : "Copy Context"}
                  </button>
                  {comment.status !== "replied" && (
                    <button
                      type="button"
                      onClick={() =>
                        handleStatusChange(comment.commentId, "replied")
                      }
                      className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-medium text-stone-700 transition hover:bg-stone-100"
                    >
                      Mark Replied
                    </button>
                  )}
                  {comment.status === "unread" ? (
                    <button
                      type="button"
                      onClick={() =>
                        handleStatusChange(comment.commentId, "read")
                      }
                      className="rounded-md px-2.5 py-1.5 font-medium text-stone-500 transition hover:bg-stone-100 hover:text-stone-800"
                    >
                      Mark Read
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        handleStatusChange(comment.commentId, "unread")
                      }
                      className="rounded-md px-2.5 py-1.5 font-medium text-stone-500 transition hover:bg-stone-100 hover:text-stone-800"
                    >
                      Mark Unread
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </section>
      ) : tab === "stories" ? (
        <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
          {(data?.stories.length ?? 0) === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-stone-500">
              No stories tracked yet. Click Sync Now to start collecting
              snapshots.
            </div>
          ) : (
            <ul className="divide-y divide-stone-200">
              {data?.stories.map((story) => (
                <li
                  key={story.storyId}
                  className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${
                          story.source === "mention"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-stone-100 text-stone-700"
                        }`}
                      >
                        {story.source === "mention"
                          ? `Mention by ${story.author}`
                          : "Authored"}
                      </span>
                      {story.frontpageRank !== null ? (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 font-semibold text-orange-800">
                          Front Page #{story.frontpageRank}
                        </span>
                      ) : story.bestFrontpageRank !== null ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">
                          Peak FP #{story.bestFrontpageRank}
                        </span>
                      ) : null}
                    </div>

                    <a
                      href={story.itemUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-sm font-medium text-stone-900 hover:text-orange-700"
                    >
                      {story.title}
                    </a>

                    <p className="mt-1 text-xs text-stone-500">
                      {story.points} points · {story.numComments} comments ·
                      updated {formatRelativeTime(story.lastObservedAt)}
                    </p>
                  </div>

                  <div className="shrink-0">
                    <Sparkline values={story.history.map((h) => h.points)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="space-y-4">
          {data && !data.logsInitialized && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span>
                The <code className="font-mono">vercel_events</code> telemetry
                table is not initialized yet.
              </span>
              <button
                type="button"
                onClick={handleInitDb}
                disabled={initializing}
                className="rounded-md bg-amber-800 px-3 py-1 text-xs font-medium text-white hover:bg-amber-900 disabled:opacity-50"
              >
                {initializing ? "Initializing..." : "Initialize ScopeDB Tables"}
              </button>
            </div>
          )}

          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="mb-2.5 flex items-center justify-between text-xs text-stone-500">
              <span className="font-medium text-stone-800">
                Scheduled Poll Health (last {data?.scheduleHealth.length ?? 0}{" "}
                runs)
              </span>
              <span>/api/schedules/poll</span>
            </div>
            {(data?.scheduleHealth.length ?? 0) === 0 ? (
              <p className="text-xs text-stone-400">
                No scheduled poll telemetry recorded yet. Runs appear here after
                Vercel Schedules invokes /api/schedules/poll.
              </p>
            ) : (
              <div className="flex items-end gap-1.5">
                {data?.scheduleHealth.map((pt) => {
                  const color =
                    pt.outcome === "error"
                      ? "bg-red-500"
                      : pt.outcome === "client_error"
                        ? "bg-amber-400"
                        : "bg-emerald-500";
                  return (
                    <div
                      key={pt.eventId}
                      title={`${pt.message} · ${pt.status ?? "n/a"} · ${pt.durationMs !== null ? `${pt.durationMs}ms` : "n/a"} · ${pt.occurredAt}`}
                      className={`h-6 flex-1 rounded-xs ${color}`}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            {visibleLogs.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-stone-500">
                No matching telemetry events recorded yet.
              </div>
            ) : (
              <ul className="divide-y divide-stone-200">
                {visibleLogs.map((log) => {
                  const isExpanded = expandedLogId === log.event_id;
                  const duration =
                    typeof log.attributes["duration_ms"] === "number"
                      ? `${log.attributes["duration_ms"]}ms`
                      : null;
                  const badgeStyle =
                    log.outcome === "error" || log.level === "error"
                      ? "bg-red-100 text-red-800"
                      : log.outcome === "client_error" || log.level === "warn"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-emerald-100 text-emerald-800";

                  return (
                    <li key={log.event_id} className="px-5 py-3.5">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedLogId(isExpanded ? null : log.event_id)
                        }
                        className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                          <span
                            className={`rounded-full px-2 py-0.5 font-medium ${badgeStyle}`}
                          >
                            {log.status ?? log.level}
                          </span>
                          <span className="font-mono font-medium text-stone-900">
                            {log.message}
                          </span>
                          {log.path && (
                            <span className="font-mono text-stone-500">
                              {log.method ? `${log.method} ` : ""}
                              {log.path}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-stone-400">
                          {duration && <span>{duration}</span>}
                          <span>{formatRelativeTime(log.occurred_at)}</span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="mt-3 space-y-2 rounded-lg bg-stone-50 p-3 text-xs">
                          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-stone-500">
                            <span>time: {log.occurred_at}</span>
                            {log.request_id && (
                              <span>request_id: {log.request_id}</span>
                            )}
                          </div>
                          <pre className="overflow-x-auto font-mono text-stone-800">
                            {JSON.stringify(log.attributes, null, 2)}
                          </pre>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
