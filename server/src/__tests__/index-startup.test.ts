import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  state,
  mockCreateDb,
  mockEnsurePostgresDatabase,
  mockInspectMigrations,
  mockApplyPendingMigrations,
  mockReconcilePendingMigrationHistory,
  mockCreateApp,
  mockLoadConfig,
  mockSetupLiveEventsWebSocketServer,
  mockHeartbeatService,
  mockIssueProtocolTimeoutService,
  mockKnowledgeBackfillService,
  mockOperatingAlertService,
  mockRegisterLiveEventSink,
  mockCreateStorageServiceFromConfig,
  mockPrintStartupBanner,
  mockGetBoardClaimWarningUrl,
  mockInitializeBoardClaimChallenge,
  mockCreateBetterAuthHandler,
  mockCreateBetterAuthInstance,
  mockResolveBetterAuthSession,
  mockResolveBetterAuthSessionFromHeaders,
  mockDetectPort,
  mockCreateServer,
  mockListen,
  mockExistsSync,
  mockReadFileSync,
  mockRmSync,
  mockEmbeddedInitialise,
  mockEmbeddedStart,
  mockEmbeddedStop,
  mockOpenDefault,
  mockFormatDatabaseBackupResult,
  mockRunDatabaseBackup,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
} = vi.hoisted(() => {
  const state = {
    config: null as Record<string, unknown> | null,
    selectQueue: [] as unknown[][],
    insertValues: [] as Array<{ table: unknown; value: unknown }>,
  };

  const createResolvedChain = (rows: unknown[]) => {
    const chain = {
      from: () => chain,
      where: () => chain,
      then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve),
    };
    return chain;
  };

  const db = {
    select: () => createResolvedChain(state.selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: async (value: unknown) => {
        state.insertValues.push({ table, value });
      },
    }),
  };

  const mockCreateDb = vi.fn(() => db);
  const mockEnsurePostgresDatabase = vi.fn();
  const mockInspectMigrations = vi.fn();
  const mockApplyPendingMigrations = vi.fn();
  const mockReconcilePendingMigrationHistory = vi.fn();
  const mockCreateApp = vi.fn();
  const mockLoadConfig = vi.fn(() => state.config);
  const mockSetupLiveEventsWebSocketServer = vi.fn();
  const mockHeartbeatService = vi.fn(() => ({ reapOrphanedRuns: vi.fn(), tickTimers: vi.fn() }));
  const mockIssueProtocolTimeoutService = vi.fn(() => ({ tick: vi.fn() }));
  const mockKnowledgeBackfillService = vi.fn(() => ({ tick: vi.fn() }));
  const mockOperatingAlertService = vi.fn(() => ({ dispatchLiveEvent: vi.fn(), getView: vi.fn() }));
  const mockRegisterLiveEventSink = vi.fn();
  const mockCreateStorageServiceFromConfig = vi.fn(() => ({ provider: "local_disk" }));
  const mockPrintStartupBanner = vi.fn();
  const mockGetBoardClaimWarningUrl = vi.fn(() => null);
  const mockInitializeBoardClaimChallenge = vi.fn();
  const mockCreateBetterAuthHandler = vi.fn(() => "better-auth-handler");
  const mockCreateBetterAuthInstance = vi.fn(() => ({ id: "auth-instance" }));
  const mockResolveBetterAuthSession = vi.fn();
  const mockResolveBetterAuthSessionFromHeaders = vi.fn();
  const mockDetectPort = vi.fn();
  const mockListen = vi.fn((_port: number, _host: string, callback?: () => void) => {
    callback?.();
  });
  const mockCreateServer = vi.fn(() => ({ listen: mockListen }));
  const mockExistsSync = vi.fn(() => false);
  const mockReadFileSync = vi.fn(() => "");
  const mockRmSync = vi.fn();
  const mockEmbeddedInitialise = vi.fn(async () => undefined);
  const mockEmbeddedStart = vi.fn(async () => undefined);
  const mockEmbeddedStop = vi.fn(async () => undefined);
  const mockOpenDefault = vi.fn(async () => undefined);
  const mockFormatDatabaseBackupResult = vi.fn(() => "backup ok");
  const mockRunDatabaseBackup = vi.fn();
  const mockLoggerInfo = vi.fn();
  const mockLoggerWarn = vi.fn();
  const mockLoggerError = vi.fn();

  return {
    state,
    mockCreateDb,
    mockEnsurePostgresDatabase,
    mockInspectMigrations,
    mockApplyPendingMigrations,
    mockReconcilePendingMigrationHistory,
    mockCreateApp,
    mockLoadConfig,
    mockSetupLiveEventsWebSocketServer,
    mockHeartbeatService,
    mockIssueProtocolTimeoutService,
    mockKnowledgeBackfillService,
    mockOperatingAlertService,
    mockRegisterLiveEventSink,
    mockCreateStorageServiceFromConfig,
    mockPrintStartupBanner,
    mockGetBoardClaimWarningUrl,
    mockInitializeBoardClaimChallenge,
    mockCreateBetterAuthHandler,
    mockCreateBetterAuthInstance,
    mockResolveBetterAuthSession,
    mockResolveBetterAuthSessionFromHeaders,
    mockDetectPort,
    mockCreateServer,
    mockListen,
    mockExistsSync,
    mockReadFileSync,
    mockRmSync,
    mockEmbeddedInitialise,
    mockEmbeddedStart,
    mockEmbeddedStop,
    mockOpenDefault,
    mockFormatDatabaseBackupResult,
    mockRunDatabaseBackup,
    mockLoggerInfo,
    mockLoggerWarn,
    mockLoggerError,
  };
});

