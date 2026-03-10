import process from "node:process";
import { companies, createDb } from "../../packages/db/src/index.ts";
import { knowledgeBackfillService } from "../../server/src/services/knowledge-backfill.js";

function readArg(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const companyId = readArg("--company-id");
  const companyName = readArg("--company-name");
  const limitArg = readArg("--limit");
  const limit = limitArg ? Number(limitArg) : undefined;

  const db = createDb(databaseUrl);
  const backfill = knowledgeBackfillService(db);

  let resolvedCompanyId = companyId;
  if (!resolvedCompanyId && companyName) {
    const company = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .then((rows) => rows.find((row) => row.name === companyName) ?? null);
    resolvedCompanyId = company?.id ?? null;
  }

  if (!resolvedCompanyId) {
    throw new Error("Provide --company-id or --company-name");
  }

  const result = await backfill.rebuildCompanyDocumentVersions({
    companyId: resolvedCompanyId,
    limit,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
