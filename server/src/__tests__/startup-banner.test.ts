import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printStartupBanner } from "../startup-banner.js";

describe("startup banner", () => {
  const squadrailHomeEnv = "SQUADRAIL_HOME";
  const squadrailAgentJwtSecretEnv = "SQUADRAIL_AGENT_JWT_SECRET";
  const squadrailConfigEnv = "SQUADRAIL_CONFIG";
  const originalEnv = {
    squadrailHome: process.env[squadrailHomeEnv],
    squadrailAgentJwtSecret: process.env[squadrailAgentJwtSecretEnv],
    squadrailConfig: process.env[squadrailConfigEnv],
  };

  beforeEach(() => {
    delete process.env[squadrailHomeEnv];
    delete process.env[squadrailAgentJwtSecretEnv];
    delete process.env[squadrailConfigEnv];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv.squadrailHome === undefined) delete process.env[squadrailHomeEnv];
    else process.env[squadrailHomeEnv] = originalEnv.squadrailHome;
    if (originalEnv.squadrailAgentJwtSecret === undefined) delete process.env[squadrailAgentJwtSecretEnv];
    else process.env[squadrailAgentJwtSecretEnv] = originalEnv.squadrailAgentJwtSecret;
    if (originalEnv.squadrailConfig === undefined) delete process.env[squadrailConfigEnv];
    else process.env[squadrailConfigEnv] = originalEnv.squadrailConfig;
  });

  it("shows fallback local agent jwt secret status when SQUADRAIL_HOME contains the managed secret", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "squadrail-banner-"));
    process.env[squadrailHomeEnv] = tempRoot;
    fs.writeFileSync(path.join(tempRoot, "agent-jwt.secret"), "managed-secret\n", "utf8");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    printStartupBanner({
      host: "127.0.0.1",
      deploymentMode: "local",
      deploymentExposure: "loopback",
      authReady: true,
      requestedPort: 3311,
      listenPort: 3311,
      uiMode: "vite-dev",
      db: {
        mode: "embedded-postgres",
        dataDir: "/tmp/squadrail-banner-db",
        port: 5432,
      },
      migrationSummary: "up to date",
      heartbeatSchedulerEnabled: false,
      heartbeatSchedulerIntervalMs: 60_000,
      databaseBackupEnabled: false,
      databaseBackupIntervalMinutes: 60,
      databaseBackupRetentionDays: 7,
      databaseBackupDir: "/tmp/squadrail-banner-backups",
    });

    const output = logSpy.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("Agent JWT");
    expect(output).toContain("managed in");
    expect(output).not.toContain("missing (run `pnpm squadrail onboard`)");

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("warns when the JWT secret exists in the env file but is not loaded and redacts external database URLs", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "squadrail-banner-"));
    process.env[squadrailConfigEnv] = path.join(tempRoot, "config.json");
    fs.writeFileSync(process.env[squadrailConfigEnv]!, "{}", "utf8");
    fs.writeFileSync(path.join(tempRoot, ".env"), "SQUADRAIL_AGENT_JWT_SECRET=file-secret\n", "utf8");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    printStartupBanner({
      host: "0.0.0.0",
      deploymentMode: "authenticated",
      deploymentExposure: "public",
      authReady: false,
      requestedPort: 3144,
      listenPort: 3150,
      uiMode: "static",
      db: {
        mode: "external-postgres",
        connectionString: "postgres://squadrail:super-secret@db.internal:5432/squadrail",
      },
      migrationSummary: "pending migrations skipped",
      heartbeatSchedulerEnabled: true,
      heartbeatSchedulerIntervalMs: 30_000,
      databaseBackupEnabled: true,
      databaseBackupIntervalMinutes: 30,
      databaseBackupRetentionDays: 14,
      databaseBackupDir: "/backups/squadrail",
    });

    const output = logSpy.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("found in");
    expect(output).toContain("localhost:3150");
    expect(output).toContain("postgres://squadrail:***@db.internal:5432/squadrail");
    expect(output).toContain("every 30m, keep 14d");

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