vi.mock("node:http", () => ({
  createServer: mockCreateServer,
}));

vi.mock("detect-port", () => ({
  default: mockDetectPort,
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    rmSync: mockRmSync,
  };
});

vi.mock("@squadrail/db", () => ({
  createDb: mockCreateDb,
  ensurePostgresDatabase: mockEnsurePostgresDatabase,
  inspectMigrations: mockInspectMigrations,
  applyPendingMigrations: mockApplyPendingMigrations,
  reconcilePendingMigrationHistory: mockReconcilePendingMigrationHistory,
  formatDatabaseBackupResult: mockFormatDatabaseBackupResult,
  runDatabaseBackup: mockRunDatabaseBackup,
  authUsers: { id: "authUsers.id" },
  companies: { id: "companies.id" },
  companyMemberships: { id: "companyMemberships.id", companyId: "companyMemberships.companyId", principalType: "companyMemberships.principalType", principalId: "companyMemberships.principalId" },
  instanceUserRoles: { id: "instanceUserRoles.id", userId: "instanceUserRoles.userId", role: "instanceUserRoles.role" },
}));

vi.mock("../app.js", () => ({
  createApp: mockCreateApp,
}));

vi.mock("../config.js", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  },
}));

vi.mock("../realtime/live-events-ws.js", () => ({
  setupLiveEventsWebSocketServer: mockSetupLiveEventsWebSocketServer,
}));

vi.mock("../services/index.js", () => ({
  heartbeatService: mockHeartbeatService,
  issueProtocolTimeoutService: mockIssueProtocolTimeoutService,
  knowledgeBackfillService: mockKnowledgeBackfillService,
  operatingAlertService: mockOperatingAlertService,
  registerLiveEventSink: mockRegisterLiveEventSink,
}));

vi.mock("../storage/index.js", () => ({
  createStorageServiceFromConfig: mockCreateStorageServiceFromConfig,
}));

vi.mock("../startup-banner.js", () => ({
  printStartupBanner: mockPrintStartupBanner,
}));

vi.mock("../board-claim.js", () => ({
  getBoardClaimWarningUrl: mockGetBoardClaimWarningUrl,
  initializeBoardClaimChallenge: mockInitializeBoardClaimChallenge,
}));

