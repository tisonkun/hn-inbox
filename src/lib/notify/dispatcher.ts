import { ResendEmailChannel } from "./resend";
import type {
  ChannelDispatchResult,
  NotificationChannel,
  NotificationEvent,
} from "./types";
import { GenericWebhookChannel } from "./webhook";

/**
 * Default notification channel registry.
 * Add new NotificationChannel implementations here to enable them via env vars.
 */
export function getRegisteredChannels(): NotificationChannel[] {
  return [new ResendEmailChannel(), new GenericWebhookChannel()];
}

export async function dispatchNotifications(
  events: NotificationEvent[],
  appBaseUrl: string | null,
  channels: NotificationChannel[] = getRegisteredChannels(),
): Promise<ChannelDispatchResult[]> {
  if (events.length === 0) return [];
  const enabled = channels.filter((c) => c.isEnabled());
  if (enabled.length === 0) return [];

  const settled = await Promise.allSettled(
    enabled.map(async (channel): Promise<ChannelDispatchResult> => {
      try {
        await channel.send(events, appBaseUrl);
        return { channelId: channel.id, ok: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return { channelId: channel.id, ok: false, error: message };
      }
    }),
  );

  return settled.map((item, idx) =>
    item.status === "fulfilled"
      ? item.value
      : {
          channelId: enabled[idx].id,
          ok: false,
          error:
            item.reason instanceof Error
              ? item.reason.message
              : String(item.reason),
        },
  );
}
