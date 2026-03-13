import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadDotenv = vi.fn();
const mockReadConfigFile = vi.fn();
const mockExistsSync = vi.fn();
const mockResolveSquadrailEnvPath = vi.fn();

async function importConfigModule() {
  vi.resetModules();
  vi.doMock("../config-file.js", () => ({
    readConfigFile: mockReadConfigFile,
  }));
  vi.doMock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return {
      ...actual,
      existsSync: mockExistsSync,
    };
  });
  vi.doMock("dotenv", () => ({
    config: mockLoadDotenv,
  }));
  vi.doMock("../paths.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../paths.js")>();
    return {
      ...actual,
      resolveSquadrailEnvPath: mockResolveSquadrailEnvPath,
    };
  });
  return import("../config.js");
}

describe("config service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockReadConfigFile.mockReturnValue(null);
    mockExistsSync.mockReturnValue(false);
    mockResolveSquadrailEnvPath.mockReturnValue("/tmp/squadrail/.env");
    vi.stubEnv("SQUADRAIL_HOME", path.join(os.tmpdir(), "squadrail-config-test"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("../config-file.js");
    vi.doUnmock("../paths.js");
    vi.doUnmock("dotenv");
    vi.doUnmock("node:fs");
  });

  it("loads conservative local defaults when no config file or env overrides are present", async () => {
    const { loadConfig } = await importConfigModule();

    const config = loadConfig();

    expect(config).toMatchObject({
      deploymentMode: "local_trusted",
      deploymentExposure: "private",
      host: "127.0.0.1",
      port: 3100,
      databaseMode: "embedded-postgres",
      serveUi: true,
      secretsProvider: "local_encrypted",
      storageProvider: "local_disk",
      companyDeletionEnabled: true,
      heartbeatSchedulerEnabled: true,
      knowledgeEmbeddingBackfillEnabled: false,
    });
    expect(mockLoadDotenv).not.toHaveBeenCalled();
  });

  it("loads dotenv when a colocated env file exists", async () => {
    mockExistsSync.mockReturnValue(true);
    mockResolveSquadrailEnvPath.mockReturnValue("/repo/.squadrail/.env");

    await importConfigModule();

    expect(mockLoadDotenv).toHaveBeenCalledWith({
      path: "/repo/.squadrail/.env",
      override: false,
      quiet: true,
    });
  });

  it("applies file settings and environment overrides across auth, backup, secrets, and storage", async () => {
    mockReadConfigFile.mockReturnValue({
      server: {
        host: "0.0.0.0",
        port: 3200,
        deploymentMode: "authenticated",
        exposure: "public",
        serveUi: false,
        allowedHostnames: ["api.example.com"],
      },
      auth: {
        baseUrlMode: "auto",
        publicBaseUrl: "https://file.example.com",
      },
      database: {
        mode: "postgres",
        connectionString: "postgres://file-user:file-pass@db/file",
        backup: {
          enabled: false,
          intervalMinutes: 15,
          retentionDays: 7,
          dir: "~/backups",
        },
      },
      secrets: {
        provider: "local_encrypted",
        strictMode: true,
        localEncrypted: {
          keyFilePath: "~/keys/master.key",
        },
      },
      storage: {
        provider: "s3",
        s3: {
          bucket: "file-bucket",
          region: "ap-northeast-2",
          endpoint: "https://s3.file.example.com",
          prefix: "file-prefix",
          forcePathStyle: false,
        },
      },
    });
    vi.stubEnv("SQUADRAIL_DEPLOYMENT_EXPOSURE", "private");
    vi.stubEnv("SQUADRAIL_AUTH_PUBLIC_BASE_URL", "https://env.example.com");
    vi.stubEnv("SQUADRAIL_ALLOWED_HOSTNAMES", "api.example.com, API.INTERNAL.local ");
    vi.stubEnv("SQUADRAIL_DB_BACKUP_ENABLED", "true");
    vi.stubEnv("SQUADRAIL_DB_BACKUP_INTERVAL_MINUTES", "120");
    vi.stubEnv("SQUADRAIL_STORAGE_PROVIDER", "s3");
    vi.stubEnv("SQUADRAIL_STORAGE_S3_BUCKET", "env-bucket");
    vi.stubEnv("SQUADRAIL_STORAGE_S3_FORCE_PATH_STYLE", "true");
    vi.stubEnv("SQUADRAIL_SECRETS_PROVIDER", "env");
    vi.stubEnv("SQUADRAIL_SECRETS_STRICT_MODE", "false");
    vi.stubEnv("SQUADRAIL_ENABLE_COMPANY_DELETION", "false");
    vi.stubEnv("SQUADRAIL_KNOWLEDGE_BACKFILL_ENABLED", "true");
    vi.stubEnv("SQUADRAIL_KNOWLEDGE_BACKFILL_BATCH_SIZE", "25");

    const { loadConfig } = await importConfigModule();
    const config = loadConfig();

    expect(config).toMatchObject({
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      host: "0.0.0.0",
      port: 3200,
      authBaseUrlMode: "auto",
      authPublicBaseUrl: "https://env.example.com",
      databaseMode: "postgres",
      databaseUrl: "postgres://file-user:file-pass@db/file",
      databaseBackupEnabled: true,
      databaseBackupIntervalMinutes: 120,
      secretsProvider: "local_encrypted",
      secretsStrictMode: false,
      storageProvider: "s3",
      storageS3Bucket: "env-bucket",
      storageS3Region: "ap-northeast-2",
      storageS3Endpoint: "https://s3.file.example.com",
      storageS3Prefix: "file-prefix",
      storageS3ForcePathStyle: true,
      companyDeletionEnabled: false,
      knowledgeEmbeddingBackfillEnabled: true,
      knowledgeEmbeddingBackfillBatchSize: 25,
    });
    expect(config.allowedHostnames).toEqual([
      "api.example.com",
      "api.internal.local",
    ]);
    expect(config.databaseBackupDir).toContain("backups");
    expect(config.secretsMasterKeyFilePath).toContain(path.join("keys", "master.key"));
  });
});
