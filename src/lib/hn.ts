export interface HnStory {
  storyId: number;
  source: "authored" | "mention";
  author: string;
  title: string;
  url: string;
  points: number;
  numComments: number;
  createdAt: string;
  frontpageRank: number | null;
}

export interface HnComment {
  commentId: number;
  storyId: number;
  storyTitle: string;
  parentId: number;
  kind: "story_comment" | "reply_to_me";
  author: string;
  text: string;
  createdAt: string;
}

const ALGOLIA_BASE = "https://hn.algolia.com/api/v1";
const FIREBASE_BASE = "https://hacker-news.firebaseio.com/v0";
const FETCH_TIMEOUT_MS = 12_000;

export function hnItemUrl(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

export function hnReplyUrl(id: number): string {
  return `https://news.ycombinator.com/reply?id=${id}`;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, code) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      const cp = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : match;
    }
    if (code.startsWith("#")) {
      const cp = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : match;
    }
    return NAMED_ENTITIES[code] ?? match;
  });
}

/**
 * Converts Hacker News comment HTML into readable plain text.
 * Preserves paragraph breaks and link destinations while stripping all tags.
 */
export function cleanHnHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  let text = raw;
  // Preserve link URLs when anchor text is truncated with an ellipsis.
  text = text.replace(
    /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, _q, href: string, inner: string) => {
      const decodedHref = decodeHtmlEntities(href).trim();
      const decodedInner = decodeHtmlEntities(inner.replace(/<[^>]+>/g, "")).trim();
      if (!decodedInner || decodedInner.endsWith("...") || decodedInner === decodedHref) {
        return decodedHref;
      }
      return `${decodedInner} (${decodedHref})`;
    },
  );
  text = text.replace(/<p\b[^>]*>/gi, "\n\n");
  text = text.replace(/<\/p>/gi, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<pre\b[^>]*>\s*<code\b[^>]*>/gi, "\n```\n");
  text = text.replace(/<\/code>\s*<\/pre>/gi, "\n```\n");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeHtmlEntities(text);
  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "hn-inbox/0.1 (+https://github.com/tisonkun/hn-inbox)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return (await response.json()) as T;
}

interface AlgoliaStoryHit {
  objectID: string;
  author?: string;
  title?: string | null;
  url?: string | null;
  points?: number | null;
  num_comments?: number | null;
  created_at?: string;
  created_at_i?: number;
}

interface AlgoliaCommentHit {
  objectID: string;
  author?: string;
  comment_text?: string | null;
  story_id?: number | null;
  story_title?: string | null;
  parent_id?: number | null;
  created_at?: string;
  created_at_i?: number;
}

interface AlgoliaSearchResponse<T> {
  hits: T[];
}

interface FirebaseItem {
  id: number;
  type?: string;
  by?: string;
  text?: string;
  parent?: number;
  kids?: number[];
  time?: number;
  dead?: boolean;
  deleted?: boolean;
}

export async function fetchFrontpageRanks(): Promise<Map<number, number>> {
  const ids = await fetchJson<number[]>(`${FIREBASE_BASE}/topstories.json`);
  const map = new Map<number, number>();
  const limit = Math.min(ids.length, 30);
  for (let i = 0; i < limit; i++) {
    map.set(ids[i], i + 1);
  }
  return map;
}

export async function fetchAuthoredStories(
  username: string,
  frontpageRanks: Map<number, number>,
): Promise<HnStory[]> {
  const params = new URLSearchParams({
    tags: `story,author_${username}`,
    hitsPerPage: "30",
  });
  const data = await fetchJson<AlgoliaSearchResponse<AlgoliaStoryHit>>(
    `${ALGOLIA_BASE}/search_by_date?${params.toString()}`,
  );

  return data.hits
    .map((hit): HnStory | null => {
      const storyId = Number.parseInt(hit.objectID, 10);
      if (!Number.isFinite(storyId)) return null;
      return {
        storyId,
        source: "authored",
        author: hit.author ?? username,
        title: hit.title ?? `(story #${storyId})`,
        url: hit.url ?? hnItemUrl(storyId),
        points: hit.points ?? 0,
        numComments: hit.num_comments ?? 0,
        createdAt: hit.created_at ?? new Date((hit.created_at_i ?? 0) * 1000).toISOString(),
        frontpageRank: frontpageRanks.get(storyId) ?? null,
      };
    })
    .filter((s): s is HnStory => s !== null);
}

