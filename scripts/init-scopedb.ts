import { loadLocalEnv } from "./load-env";
import { ensureScopeDBTables } from "../src/lib/scopedb";

loadLocalEnv();

async function main() {
  const results = await ensureScopeDBTables();
  for (const item of results) {
    console.log(`Applied ScopeDB table: ${item.name} (version: ${item.version})`);
  }
}

main().catch((error) => {
  console.error("Failed to initialize ScopeDB tables:", error);
  process.exit(1);
});