vi.mock("../auth/better-auth.js", () => ({
  createBetterAuthHandler: mockCreateBetterAuthHandler,
  createBetterAuthInstance: mockCreateBetterAuthInstance,
  resolveBetterAuthSession: mockResolveBetterAuthSession,
  resolveBetterAuthSessionFromHeaders: mockResolveBetterAuthSessionFromHeaders,
}));

vi.mock("embedded-postgres", () => ({
  default: class EmbeddedPostgres {
    initialise = mockEmbeddedInitialise;
    start = mockEmbeddedStart;
    stop = mockEmbeddedStop;
  },
}));

vi.mock("open", () => ({
  default: mockOpenDefault,
}));

const ORIGINAL_ENV = { ...process.env };

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    databaseUrl: "postgresql://postgres@db.example.com:5432/squadrail",
    databaseMode: "postgres",
    embeddedPostgresDataDir: "/tmp/embedded-pg",
    embeddedPostgresPort: 5433,
    deploymentMode: "local_trusted",
    deploymentExposure: "private",
    authBaseUrlMode: "default",
    authPublicBaseUrl: null,
    host: "127.0.0.1",
    port: 3144,
    uiDevMiddleware: false,
    serveUi: false,
    companyDeletionEnabled: true,
    heartbeatSchedulerEnabled: false,
    heartbeatSchedulerIntervalMs: 30_000,
    knowledgeEmbeddingBackfillEnabled: false,
    knowledgeEmbeddingBackfillIntervalMs: 60_000,
    knowledgeEmbeddingBackfillBatchSize: 25,
    databaseBackupEnabled: false,
    databaseBackupIntervalMinutes: 60,
    databaseBackupRetentionDays: 7,
    databaseBackupDir: "/tmp/backups",
    allowedHostnames: [],
    secretsProvider: "local_encrypted",
    secretsStrictMode: true,
    secretsMasterKeyFilePath: "/tmp/squadrail-master.key",
    ...overrides,
  };
}

