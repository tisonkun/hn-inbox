export type NotificationEvent =
  | {
      kind: "new_comment";
      commentId: number;
      storyId: number;
      storyTitle: string;
      commentKind: "story_comment" | "reply_to_me";
      author: string;
      text: string;
      createdAt: string;
      itemUrl: string;
      replyUrl: string;
    }
  | {
      kind: "score_milestone";
      storyId: number;
      title: string;
      milestone: number;
      points: number;
      numComments: number;
      frontpageRank: number | null;
      itemUrl: string;
    }
  | {
      kind: "frontpage_entry";
      storyId: number;
      title: string;
      rank: number;
      points: number;
      numComments: number;
      itemUrl: string;
    }
  | {
      kind: "domain_mention";
      storyId: number;
      title: string;
      author: string;
      url: string;
      points: number;
      numComments: number;
      itemUrl: string;
    };

export interface ChannelDispatchResult {
  channelId: string;
  ok: boolean;
  error?: string;
}

/**
 * Implement this interface and register the instance in `src/lib/notify/dispatcher.ts`
 * to plug in a new notification backend (e.g. Feishu, Slack, Telegram, Discord, Pushover).
 */
export interface NotificationChannel {
  readonly id: string;
  isEnabled(): boolean;
  send(events: NotificationEvent[], appBaseUrl: string | null): Promise<void>;
}
