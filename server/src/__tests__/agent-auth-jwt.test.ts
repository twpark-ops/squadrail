import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLocalAgentJwt, verifyLocalAgentJwt } from "../agent-auth-jwt.js";

describe("agent local JWT", () => {
  const secretEnv = "SQUADRAIL_AGENT_JWT_SECRET";
  const ttlEnv = "SQUADRAIL_AGENT_JWT_TTL_SECONDS";
  const issuerEnv = "SQUADRAIL_AGENT_JWT_ISSUER";
  const audienceEnv = "SQUADRAIL_AGENT_JWT_AUDIENCE";
  const squadrailSecretEnv = "SQUADRAIL_AGENT_JWT_SECRET";
  const squadrailTtlEnv = "SQUADRAIL_AGENT_JWT_TTL_SECONDS";
  const squadrailMasterKeyFileEnv = "SQUADRAIL_SECRETS_MASTER_KEY_FILE";
  const squadrailHomeEnv = "SQUADRAIL_HOME";

  const originalEnv = {
    secret: process.env[secretEnv],
    ttl: process.env[ttlEnv],
    issuer: process.env[issuerEnv],
    audience: process.env[audienceEnv],
    squadrailSecret: process.env[squadrailSecretEnv],
    squadrailTtl: process.env[squadrailTtlEnv],
    squadrailMasterKeyFile: process.env[squadrailMasterKeyFileEnv],
    squadrailHome: process.env[squadrailHomeEnv],
  };

  beforeEach(() => {
    process.env[secretEnv] = "test-secret";
    process.env[ttlEnv] = "3600";
    delete process.env[squadrailSecretEnv];
    delete process.env[squadrailTtlEnv];
    delete process.env[squadrailMasterKeyFileEnv];
    delete process.env[squadrailHomeEnv];
    delete process.env[issuerEnv];
    delete process.env[audienceEnv];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEnv.secret === undefined) delete process.env[secretEnv];
    else process.env[secretEnv] = originalEnv.secret;
    if (originalEnv.ttl === undefined) delete process.env[ttlEnv];
    else process.env[ttlEnv] = originalEnv.ttl;
    if (originalEnv.squadrailSecret === undefined) delete process.env[squadrailSecretEnv];
    else process.env[squadrailSecretEnv] = originalEnv.squadrailSecret;
    if (originalEnv.squadrailTtl === undefined) delete process.env[squadrailTtlEnv];
    else process.env[squadrailTtlEnv] = originalEnv.squadrailTtl;
    if (originalEnv.squadrailMasterKeyFile === undefined) delete process.env[squadrailMasterKeyFileEnv];
    else process.env[squadrailMasterKeyFileEnv] = originalEnv.squadrailMasterKeyFile;
    if (originalEnv.squadrailHome === undefined) delete process.env[squadrailHomeEnv];
    else process.env[squadrailHomeEnv] = originalEnv.squadrailHome;
    if (originalEnv.issuer === undefined) delete process.env[issuerEnv];
    else process.env[issuerEnv] = originalEnv.issuer;
    if (originalEnv.audience === undefined) delete process.env[audienceEnv];
    else process.env[audienceEnv] = originalEnv.audience;
  });

  it("creates and verifies a token", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    expect(typeof token).toBe("string");

    const claims = verifyLocalAgentJwt(token!);
    expect(claims).toMatchObject({
      sub: "agent-1",
      company_id: "company-1",
      adapter_type: "claude_local",
      run_id: "run-1",
      iss: "squadrail",
      aud: "squadrail-api",
    });
  });

  it("returns null when secret is missing", () => {
    process.env[secretEnv] = "";
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    expect(token).toBeNull();
    expect(verifyLocalAgentJwt("abc.def.ghi")).toBeNull();
  });

  it("rejects expired tokens", () => {
    process.env[ttlEnv] = "1";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");

    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
    expect(verifyLocalAgentJwt(token!)).toBeNull();
  });

  it("rejects issuer/audience mismatch", () => {
    process.env[issuerEnv] = "custom-issuer";
    process.env[audienceEnv] = "custom-audience";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "codex_local", "run-1");

    process.env[issuerEnv] = "squadrail";
    process.env[audienceEnv] = "squadrail-api";
    expect(verifyLocalAgentJwt(token!)).toBeNull();
  });

  it("accepts Squadrail JWT aliases", () => {
    delete process.env[secretEnv];
    delete process.env[ttlEnv];
    process.env[squadrailSecretEnv] = "alias-secret";
    process.env[squadrailTtlEnv] = "7200";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const token = createLocalAgentJwt("agent-1", "company-1", "codex_local", "run-1");
    const claims = verifyLocalAgentJwt(token!);

    expect(claims?.sub).toBe("agent-1");
    expect(claims?.adapter_type).toBe("codex_local");
  });

  it("falls back to the secrets master key file when no explicit jwt secret exists", () => {
    delete process.env[secretEnv];
    delete process.env[ttlEnv];
    delete process.env[squadrailSecretEnv];
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "squadrail-jwt-master-key-"));
    const masterKeyPath = path.join(tempRoot, "master.key");
    fs.writeFileSync(masterKeyPath, "master-key-secret\n", "utf8");
    process.env[squadrailMasterKeyFileEnv] = masterKeyPath;
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const token = createLocalAgentJwt("agent-1", "company-1", "codex_local", "run-1");
    const claims = verifyLocalAgentJwt(token!);

    expect(claims?.sub).toBe("agent-1");
    expect(claims?.company_id).toBe("company-1");

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("creates and reuses a fallback secret file inside SQUADRAIL_HOME", () => {
    delete process.env[secretEnv];
    delete process.env[ttlEnv];
    delete process.env[squadrailSecretEnv];
    delete process.env[squadrailMasterKeyFileEnv];
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "squadrail-jwt-home-"));
    process.env[squadrailHomeEnv] = tempRoot;
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const token = createLocalAgentJwt("agent-1", "company-1", "codex_local", "run-1");
    const claims = verifyLocalAgentJwt(token!);
    const secretPath = path.join(tempRoot, "agent-jwt.secret");

    expect(claims?.sub).toBe("agent-1");
    expect(fs.existsSync(secretPath)).toBe(true);
    expect(fs.readFileSync(secretPath, "utf8").trim().length).toBeGreaterThan(0);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