describe("server index startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    state.selectQueue = [];
    state.insertValues = [];
    state.config = baseConfig();
    mockCreateApp.mockResolvedValue((_req: unknown, _res: unknown) => undefined);
    mockInspectMigrations.mockResolvedValue({ status: "upToDate" });
    mockReconcilePendingMigrationHistory.mockResolvedValue({ repairedMigrations: [] });
    mockDetectPort.mockImplementation(async (port: number) => port);
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("");
    mockFormatDatabaseBackupResult.mockReturnValue("backup ok");
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SQUADRAIL_SECRETS_PROVIDER;
    delete process.env.SQUADRAIL_SECRETS_STRICT_MODE;
    delete process.env.SQUADRAIL_SECRETS_MASTER_KEY_FILE;
    delete process.env.SQUADRAIL_MIGRATION_AUTO_APPLY;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.SQUADRAIL_OPEN_ON_LISTEN;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("boots in external local_trusted mode and seeds the local board principal", async () => {
    state.selectQueue = [
      [],
      [],
      [],
    ];

    await import("../index.js");

    expect(mockInspectMigrations).toHaveBeenCalledWith(
      "postgresql://postgres@db.example.com:5432/squadrail",
    );
    expect(mockCreateDb).toHaveBeenCalledWith("postgresql://postgres@db.example.com:5432/squadrail");
    expect(mockCreateApp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        uiMode: "none",
        deploymentMode: "local_trusted",
        authReady: true,
        companyDeletionEnabled: true,
        protocolTimeoutsEnabled: false,
        knowledgeBackfillEnabled: false,
        storageService: { provider: "local_disk" },
      }),
    );
    expect(mockCreateServer).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith(3144, "127.0.0.1", expect.any(Function));
    expect(mockSetupLiveEventsWebSocketServer).toHaveBeenCalledWith(
      expect.any(Object),
      expect.anything(),
      expect.objectContaining({
        deploymentMode: "local_trusted",
      }),
    );
    expect(mockPrintStartupBanner).toHaveBeenCalledWith(expect.objectContaining({
      host: "127.0.0.1",
      listenPort: 3144,
      migrationSummary: "already applied",
      db: {
        mode: "external-postgres",
        connectionString: "postgresql://postgres@db.example.com:5432/squadrail",
      },
    }));
    expect(state.insertValues).toHaveLength(2);
    expect(process.env.SQUADRAIL_SECRETS_PROVIDER).toBe("local_encrypted");
    expect(process.env.SQUADRAIL_SECRETS_STRICT_MODE).toBe("true");
    expect(process.env.SQUADRAIL_SECRETS_MASTER_KEY_FILE).toBe("/tmp/squadrail-master.key");
    expect(process.env.SQUADRAIL_API_URL).toBe("http://127.0.0.1:3144");
  });

  it("auto-applies pending migrations when the runtime is configured to do so", async () => {
    state.selectQueue = [[], [], []];
    mockInspectMigrations.mockResolvedValue({
      status: "needsMigrations",
      reason: "no-migration-journal-non-empty-db",
      tableCount: 3,
      pendingMigrations: ["001_init", "002_seed"],
    });
    process.env.SQUADRAIL_MIGRATION_AUTO_APPLY = "true";

    await import("../index.js");

    expect(mockApplyPendingMigrations).toHaveBeenCalledWith(
      "postgresql://postgres@db.example.com:5432/squadrail",
    );
    expect(mockPrintStartupBanner).toHaveBeenCalledWith(expect.objectContaining({
      migrationSummary: "applied (pending migrations)",
    }));
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      { pendingMigrations: ["001_init", "002_seed"] },
      "Applying 2 pending migrations for PostgreSQL",
    );
  });

  it("boots authenticated public mode with auth wiring and browser open", async () => {
    state.config = baseConfig({
      deploymentMode: "authenticated",
      deploymentExposure: "public",
      authBaseUrlMode: "explicit",
      authPublicBaseUrl: "https://squadrail.example.com",
      host: "0.0.0.0",
      port: 4141,
    });
    process.env.BETTER_AUTH_SECRET = "test-secret";
    process.env.SQUADRAIL_OPEN_ON_LISTEN = "true";
    mockGetBoardClaimWarningUrl.mockReturnValue("http://127.0.0.1:4141/claim");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await import("../index.js");
    await flushMicrotasks();

    expect(mockCreateBetterAuthInstance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      deploymentMode: "authenticated",
    }));
    expect(mockCreateBetterAuthHandler).toHaveBeenCalledTimes(1);
    expect(mockInitializeBoardClaimChallenge).toHaveBeenCalledTimes(1);
    expect(mockSetupLiveEventsWebSocketServer).toHaveBeenCalledWith(
      expect.any(Object),
      expect.anything(),
      expect.objectContaining({
        deploymentMode: "authenticated",
        resolveSessionFromHeaders: expect.any(Function),
      }),
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("BOARD CLAIM REQUIRED"));
    expect(mockPrintStartupBanner).toHaveBeenCalledWith(expect.objectContaining({
      deploymentMode: "authenticated",
      deploymentExposure: "public",
      authReady: true,
      requestedPort: 4141,
      listenPort: 4141,
    }));
    expect(process.env.SQUADRAIL_API_URL).toBe("http://localhost:4141");
  });

  it("schedules heartbeat, backfill, and backup workers and logs their activity", async () => {
    state.selectQueue = [[], [], []];
    state.config = baseConfig({
      heartbeatSchedulerEnabled: true,
      knowledgeEmbeddingBackfillEnabled: true,
      databaseBackupEnabled: true,
    });
    const heartbeat = {
      reapOrphanedRuns: vi.fn().mockResolvedValue(undefined),
      tickTimers: vi.fn().mockResolvedValue({ enqueued: 2 }),
    };
    const protocolTimeouts = {
      tick: vi.fn().mockResolvedValue({ remindersSent: 1, escalationsSent: 0 }),
    };
    const backfill = {
      tick: vi.fn().mockResolvedValue({ processed: 3, failed: 0 }),
    };
    mockHeartbeatService.mockReturnValue(heartbeat);
    mockIssueProtocolTimeoutService.mockReturnValue(protocolTimeouts);
    mockKnowledgeBackfillService.mockReturnValue(backfill);
    mockRunDatabaseBackup.mockResolvedValue({
      backupFile: "/tmp/backups/squadrail.sql.gz",
      sizeBytes: 512,
      prunedCount: 1,
    });
    const intervalCallbacks: Array<() => void> = [];
    const setIntervalSpy = vi.spyOn(global, "setInterval").mockImplementation(((callback: TimerHandler) => {
      intervalCallbacks.push(callback as () => void);
      return 1 as never;
    }) as typeof global.setInterval);

    await import("../index.js");
    await Promise.resolve();

    expect(heartbeat.reapOrphanedRuns).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledTimes(3);

    intervalCallbacks[0]?.();
    intervalCallbacks[1]?.();
    intervalCallbacks[2]?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(heartbeat.tickTimers).toHaveBeenCalledTimes(1);
    expect(protocolTimeouts.tick).toHaveBeenCalledTimes(1);
    expect(backfill.tick).toHaveBeenCalledTimes(1);
    expect(mockRunDatabaseBackup).toHaveBeenCalledTimes(1);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ enqueued: 2 }),
      "heartbeat timer tick enqueued runs",
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ processed: 3, failed: 0 }),
      "knowledge embedding backfill worker processed documents",
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        backupFile: "/tmp/backups/squadrail.sql.gz",
        backupDir: "/tmp/backups",
        retentionDays: 7,
      }),
      "Automatic database backup complete: backup ok",
    );
  });

  it("falls back to embedded postgres when no database url is configured", async () => {
    state.selectQueue = [[], [], []];
    state.config = baseConfig({
      databaseUrl: "",
      databaseMode: "postgres",
      embeddedPostgresPort: 5435,
    });
    mockDetectPort.mockResolvedValue(5444);
    mockEnsurePostgresDatabase.mockResolvedValue("created");
    mockInspectMigrations.mockResolvedValue({
      status: "needsMigrations",
      reason: "pending-migrations",
      pendingMigrations: ["001_init"],
    });

    await import("../index.js");

    expect(mockEmbeddedInitialise).toHaveBeenCalledTimes(1);
    expect(mockEmbeddedStart).toHaveBeenCalledTimes(1);
    expect(mockEnsurePostgresDatabase).toHaveBeenCalledWith(
      "postgres://squadrail:squadrail@127.0.0.1:5444/postgres",
      "squadrail",
    );
    expect(mockApplyPendingMigrations).toHaveBeenCalledWith(
      "postgres://squadrail:squadrail@127.0.0.1:5444/squadrail",
    );
    expect(mockCreateDb).toHaveBeenCalledWith(
      "postgres://squadrail:squadrail@127.0.0.1:5444/squadrail",
    );
    expect(mockPrintStartupBanner).toHaveBeenCalledWith(expect.objectContaining({
      db: {
        mode: "embedded-postgres",
        dataDir: "/tmp/embedded-pg",
        port: 5444,
      },
    }));
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "Database mode is postgres but no connection string was set; falling back to embedded PostgreSQL",
    );
  });

  it("rejects local_trusted mode when bound to a non-loopback host", async () => {
    state.config = baseConfig({
      host: "10.0.0.5",
    });
    state.selectQueue = [[], [], []];

    await expect(import("../index.js")).rejects.toThrow(
      "local_trusted mode requires loopback host binding",
    );
  });

  it("rejects local_trusted mode when exposure is public", async () => {
    state.config = baseConfig({
      deploymentExposure: "public",
    });
    state.selectQueue = [[], [], []];

    await expect(import("../index.js")).rejects.toThrow(
      "local_trusted mode only supports private exposure",
    );
  });

  it("rejects authenticated mode without an auth secret", async () => {
    state.config = baseConfig({
      deploymentMode: "authenticated",
      deploymentExposure: "private",
    });

    await expect(import("../index.js")).rejects.toThrow(
      "authenticated mode requires BETTER_AUTH_SECRET",
    );
  });
});
