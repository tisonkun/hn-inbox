export interface MonitorConfig {
  hnUsername: string;
  watchDomains: string[];
  scoreMilestones: number[];
  lookbackDays: number;
  appBaseUrl: string | null;
}

export interface ScopeDBConfig {
  endpoint: string;
  apiKey: string;
  database: string;
  schema: string;
}

export interface GitHubAuthConfig {
  clientId: string;
  clientSecret: string;
  allowedUsers: string[];
  sessionSecret: string;
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export function parseCsvList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseMilestones(raw: string | null): number[] {
  const defaults = [10, 30, 50, 100, 200, 500];
  if (!raw) return defaults;
  const parsed = parseCsvList(raw)
    .map((v) => Number.parseInt(v, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parsed.length === 0) return defaults;
  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

export function getMonitorConfig(): MonitorConfig {
  const hnUsername = requiredEnv("HN_USERNAME");
  const watchDomains = parseCsvList(optionalEnv("HN_WATCH_DOMAINS")).map((d) =>
    d.toLowerCase(),
  );
  const scoreMilestones = parseMilestones(optionalEnv("HN_SCORE_MILESTONES"));
  const lookbackRaw = optionalEnv("HN_LOOKBACK_DAYS");
  const lookbackParsed = lookbackRaw ? Number.parseInt(lookbackRaw, 10) : 14;
  const lookbackDays =
    Number.isFinite(lookbackParsed) && lookbackParsed > 0 ? lookbackParsed : 14;
  const rawBaseUrl = optionalEnv("APP_BASE_URL");
  const appBaseUrl = rawBaseUrl ? rawBaseUrl.replace(/\/+$/, "") : null;

  return {
    hnUsername,
    watchDomains,
    scoreMilestones,
    lookbackDays,
    appBaseUrl,
  };
}

export function getScopeDBConfig(): ScopeDBConfig {
  return {
    endpoint: requiredEnv("SCOPEDB_ENDPOINT"),
    apiKey: requiredEnv("SCOPEDB_API_KEY"),
    database: optionalEnv("SCOPEDB_DATABASE") ?? "scopedb",
    schema: optionalEnv("SCOPEDB_SCHEMA") ?? "public",
  };
}

export function getCronSecret(): string | null {
  return optionalEnv("CRON_SECRET");
}

export function getGitHubAuthConfig(): GitHubAuthConfig | null {
  const clientId = optionalEnv("GITHUB_CLIENT_ID");
  const clientSecret = optionalEnv("GITHUB_CLIENT_SECRET");
  const allowedUsers = parseCsvList(optionalEnv("GITHUB_ALLOWED_USERS")).map(
    (u) => u.toLowerCase(),
  );
  const sessionSecret = optionalEnv("SESSION_SECRET");

  if (!clientId || !clientSecret || allowedUsers.length === 0 || !sessionSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    allowedUsers,
    sessionSecret,
  };
}
