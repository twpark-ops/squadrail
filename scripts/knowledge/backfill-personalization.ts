import process from "node:process";
import { companies, createDb } from "../../packages/db/src/index.ts";
import { retrievalPersonalizationService } from "../../server/src/services/retrieval-personalization.js";

type Args = {
  companyId?: string;
  companyName?: string;
  limit?: number;
  rebuildOnly?: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--company-id" && next) {
      args.companyId = next;
      index += 1;
      continue;
    }
    if (current === "--company-name" && next) {
      args.companyName = next;
      index += 1;
      continue;
    }
    if (current === "--limit" && next) {
      args.limit = Number(next);
      index += 1;
      continue;
    }
    if (current === "--rebuild-only") {
      args.rebuildOnly = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!args.companyId && !args.companyName) {
    throw new Error("Provide --company-id or --company-name");
  }

  const db = createDb(databaseUrl);
  let companyId = args.companyId ?? null;
  if (!companyId && args.companyName) {
    const company = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .then((rows) => rows.find((row) => row.name === args.companyName) ?? null);
    companyId = company?.id ?? null;
  }
  if (!companyId) throw new Error("Target company was not found");

  const service = retrievalPersonalizationService(db);
  const result = args.rebuildOnly
    ? { scanned: 0, replayed: 0, feedbackEventCount: 0, profiledRunCount: 0 }
    : await service.backfillProtocolFeedback({
      companyId,
      limit: args.limit,
    });
  const rebuild = await service.rebuildAllProfiles({ companyId });
  console.log(JSON.stringify({ ...result, rebuild }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