export async function fetchWatchedDomainStories(
  watchDomains: string[],
  ownUsername: string,
  frontpageRanks: Map<number, number>,
  lookbackDays: number,
): Promise<HnStory[]> {
  if (watchDomains.length === 0) return [];
  const minTimestamp = Math.floor(Date.now() / 1000) - lookbackDays * 86_400;
  const lowerUser = ownUsername.toLowerCase();
  const seen = new Map<number, HnStory>();

  await Promise.all(
    watchDomains.map(async (domain) => {
      const params = new URLSearchParams({
        tags: "story",
        query: domain,
        numericFilters: `created_at_i>${minTimestamp}`,
        hitsPerPage: "20",
      });
      const data = await fetchJson<AlgoliaSearchResponse<AlgoliaStoryHit>>(
        `${ALGOLIA_BASE}/search_by_date?${params.toString()}`,
      );
      for (const hit of data.hits) {
        const storyId = Number.parseInt(hit.objectID, 10);
        if (!Number.isFinite(storyId) || seen.has(storyId)) continue;
        if ((hit.author ?? "").toLowerCase() === lowerUser) continue;

        const haystack = `${hit.url ?? ""} ${hit.title ?? ""}`.toLowerCase();
        if (!haystack.includes(domain.toLowerCase())) continue;

        seen.set(storyId, {
          storyId,
          source: "mention",
          author: hit.author ?? "unknown",
          title: hit.title ?? `(story #${storyId})`,
          url: hit.url ?? hnItemUrl(storyId),
          points: hit.points ?? 0,
          numComments: hit.num_comments ?? 0,
          createdAt:
            hit.created_at ??
            new Date((hit.created_at_i ?? 0) * 1000).toISOString(),
          frontpageRank: frontpageRanks.get(storyId) ?? null,
        });
      }
    }),
  );

  return Array.from(seen.values());
}

export async function fetchCommentsForStories(
  stories: HnStory[],
  ownUsername: string,
  lookbackDays: number,
): Promise<HnComment[]> {
  const cutoffMs = Date.now() - lookbackDays * 86_400_000;
  const activeStories = stories
    .filter(
      (s) =>
        s.source === "authored" &&
        (Date.parse(s.createdAt) >= cutoffMs || s.frontpageRank !== null),
    )
    .slice(0, 15);

  if (activeStories.length === 0) return [];
  const lowerUser = ownUsername.toLowerCase();
  const comments: HnComment[] = [];

  await Promise.all(
    activeStories.map(async (story) => {
      const params = new URLSearchParams({
        tags: `comment,story_${story.storyId}`,
        hitsPerPage: "100",
      });
      const data = await fetchJson<AlgoliaSearchResponse<AlgoliaCommentHit>>(
        `${ALGOLIA_BASE}/search_by_date?${params.toString()}`,
      );
      for (const hit of data.hits) {
        const commentId = Number.parseInt(hit.objectID, 10);
        if (!Number.isFinite(commentId)) continue;
        if (!hit.author || hit.author.toLowerCase() === lowerUser) continue;

        const cleaned = cleanHnHtml(hit.comment_text);
        if (!cleaned) continue;

        comments.push({
          commentId,
          storyId: hit.story_id ?? story.storyId,
          storyTitle: hit.story_title ?? story.title,
          parentId: hit.parent_id ?? story.storyId,
          kind: "story_comment",
          author: hit.author,
          text: cleaned,
          createdAt:
            hit.created_at ??
            new Date((hit.created_at_i ?? 0) * 1000).toISOString(),
        });
      }
    }),
  );

  return comments;
}

/**
 * Finds direct replies to the user's recent comments across any HN thread,
 * including threads authored by other users.
 */
export async function fetchDirectRepliesToUserComments(
  ownUsername: string,
  lookbackDays: number,
): Promise<HnComment[]> {
  const minTimestamp = Math.floor(Date.now() / 1000) - lookbackDays * 86_400;
  const params = new URLSearchParams({
    tags: `comment,author_${ownUsername}`,
    numericFilters: `created_at_i>${minTimestamp}`,
    hitsPerPage: "25",
  });
  const ownComments = await fetchJson<AlgoliaSearchResponse<AlgoliaCommentHit>>(
    `${ALGOLIA_BASE}/search_by_date?${params.toString()}`,
  );

  if (ownComments.hits.length === 0) return [];
  const lowerUser = ownUsername.toLowerCase();
  const replies: HnComment[] = [];

  await Promise.all(
    ownComments.hits.slice(0, 15).map(async (myComment) => {
      const myCommentId = Number.parseInt(myComment.objectID, 10);
      if (!Number.isFinite(myCommentId)) return;

      const fbComment = await fetchJson<FirebaseItem | null>(
        `${FIREBASE_BASE}/item/${myCommentId}.json`,
      ).catch(() => null);
      const kids = fbComment?.kids ?? [];
      if (kids.length === 0) return;

      const childItems = await Promise.all(
        kids.slice(0, 20).map((kidId) =>
          fetchJson<FirebaseItem | null>(
            `${FIREBASE_BASE}/item/${kidId}.json`,
          ).catch(() => null),
        ),
      );

      for (const child of childItems) {
        if (!child || child.deleted || child.dead || child.type !== "comment") {
          continue;
        }
        if (!child.by || child.by.toLowerCase() === lowerUser) continue;
        const cleaned = cleanHnHtml(child.text);
        if (!cleaned) continue;

        replies.push({
          commentId: child.id,
          storyId: myComment.story_id ?? 0,
          storyTitle: myComment.story_title ?? "(Hacker News thread)",
          parentId: child.parent ?? myCommentId,
          kind: "reply_to_me",
          author: child.by,
          text: cleaned,
          createdAt: new Date((child.time ?? 0) * 1000).toISOString(),
        });
      }
    }),
  );

  return replies;
}
