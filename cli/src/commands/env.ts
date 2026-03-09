import * as p from "@clack/prompts";
import pc from "picocolors";
import type { SquadrailConfig } from "../config/schema.js";
import { configExists, readConfig, resolveConfigPath } from "../config/store.js";
import {
  readAgentJwtSecretFromEnv,
  readAgentJwtSecretFromEnvFile,
  resolveAgentJwtEnvFile,
} from "../config/env.js";
import {
  resolveDefaultSecretsKeyFilePath,
  resolveDefaultStorageDir,
  resolveSquadrailInstanceId,
} from "../config/home.js";
import { formatCliCommand } from "../utils/branding.js";

type EnvSource = "env" | "config" | "file" | "default" | "missing";

type EnvVarRow = {
  key: string;
  value: string;
  source: EnvSource;
  required: boolean;
  note: string;
};

const DEFAULT_AGENT_JWT_TTL_SECONDS = "172800";
const DEFAULT_AGENT_JWT_ISSUER = "squadrail";
const DEFAULT_AGENT_JWT_AUDIENCE = "squadrail-api";
const DEFAULT_HEARTBEAT_SCHEDULER_INTERVAL_MS = "30000";
const DEFAULT_SECRETS_PROVIDER = "local_encrypted";
const DEFAULT_STORAGE_PROVIDER = "local_disk";

function readEnvAlias(primaryKey: string, legacyKey: string): string | undefined {
  return process.env[primaryKey] ?? process.env[legacyKey];
}

function hasEnvAlias(primaryKey: string, legacyKey: string): boolean {
  return Boolean(readEnvAlias(primaryKey, legacyKey));
}

function displayEnvKey(key: string): string {
  return key.startsWith("SQUADRAIL_") ? key.replace("SQUADRAIL_", "SQUADRAIL_") : key;
}

function defaultSecretsKeyFilePath(): string {
  return resolveDefaultSecretsKeyFilePath(resolveSquadrailInstanceId());
}
function defaultStorageBaseDir(): string {
  return resolveDefaultStorageDir(resolveSquadrailInstanceId());
}

export async function envCommand(opts: { config?: string }): Promise<void> {
  p.intro(pc.bgCyan(pc.black(` ${formatCliCommand("env")} `)));

  const configPath = resolveConfigPath(opts.config);
  let config: SquadrailConfig | null = null;
  let configReadError: string | null = null;

  if (configExists(opts.config)) {
    p.log.message(pc.dim(`Config file: ${configPath}`));
    try {
      config = readConfig(opts.config);
    } catch (err) {
      configReadError = err instanceof Error ? err.message : String(err);
      p.log.message(pc.yellow(`Could not parse config: ${configReadError}`));
    }
  } else {
    p.log.message(pc.dim(`Config file missing: ${configPath}`));
  }

  const rows = collectDeploymentEnvRows(config, configPath);
  const missingRequired = rows.filter((row) => row.required && row.source === "missing");
  const sortedRows = rows.sort((a, b) => Number(b.required) - Number(a.required) || a.key.localeCompare(b.key));

  const requiredRows = sortedRows.filter((row) => row.required);
  const optionalRows = sortedRows.filter((row) => !row.required);

  const formatSection = (title: string, entries: EnvVarRow[]) => {
    if (entries.length === 0) return;

    p.log.message(pc.bold(title));
    for (const entry of entries) {
      const status = entry.source === "missing" ? pc.red("missing") : entry.source === "default" ? pc.yellow("default") : pc.green("set");
      const sourceNote = {
        env: "environment",
        config: "config",
        file: "file",
        default: "default",
        missing: "missing",
      }[entry.source];
      p.log.message(
        `${pc.cyan(entry.key)} ${status.padEnd(7)} ${pc.dim(`[${sourceNote}] ${entry.note}`)}${entry.source === "missing" ? "" : ` ${pc.dim("=>")} ${pc.white(quoteShellValue(entry.value))}`}`,
      );
    }
  };

  formatSection("Required environment variables", requiredRows);
  formatSection("Optional environment variables", optionalRows);

  const exportRows = rows.map((row) => (row.source === "missing" ? { ...row, value: "<set-this-value>" } : row));
  const uniqueRows = uniqueByKey(exportRows);
  const exportBlock = uniqueRows.map((row) => `export ${row.key}=${quoteShellValue(row.value)}`).join("\n");

  if (configReadError) {
    p.log.error(`Could not load config cleanly: ${configReadError}`);
  }

  p.note(
    exportBlock || "No values detected. Set required variables manually.",
    "Deployment export block",
  );
  p.log.message(pc.dim("Primary env names use SQUADRAIL_*."));

  if (missingRequired.length > 0) {
    p.log.message(
      pc.yellow(
        `Missing required values: ${missingRequired.map((row) => row.key).join(", ")}. Set these before deployment.`,
      ),
    );
  } else {
    p.log.message(pc.green("All required deployment variables are present."));
  }
  p.outro("Done");
}

