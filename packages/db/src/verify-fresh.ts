import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  ensurePostgresDatabase,
  inspectMigrations,
  migratePostgresIfEmpty,
} from "./client.js";

const ENV_FILE_CANDIDATES = [
  new URL("../.env", import.meta.url),
  new URL("../../../.env", import.meta.url),
];

export function parseEnvValue(contents: string, key: string): string | null {
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    if (!normalized.startsWith(`${key}=`)) continue;
    const rawValue = normalized.slice(key.length + 1).trim();
    if (rawValue.length === 0) return "";
    const quote = rawValue[0];
    if ((quote === "\"" || quote === "'") && rawValue.endsWith(quote)) {
      return rawValue.slice(1, -1);
    }
    return rawValue;
  }
  return null;
}

export function resolveDatabaseUrlFromSources(input: {
  envValue?: string | null;
  envFileValues?: Array<string | null | undefined>;
}) {
  const envValue = input.envValue?.trim();
  if (envValue) return envValue;

  for (const candidate of input.envFileValues ?? []) {
    const value = candidate?.trim();
    if (value) return value;
  }

  throw new Error("DATABASE_URL is required for db:verify-fresh");
}

async function readDatabaseUrlFromEnvFiles() {
  const values = await Promise.all(
    ENV_FILE_CANDIDATES.map(async (pathUrl) => {
      try {
        const contents = await readFile(pathUrl, "utf8");
        return parseEnvValue(contents, "DATABASE_URL");
      } catch {
        return null;
      }
    }),
  );
  return values;
}

async function resolveDatabaseUrl() {
  const value = resolveDatabaseUrlFromSources({
    envValue: process.env.DATABASE_URL,
    envFileValues: await readDatabaseUrlFromEnvFiles(),
  });
  process.env.DATABASE_URL = value;
  return value;
}

function assertSafeDatabaseName(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe database name: ${value}`);
  }
  return value;
}

function replaceDatabaseName(connectionString: string, databaseName: string) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function dropDatabase(adminUrl: string, databaseName: string) {
  const safeName = assertSafeDatabaseName(databaseName);
  const sql = postgres(adminUrl, { max: 1 });

  try {
    await sql.unsafe(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${safeName.replaceAll("'", "''")}'
        AND pid <> pg_backend_pid()
    `);
    await sql.unsafe(`DROP DATABASE IF EXISTS "${safeName}"`);
  } finally {
    await sql.end();
  }
}

async function main() {
  const adminUrl = await resolveDatabaseUrl();
  const databaseName = assertSafeDatabaseName(
    `squadrail_phase1_${Date.now().toString(36)}`,
  );
  const freshUrl = replaceDatabaseName(adminUrl, databaseName);

  console.log(`Creating fresh verification database: ${databaseName}`);
  await ensurePostgresDatabase(adminUrl, databaseName);

  try {
    const bootstrap = await migratePostgresIfEmpty(freshUrl);
    const migrationState = await inspectMigrations(freshUrl);

    if (!bootstrap.migrated || migrationState.status !== "upToDate") {
      throw new Error(
        `Fresh DB migration verification failed: ${JSON.stringify({ bootstrap, migrationState })}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          databaseName,
          bootstrap,
          migrationState,
        },
        null,
        2,
      ),
    );
  } finally {
    console.log(`Dropping verification database: ${databaseName}`);
    await dropDatabase(adminUrl, databaseName);
  }
}

function isDirectExecution() {
  const entryPath = process.argv[1];
  if (!entryPath) return false;
  return path.resolve(entryPath) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  await main();
}
