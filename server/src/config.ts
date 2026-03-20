import { readConfigFile } from "./config-file.js";
import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { resolveSquadrailEnvPath } from "./paths.js";
import {
  AUTH_BASE_URL_MODES,
  DEPLOYMENT_EXPOSURES,
  DEPLOYMENT_MODES,
  SECRET_PROVIDERS,
  STORAGE_PROVIDERS,
  type AuthBaseUrlMode,
  type DeploymentExposure,
  type DeploymentMode,
  type SecretProvider,
  type StorageProvider,
} from "@squadrail/shared";
import {
  resolveDefaultBackupDir,
  resolveDefaultEmbeddedPostgresDir,
  resolveDefaultSecretsKeyFilePath,
  resolveDefaultStorageDir,
  resolveHomeAwarePath,
} from "./home-paths.js";

const SQUADRAIL_ENV_FILE_PATH = resolveSquadrailEnvPath();
if (existsSync(SQUADRAIL_ENV_FILE_PATH)) {
  loadDotenv({ path: SQUADRAIL_ENV_FILE_PATH, override: false, quiet: true });
}

function readEnvAlias(...keys: string[]) {
  for (const key of new Set(keys.filter((value) => typeof value === "string" && value.length > 0))) {
    const value = process.env[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

function readBooleanEnvAlias(keys: string[], fallback: boolean) {
  const value = readEnvAlias(...keys);
  return value !== undefined ? value === "true" : fallback;
}

type DatabaseMode = "embedded-postgres" | "postgres";

export interface Config {
  deploymentMode: DeploymentMode;
  deploymentExposure: DeploymentExposure;
  host: string;
  port: number;
  allowedHostnames: string[];
  authBaseUrlMode: AuthBaseUrlMode;
  authPublicBaseUrl: string | undefined;
  authRequireEmailVerification: boolean;
  databaseMode: DatabaseMode;
  databaseUrl: string | undefined;
  embeddedPostgresDataDir: string;
  embeddedPostgresPort: number;
  databaseBackupEnabled: boolean;
  databaseBackupIntervalMinutes: number;
  databaseBackupRetentionDays: number;
  databaseBackupDir: string;
  serveUi: boolean;
  uiDevMiddleware: boolean;
  secretsProvider: SecretProvider;
  secretsStrictMode: boolean;
  secretsMasterKeyFilePath: string;
  storageProvider: StorageProvider;
  storageLocalDiskBaseDir: string;
  storageS3Bucket: string;
  storageS3Region: string;
  storageS3Endpoint: string | undefined;
  storageS3Prefix: string;
  storageS3ForcePathStyle: boolean;
  heartbeatSchedulerEnabled: boolean;
  heartbeatSchedulerIntervalMs: number;
  knowledgeEmbeddingBackfillEnabled: boolean;
  knowledgeEmbeddingBackfillIntervalMs: number;
  knowledgeEmbeddingBackfillBatchSize: number;
  companyDeletionEnabled: boolean;
  issueDocumentMaxBodyChars: number;
}

export function loadConfig(): Config {
  const fileConfig = readConfigFile();
  const fileDatabaseMode =
    (fileConfig?.database.mode === "postgres" ? "postgres" : "embedded-postgres") as DatabaseMode;

  const fileDbUrl =
    fileDatabaseMode === "postgres"
      ? fileConfig?.database.connectionString
      : undefined;
  const fileDatabaseBackup = fileConfig?.database.backup;
  const fileSecrets = fileConfig?.secrets;
  const fileStorage = fileConfig?.storage;
  const strictModeFromEnv = readEnvAlias("SQUADRAIL_SECRETS_STRICT_MODE");
  const secretsStrictMode =
    strictModeFromEnv !== undefined
      ? strictModeFromEnv === "true"
      : (fileSecrets?.strictMode ?? false);

  const providerFromEnvRaw = readEnvAlias("SQUADRAIL_SECRETS_PROVIDER");
  const providerFromEnv =
    providerFromEnvRaw && SECRET_PROVIDERS.includes(providerFromEnvRaw as SecretProvider)
      ? (providerFromEnvRaw as SecretProvider)
      : null;
  const providerFromFile = fileSecrets?.provider;
  const secretsProvider: SecretProvider = providerFromEnv ?? providerFromFile ?? "local_encrypted";

  const storageProviderFromEnvRaw = readEnvAlias("SQUADRAIL_STORAGE_PROVIDER");
  const storageProviderFromEnv =
    storageProviderFromEnvRaw && STORAGE_PROVIDERS.includes(storageProviderFromEnvRaw as StorageProvider)
      ? (storageProviderFromEnvRaw as StorageProvider)
      : null;
  const storageProvider: StorageProvider = storageProviderFromEnv ?? fileStorage?.provider ?? "local_disk";
  const storageLocalDiskBaseDir = resolveHomeAwarePath(
    readEnvAlias("SQUADRAIL_STORAGE_LOCAL_DIR") ??
      fileStorage?.localDisk?.baseDir ??
      resolveDefaultStorageDir(),
  );
  const storageS3Bucket = readEnvAlias("SQUADRAIL_STORAGE_S3_BUCKET") ?? fileStorage?.s3?.bucket ?? "squadrail";
  const storageS3Region = readEnvAlias("SQUADRAIL_STORAGE_S3_REGION") ?? fileStorage?.s3?.region ?? "us-east-1";
  const storageS3Endpoint = readEnvAlias("SQUADRAIL_STORAGE_S3_ENDPOINT") ?? fileStorage?.s3?.endpoint ?? undefined;
  const storageS3Prefix = readEnvAlias("SQUADRAIL_STORAGE_S3_PREFIX") ?? fileStorage?.s3?.prefix ?? "";
  const storageS3ForcePathStyle = readBooleanEnvAlias(
    ["SQUADRAIL_STORAGE_S3_FORCE_PATH_STYLE"],
    fileStorage?.s3?.forcePathStyle ?? false,
  );

  const deploymentModeFromEnvRaw = readEnvAlias("SQUADRAIL_DEPLOYMENT_MODE");
  const deploymentModeFromEnv =
    deploymentModeFromEnvRaw && DEPLOYMENT_MODES.includes(deploymentModeFromEnvRaw as DeploymentMode)
      ? (deploymentModeFromEnvRaw as DeploymentMode)
      : null;
  const deploymentMode: DeploymentMode = deploymentModeFromEnv ?? fileConfig?.server.deploymentMode ?? "local_trusted";
  const deploymentExposureFromEnvRaw = readEnvAlias("SQUADRAIL_DEPLOYMENT_EXPOSURE");
  const deploymentExposureFromEnv =
    deploymentExposureFromEnvRaw &&
    DEPLOYMENT_EXPOSURES.includes(deploymentExposureFromEnvRaw as DeploymentExposure)
      ? (deploymentExposureFromEnvRaw as DeploymentExposure)
      : null;
  const deploymentExposure: DeploymentExposure =
    deploymentMode === "local_trusted"
      ? "private"
      : (deploymentExposureFromEnv ?? fileConfig?.server.exposure ?? "private");
  const authBaseUrlModeFromEnvRaw = readEnvAlias("SQUADRAIL_AUTH_BASE_URL_MODE");
  const authBaseUrlModeFromEnv =
    authBaseUrlModeFromEnvRaw &&
    AUTH_BASE_URL_MODES.includes(authBaseUrlModeFromEnvRaw as AuthBaseUrlMode)
      ? (authBaseUrlModeFromEnvRaw as AuthBaseUrlMode)
      : null;
  const authPublicBaseUrlRaw =
    readEnvAlias("SQUADRAIL_AUTH_PUBLIC_BASE_URL") ??
    process.env.BETTER_AUTH_URL ??
    fileConfig?.auth?.publicBaseUrl;
  const authPublicBaseUrl = authPublicBaseUrlRaw?.trim() || undefined;
  const authRequireEmailVerificationEnv = readEnvAlias(
    "SQUADRAIL_AUTH_REQUIRE_EMAIL_VERIFICATION",
    "BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION",
  );
  const authRequireEmailVerification =
    authRequireEmailVerificationEnv !== undefined
      ? authRequireEmailVerificationEnv === "true"
      : (fileConfig?.auth?.requireEmailVerification ?? false);
  const authBaseUrlMode: AuthBaseUrlMode =
    authBaseUrlModeFromEnv ??
    fileConfig?.auth?.baseUrlMode ??
    (authPublicBaseUrl ? "explicit" : "auto");
  const allowedHostnamesFromEnvRaw = readEnvAlias("SQUADRAIL_ALLOWED_HOSTNAMES");
  const allowedHostnamesFromEnv = allowedHostnamesFromEnvRaw
    ? allowedHostnamesFromEnvRaw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0)
    : null;
  const allowedHostnames = Array.from(
    new Set((allowedHostnamesFromEnv ?? fileConfig?.server.allowedHostnames ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean)),
  );
  const companyDeletionEnvRaw = readEnvAlias("SQUADRAIL_ENABLE_COMPANY_DELETION");
  const companyDeletionEnabled =
    companyDeletionEnvRaw !== undefined
      ? companyDeletionEnvRaw === "true"
      : deploymentMode === "local_trusted";
  const databaseBackupEnabled = readBooleanEnvAlias(
    ["SQUADRAIL_DB_BACKUP_ENABLED"],
    fileDatabaseBackup?.enabled ?? true,
  );
  const databaseBackupIntervalMinutes = Math.max(
    1,
    Number(readEnvAlias("SQUADRAIL_DB_BACKUP_INTERVAL_MINUTES")) ||
      fileDatabaseBackup?.intervalMinutes ||
      60,
  );
  const databaseBackupRetentionDays = Math.max(
    1,
    Number(readEnvAlias("SQUADRAIL_DB_BACKUP_RETENTION_DAYS")) ||
      fileDatabaseBackup?.retentionDays ||
      30,
  );
  const databaseBackupDir = resolveHomeAwarePath(
    readEnvAlias("SQUADRAIL_DB_BACKUP_DIR") ??
      fileDatabaseBackup?.dir ??
      resolveDefaultBackupDir(),
  );

  return {
    deploymentMode,
    deploymentExposure,
    host: process.env.HOST ?? fileConfig?.server.host ?? "127.0.0.1",
    port: Number(process.env.PORT) || fileConfig?.server.port || 3100,
    allowedHostnames,
    authBaseUrlMode,
    authPublicBaseUrl,
    authRequireEmailVerification,
    databaseMode: fileDatabaseMode,
    databaseUrl: process.env.DATABASE_URL ?? fileDbUrl,
    embeddedPostgresDataDir: resolveHomeAwarePath(
      fileConfig?.database.embeddedPostgresDataDir ?? resolveDefaultEmbeddedPostgresDir(),
    ),
    embeddedPostgresPort: fileConfig?.database.embeddedPostgresPort ?? 54329,
    databaseBackupEnabled,
    databaseBackupIntervalMinutes,
    databaseBackupRetentionDays,
    databaseBackupDir,
    serveUi:
      process.env.SERVE_UI !== undefined
        ? process.env.SERVE_UI === "true"
        : fileConfig?.server.serveUi ?? true,
    uiDevMiddleware: readBooleanEnvAlias(["SQUADRAIL_UI_DEV_MIDDLEWARE"], false),
    secretsProvider,
    secretsStrictMode,
    secretsMasterKeyFilePath:
      resolveHomeAwarePath(
        readEnvAlias("SQUADRAIL_SECRETS_MASTER_KEY_FILE") ??
          fileSecrets?.localEncrypted.keyFilePath ??
          resolveDefaultSecretsKeyFilePath(),
      ),
    storageProvider,
    storageLocalDiskBaseDir,
    storageS3Bucket,
    storageS3Region,
    storageS3Endpoint,
    storageS3Prefix,
    storageS3ForcePathStyle,
    heartbeatSchedulerEnabled: process.env.HEARTBEAT_SCHEDULER_ENABLED !== "false",
    heartbeatSchedulerIntervalMs: Math.max(10000, Number(process.env.HEARTBEAT_SCHEDULER_INTERVAL_MS) || 30000),
    knowledgeEmbeddingBackfillEnabled: readBooleanEnvAlias(["SQUADRAIL_KNOWLEDGE_BACKFILL_ENABLED"], false),
    knowledgeEmbeddingBackfillIntervalMs: Math.max(
      30000,
      Number(readEnvAlias("SQUADRAIL_KNOWLEDGE_BACKFILL_INTERVAL_MS")) || 5 * 60 * 1000,
    ),
    knowledgeEmbeddingBackfillBatchSize: Math.max(
      1,
      Math.min(50, Number(readEnvAlias("SQUADRAIL_KNOWLEDGE_BACKFILL_BATCH_SIZE")) || 5),
    ),
    companyDeletionEnabled,
    issueDocumentMaxBodyChars: Math.max(
      1_000,
      Math.min(
        2_000_000,
        Number(readEnvAlias("SQUADRAIL_ISSUE_DOCUMENT_MAX_BODY_CHARS"))
          || fileConfig?.server.issueDocumentMaxBodyChars
          || 200_000,
      ),
    ),
  };
}
