# HN Inbox

Real-time Hacker News notification service and lightweight reply inbox powered by **Vercel Schedules**, **ScopeDB**, and a pluggable notification pipeline (starting with **Resend** email alerts).

Hacker News intentionally has no built-in notification inbox for replies, score spikes, or front-page entries. `hn-inbox` polls the public read-only Hacker News APIs on a 15-minute schedule, appends observations and audit events to ScopeDB, emails you when action is needed, and gives you a minimal dashboard protected by **GitHub OAuth allowlist** to track unread comments and story score trends.

## Features

- **Real-time alerts (batched per poll cycle)**:
  - New comments on your recent stories and direct replies to your comments on any thread.
  - One-time score milestone alerts (default: `10, 30, 50, 100, 200, 500` points).
  - First-time Front Page (top 30) entry alerts with live rank.
  - External domain or keyword mentions (e.g. when someone submits your blog).
- **Safe first-run baseline seeding**: The initial poll seeds existing stories and comments into ScopeDB without sending historical email spam.
- **Append-only ScopeDB storage**: Stores time-series story snapshots (`hn_story_snapshots`), comments (`hn_comments`), notification/inbox state events (`hn_events`), and Next.js `after()` runtime telemetry (`vercel_events`, aligned with [`scopedb/vercel-drain`](https://github.com/scopedb/vercel-drain)) via the official [`scopedb`](https://www.npmjs.com/package/scopedb) JS/TS SDK without OLTP updates.
- **Passwordless GitHub OAuth allowlist**: Only GitHub usernames listed in `GITHUB_ALLOWED_USERS` can sign in to the Web Inbox (requesting only `read:user` scope, zero repo permissions).
- **Pluggable notification channels**: Ships with `ResendEmailChannel` and `GenericWebhookChannel`. Add Feishu, Slack, Telegram, or Discord by implementing `NotificationChannel`.
- **Web Inbox, Story Trends & Runtime Logs**: Mark comments as read/replied, jump straight to `news.ycombinator.com/reply?id=...`, copy formatted comment context, inspect per-story score sparklines, and monitor 15-minute schedule health and errors in the **Logs** tab (works on Vercel Hobby without Log Drains).

## Architecture

```text
Vercel Schedules (every 15m, jitter 15m)
  └─ POST /api/schedules/poll (Bearer CRON_SECRET)
       ├─ Fetch HN Algolia + Firebase APIs
       ├─ Query ScopeDB (ScopeQL) to compute incremental diff
       ├─ Append snapshots, new comments, and events via scopedb SDK
       └─ Dispatch digest via enabled NotificationChannels (Resend / Webhook)
```

## Quick Start

### 1. Create a GitHub OAuth App

1. Open **GitHub Settings -> Developer settings -> OAuth Apps -> New OAuth App**.
2. Set **Homepage URL** to your deployed Vercel URL (e.g. `https://hn-inbox.example.com`).
3. Set **Authorization callback URL** to `https://hn-inbox.example.com/api/auth/github/callback`.
4. Copy the **Client ID** and generate a **Client Secret**.

### 2. Configure Environment Variables

Copy `.env.example` to `.env.local` for local scripts (never commit `.env.local`) or set these directly in Vercel **Project Settings -> Environment Variables**:

| Variable | Required | Description |
| :--- | :--- | :--- |
| `HN_USERNAME` | Yes | Hacker News username to monitor. |
| `HN_WATCH_DOMAINS` | No | Comma-separated domains/keywords to watch for external submissions. |
| `HN_SCORE_MILESTONES` | No | Comma-separated score thresholds (default: `10,30,50,100,200,500`). |
| `SCOPEDB_ENDPOINT` | Yes | HTTPS endpoint of your ScopeDB instance reachable from Vercel. |
| `SCOPEDB_API_KEY` | Yes | ScopeDB Bearer API key. |
| `SCOPEDB_DATABASE` | No | ScopeDB database name (default: `scopedb`). |
| `SCOPEDB_SCHEMA` | No | ScopeDB schema name (default: `public`). |
| `CRON_SECRET` | Yes | Shared secret used by Vercel Schedules to authenticate `/api/schedules/poll`. |
| `SESSION_SECRET` | Yes | Random secret (`openssl rand -hex 32`) signing HttpOnly session cookies. |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth App Client ID. |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth App Client Secret. |
| `GITHUB_ALLOWED_USERS` | Yes | Comma-separated GitHub usernames permitted to sign in. |
| `APP_BASE_URL` | Recommended | Deployed URL (e.g. `https://hn-inbox.example.com`) used for OAuth callback and email links. |
| `RESEND_API_KEY` | No* | Resend API key (`Sending access`) to enable email notifications. |
| `EMAIL_FROM` | No* | Verified sender address (e.g. `HN Inbox <hn@notify.example.com>`). |
| `EMAIL_TO` | No* | Comma-separated recipient email addresses. |
| `WEBHOOK_URL` | No | Optional JSON webhook endpoint for additional integrations. |

### 3. ScopeDB Catalog Alignment (Automatic on Production Deploy)

Production deployments on Vercel automatically run `pnpm run build:vercel` (`next build && tsx scripts/init-scopedb.ts --on-deploy`), which idempotently applies all ScopeDB table definitions when `VERCEL_ENV=production` and ScopeDB credentials are present. Preview deploys and local builds skip it, and transient ScopeDB errors during deploy log a warning without blocking the build.

You can also initialize or reconcile tables manually at any time via CLI (`pnpm run init:db`), the fallback button in the Web Inbox UI, or an authenticated `POST /api/init` request.

### 4. Deploy to Vercel

1. Import this repository into Vercel (Hobby plan works out of the box).
2. Add the environment variables from `.env.example` in **Project Settings -> Environment Variables**.
3. Deploy. `vercel.json` registers a static Vercel Schedule running `POST /api/schedules/poll` every 15 minutes (`jitter: 15`).
4. Open the deployed site, click **Sign in with GitHub**, and click **Sync Now** once to seed your baseline (or wait for the first scheduled run).

### 5. Setting Up Resend Email Alerts

1. Create a free account at [Resend](https://resend.com) (3,000 emails/month, 100/day).
2. Under **Domains**, add a dedicated sending subdomain such as `notify.example.com` and add its SPF/DKIM DNS records (or use `onboarding@resend.dev` during initial testing).
3. Under **API Keys**, create a key scoped to **Sending access** and set `RESEND_API_KEY`, `EMAIL_FROM`, and `EMAIL_TO` in Vercel.

## Adding New Notification Channels

Implement `NotificationChannel` in `src/lib/notify/` and register it in `src/lib/notify/dispatcher.ts`:

```ts
export interface NotificationChannel {
  readonly id: string;
  isEnabled(): boolean;
  send(events: NotificationEvent[], appBaseUrl: string | null): Promise<void>;
}
```

Each enabled channel is dispatched independently with `Promise.allSettled`, and per-channel delivery status (`ok` or `failed`) is appended to `hn_events` in ScopeDB.

## Local CLI Helpers

```bash
pnpm run test         # Run unit tests
pnpm run typecheck    # TypeScript type check
pnpm run build        # Verify production Next.js build
pnpm run poll:once -- --dry-run   # Inspect diff without writing or sending
pnpm run poll:once -- --seed-only # Seed baseline into ScopeDB without sending alerts
```

## License

Apache License 2.0. See [LICENSE](./LICENSE).
