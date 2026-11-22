import { optionalEnv, parseCsvList } from "../config";
import { renderDigestEmail } from "./email-template";
import type { NotificationChannel, NotificationEvent } from "./types";

const RESEND_API_URL = "https://api.resend.com/emails";

export class ResendEmailChannel implements NotificationChannel {
  readonly id = "email:resend";

  private getConfig() {
    const apiKey = optionalEnv("RESEND_API_KEY");
    const from = optionalEnv("EMAIL_FROM");
    const to = parseCsvList(optionalEnv("EMAIL_TO"));
    return { apiKey, from, to };
  }

  isEnabled(): boolean {
    const { apiKey, from, to } = this.getConfig();
    return Boolean(apiKey && from && to.length > 0);
  }

  async send(
    events: NotificationEvent[],
    appBaseUrl: string | null,
  ): Promise<void> {
    const { apiKey, from, to } = this.getConfig();
    if (!apiKey || !from || to.length === 0) {
      throw new Error(
        "ResendEmailChannel requires RESEND_API_KEY, EMAIL_FROM, and EMAIL_TO",
      );
    }

    const email = renderDigestEmail(events, appBaseUrl);
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Resend API error (${response.status}): ${body}`);
    }
  }
}
