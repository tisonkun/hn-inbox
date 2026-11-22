import { optionalEnv } from "../config";
import type { NotificationChannel, NotificationEvent } from "./types";

/**
 * Generic JSON webhook channel for plugging in external chat bridges
 * (Feishu, Slack, Telegram relays, n8n, or custom bots) without changing core logic.
 */
export class GenericWebhookChannel implements NotificationChannel {
  readonly id = "webhook";

  isEnabled(): boolean {
    return Boolean(optionalEnv("WEBHOOK_URL"));
  }

  async send(
    events: NotificationEvent[],
    appBaseUrl: string | null,
  ): Promise<void> {
    const url = optionalEnv("WEBHOOK_URL");
    if (!url) {
      throw new Error("GenericWebhookChannel requires WEBHOOK_URL");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const bearer = optionalEnv("WEBHOOK_BEARER_TOKEN");
    if (bearer) {
      headers["Authorization"] = `Bearer ${bearer}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "hn-inbox",
        appBaseUrl,
        sentAt: new Date().toISOString(),
        events,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Webhook error (${response.status}): ${body}`);
    }
  }
}
