import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getGitHubAuthConfig, optionalEnv } from "@/lib/config";
import { loadDashboardData, type DashboardData } from "@/lib/inbox";
import { Dashboard } from "@/components/Dashboard";
import { LoginForm } from "@/components/LoginForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const authCfg = getGitHubAuthConfig();
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = authCfg
    ? verifySessionToken(
        sessionToken,
        authCfg.sessionSecret,
        authCfg.allowedUsers,
      )
    : null;

  if (!session) {
    const params = await searchParams;
    return (
      <LoginForm
        authConfigured={Boolean(authCfg)}
        errorCode={params.error ?? null}
      />
    );
  }

  let initialData: DashboardData | null = null;
  let loadError: string | null = null;

  try {
    initialData = await loadDashboardData();
  } catch (error) {
    loadError =
      error instanceof Error
        ? error.message
        : "Failed to load data from ScopeDB";
  }

  return (
    <Dashboard
      hnUsername={optionalEnv("HN_USERNAME") ?? ""}
      signedInAs={session.login}
      initialData={initialData}
      initialError={loadError}
    />
  );
}