function collectDeploymentEnvRows(config: SquadrailConfig | null, configPath: string): EnvVarRow[] {
  const agentJwtEnvFile = resolveAgentJwtEnvFile(configPath);
  const jwtEnv = readAgentJwtSecretFromEnv(configPath);
  const jwtFile = jwtEnv ? null : readAgentJwtSecretFromEnvFile(agentJwtEnvFile);
  const jwtSource = jwtEnv ? "env" : jwtFile ? "file" : "missing";

  const dbUrl = process.env.DATABASE_URL ?? config?.database?.connectionString ?? "";
  const databaseMode = config?.database?.mode ?? "embedded-postgres";
  const dbUrlSource: EnvSource = process.env.DATABASE_URL ? "env" : config?.database?.connectionString ? "config" : "missing";

  const heartbeatInterval = process.env.HEARTBEAT_SCHEDULER_INTERVAL_MS ?? DEFAULT_HEARTBEAT_SCHEDULER_INTERVAL_MS;
  const heartbeatEnabled = process.env.HEARTBEAT_SCHEDULER_ENABLED ?? "true";
  const secretsProvider =
    readEnvAlias("SQUADRAIL_SECRETS_PROVIDER", "SQUADRAIL_SECRETS_PROVIDER") ??
    config?.secrets?.provider ??
    DEFAULT_SECRETS_PROVIDER;
  const secretsStrictMode =
    readEnvAlias("SQUADRAIL_SECRETS_STRICT_MODE", "SQUADRAIL_SECRETS_STRICT_MODE") ??
    String(config?.secrets?.strictMode ?? false);
  const secretsKeyFilePath =
    readEnvAlias("SQUADRAIL_SECRETS_MASTER_KEY_FILE", "SQUADRAIL_SECRETS_MASTER_KEY_FILE") ??
    config?.secrets?.localEncrypted?.keyFilePath ??
    defaultSecretsKeyFilePath();
  const storageProvider =
    readEnvAlias("SQUADRAIL_STORAGE_PROVIDER", "SQUADRAIL_STORAGE_PROVIDER") ??
    config?.storage?.provider ??
    DEFAULT_STORAGE_PROVIDER;
  const storageLocalDir =
    readEnvAlias("SQUADRAIL_STORAGE_LOCAL_DIR", "SQUADRAIL_STORAGE_LOCAL_DIR") ??
    config?.storage?.localDisk?.baseDir ??
    defaultStorageBaseDir();
  const storageS3Bucket =
    readEnvAlias("SQUADRAIL_STORAGE_S3_BUCKET", "SQUADRAIL_STORAGE_S3_BUCKET") ??
    config?.storage?.s3?.bucket ??
    "squadrail";
  const storageS3Region =
    readEnvAlias("SQUADRAIL_STORAGE_S3_REGION", "SQUADRAIL_STORAGE_S3_REGION") ??
    config?.storage?.s3?.region ??
    "us-east-1";
  const storageS3Endpoint =
    readEnvAlias("SQUADRAIL_STORAGE_S3_ENDPOINT", "SQUADRAIL_STORAGE_S3_ENDPOINT") ??
    config?.storage?.s3?.endpoint ??
    "";
  const storageS3Prefix =
    readEnvAlias("SQUADRAIL_STORAGE_S3_PREFIX", "SQUADRAIL_STORAGE_S3_PREFIX") ??
    config?.storage?.s3?.prefix ??
    "";
  const storageS3ForcePathStyle =
    readEnvAlias("SQUADRAIL_STORAGE_S3_FORCE_PATH_STYLE", "SQUADRAIL_STORAGE_S3_FORCE_PATH_STYLE") ??
    String(config?.storage?.s3?.forcePathStyle ?? false);

  const rows: EnvVarRow[] = [
    {
      key: "SQUADRAIL_AGENT_JWT_SECRET",
      value: jwtEnv ?? jwtFile ?? "",
      source: jwtSource,
      required: true,
      note:
        jwtSource === "missing"
          ? "Generate during onboard or set manually (required for local adapter authentication)"
          : jwtSource === "env"
            ? "Set in process environment"
            : `Set in ${agentJwtEnvFile}`,
    },
    {
      key: "DATABASE_URL",
      value: dbUrl,
      source: dbUrlSource,
      required: true,
      note:
        databaseMode === "postgres"
          ? "Configured for postgres mode (required)"
          : "Required for live deployment with managed PostgreSQL",
    },
    {
      key: "PORT",
      value:
        process.env.PORT ??
        (config?.server?.port !== undefined ? String(config.server.port) : "3100"),
      source: process.env.PORT ? "env" : config?.server?.port !== undefined ? "config" : "default",
      required: false,
      note: "HTTP listen port",
    },
    {
      key: "SQUADRAIL_AGENT_JWT_TTL_SECONDS",
      value: readEnvAlias("SQUADRAIL_AGENT_JWT_TTL_SECONDS", "SQUADRAIL_AGENT_JWT_TTL_SECONDS") ?? DEFAULT_AGENT_JWT_TTL_SECONDS,
      source: hasEnvAlias("SQUADRAIL_AGENT_JWT_TTL_SECONDS", "SQUADRAIL_AGENT_JWT_TTL_SECONDS") ? "env" : "default",
      required: false,
      note: "JWT lifetime in seconds",
    },
    {
      key: "SQUADRAIL_AGENT_JWT_ISSUER",
      value: readEnvAlias("SQUADRAIL_AGENT_JWT_ISSUER", "SQUADRAIL_AGENT_JWT_ISSUER") ?? DEFAULT_AGENT_JWT_ISSUER,
      source: hasEnvAlias("SQUADRAIL_AGENT_JWT_ISSUER", "SQUADRAIL_AGENT_JWT_ISSUER") ? "env" : "default",
      required: false,
      note: "JWT issuer",
    },
    {
      key: "SQUADRAIL_AGENT_JWT_AUDIENCE",
      value: readEnvAlias("SQUADRAIL_AGENT_JWT_AUDIENCE", "SQUADRAIL_AGENT_JWT_AUDIENCE") ?? DEFAULT_AGENT_JWT_AUDIENCE,
      source: hasEnvAlias("SQUADRAIL_AGENT_JWT_AUDIENCE", "SQUADRAIL_AGENT_JWT_AUDIENCE") ? "env" : "default",
      required: false,
      note: "JWT audience",
    },
    {
      key: "HEARTBEAT_SCHEDULER_INTERVAL_MS",
      value: heartbeatInterval,
      source: process.env.HEARTBEAT_SCHEDULER_INTERVAL_MS ? "env" : "default",
      required: false,
      note: "Heartbeat worker interval in ms",
    },
    {
      key: "HEARTBEAT_SCHEDULER_ENABLED",
      value: heartbeatEnabled,
      source: process.env.HEARTBEAT_SCHEDULER_ENABLED ? "env" : "default",
      required: false,
      note: "Set to `false` to disable timer scheduling",
    },
    {
      key: "SQUADRAIL_SECRETS_PROVIDER",
      value: secretsProvider,
      source: hasEnvAlias("SQUADRAIL_SECRETS_PROVIDER", "SQUADRAIL_SECRETS_PROVIDER")
        ? "env"
        : config?.secrets?.provider
          ? "config"
          : "default",
      required: false,
      note: "Default provider for new secrets",
    },
    {
      key: "SQUADRAIL_SECRETS_STRICT_MODE",
      value: secretsStrictMode,
      source: hasEnvAlias("SQUADRAIL_SECRETS_STRICT_MODE", "SQUADRAIL_SECRETS_STRICT_MODE")
        ? "env"
        : config?.secrets?.strictMode !== undefined
          ? "config"
          : "default",
      required: false,
      note: "Require secret refs for sensitive env keys",
    },
    {
      key: "SQUADRAIL_SECRETS_MASTER_KEY_FILE",
      value: secretsKeyFilePath,
      source: hasEnvAlias("SQUADRAIL_SECRETS_MASTER_KEY_FILE", "SQUADRAIL_SECRETS_MASTER_KEY_FILE")
        ? "env"
        : config?.secrets?.localEncrypted?.keyFilePath
          ? "config"
          : "default",
      required: false,
      note: "Path to local encrypted secrets key file",
    },
    {
      key: "SQUADRAIL_STORAGE_PROVIDER",
      value: storageProvider,
      source: hasEnvAlias("SQUADRAIL_STORAGE_PROVIDER", "SQUADRAIL_STORAGE_PROVIDER")
        ? "env"
        : config?.storage?.provider
          ? "config"
          : "default",
      required: false,
      note: "Storage provider (local_disk or s3)",
    },
    {
      key: "SQUADRAIL_STORAGE_LOCAL_DIR",
      value: storageLocalDir,
      source: hasEnvAlias("SQUADRAIL_STORAGE_LOCAL_DIR", "SQUADRAIL_STORAGE_LOCAL_DIR")
        ? "env"
        : config?.storage?.localDisk?.baseDir
          ? "config"
          : "default",
      required: false,
      note: "Local storage base directory for local_disk provider",
    },
    {
      key: "SQUADRAIL_STORAGE_S3_BUCKET",
      value: storageS3Bucket,
      source: hasEnvAlias("SQUADRAIL_STORAGE_S3_BUCKET", "SQUADRAIL_STORAGE_S3_BUCKET")
        ? "env"
        : config?.storage?.s3?.bucket
          ? "config"
          : "default",
      required: false,
      note: "S3 bucket name for s3 provider",
    },
    {
      key: "SQUADRAIL_STORAGE_S3_REGION",
      value: storageS3Region,
      source: hasEnvAlias("SQUADRAIL_STORAGE_S3_REGION", "SQUADRAIL_STORAGE_S3_REGION")
        ? "env"
        : config?.storage?.s3?.region
          ? "config"
          : "default",
      required: false,
      note: "S3 region for s3 provider",
    },
    {
      key: "SQUADRAIL_STORAGE_S3_ENDPOINT",
      value: storageS3Endpoint,
      source: hasEnvAlias("SQUADRAIL_STORAGE_S3_ENDPOINT", "SQUADRAIL_STORAGE_S3_ENDPOINT")
        ? "env"
        : config?.storage?.s3?.endpoint
          ? "config"
          : "default",
      required: false,
      note: "Optional custom endpoint for S3-compatible providers",
    },
    {
      key: "SQUADRAIL_STORAGE_S3_PREFIX",
      value: storageS3Prefix,
      source: hasEnvAlias("SQUADRAIL_STORAGE_S3_PREFIX", "SQUADRAIL_STORAGE_S3_PREFIX")
        ? "env"
        : config?.storage?.s3?.prefix
          ? "config"
          : "default",
      required: false,
      note: "Optional object key prefix",
    },
    {
      key: "SQUADRAIL_STORAGE_S3_FORCE_PATH_STYLE",
      value: storageS3ForcePathStyle,
      source: hasEnvAlias("SQUADRAIL_STORAGE_S3_FORCE_PATH_STYLE", "SQUADRAIL_STORAGE_S3_FORCE_PATH_STYLE")
        ? "env"
        : config?.storage?.s3?.forcePathStyle !== undefined
          ? "config"
          : "default",
      required: false,
      note: "Set true for path-style access on compatible providers",
    },
  ];

  const defaultConfigPath = resolveConfigPath();
  if (process.env.SQUADRAIL_CONFIG || configPath !== defaultConfigPath) {
    rows.push({
      key: "SQUADRAIL_CONFIG",
      value: readEnvAlias("SQUADRAIL_CONFIG", "SQUADRAIL_CONFIG") ?? configPath,
      source: hasEnvAlias("SQUADRAIL_CONFIG", "SQUADRAIL_CONFIG") ? "env" : "default",
      required: false,
      note: "Optional path override for config file",
    });
  }

  return rows.map((row) => ({ ...row, key: displayEnvKey(row.key) }));
}

function uniqueByKey(rows: EnvVarRow[]): EnvVarRow[] {
  const seen = new Set<string>();
  const result: EnvVarRow[] = [];
  for (const row of rows) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    result.push(row);
  }
  return result;
}

function quoteShellValue(value: string): string {
  if (value === "") return "\"\"";
  return `'${value.replaceAll("'", "'\\''")}'`;
}
