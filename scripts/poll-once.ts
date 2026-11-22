import { loadLocalEnv } from "./load-env";
import { runPollCycle } from "../src/lib/poll";

loadLocalEnv();

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const seedOnly = args.has("--seed-only");

  const summary = await runPollCycle({ dryRun, seedOnly });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("Poll failed:", error);
  process.exit(1);
});
