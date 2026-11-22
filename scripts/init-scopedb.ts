import { loadLocalEnv } from "./load-env";
import { ensureScopeDBTables } from "../src/lib/scopedb";

loadLocalEnv();

async function main() {
  const onDeploy = process.argv.includes("--on-deploy");

  if (onDeploy) {
    const vercelEnv = process.env["VERCEL_ENV"]?.trim();
    if (vercelEnv !== "production") {
      console.log(
        `Skipping ScopeDB catalog sync during build (VERCEL_ENV=${vercelEnv || "unset"}).`,
      );
      return;
    }

    if (
      !process.env["SCOPEDB_ENDPOINT"]?.trim() ||
      !process.env["SCOPEDB_API_KEY"]?.trim()
    ) {
      console.warn(
        "[warn] Skipping ScopeDB catalog sync during deploy: SCOPEDB_ENDPOINT or SCOPEDB_API_KEY is not set.",
      );
      return;
    }
  }

  try {
    const results = await ensureScopeDBTables();
    for (const item of results) {
      console.log(`Applied ScopeDB table: ${item.name} (version: ${item.version})`);
    }
  } catch (error) {
    if (onDeploy) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[warn] ScopeDB catalog sync failed during deploy (continuing build): ${message}`,
      );
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error("Failed to initialize ScopeDB tables:", error);
  process.exit(1);
});
