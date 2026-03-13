import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { localEncryptedProvider } from "../secrets/local-encrypted-provider.js";

const ORIGINAL_ENV = {
  SQUADRAIL_SECRETS_MASTER_KEY: process.env.SQUADRAIL_SECRETS_MASTER_KEY,
  SQUADRAIL_SECRETS_MASTER_KEY_FILE: process.env.SQUADRAIL_SECRETS_MASTER_KEY_FILE,
};

function restoreEnv() {
  if (ORIGINAL_ENV.SQUADRAIL_SECRETS_MASTER_KEY === undefined) {
    delete process.env.SQUADRAIL_SECRETS_MASTER_KEY;
  } else {
    process.env.SQUADRAIL_SECRETS_MASTER_KEY = ORIGINAL_ENV.SQUADRAIL_SECRETS_MASTER_KEY;
  }

  if (ORIGINAL_ENV.SQUADRAIL_SECRETS_MASTER_KEY_FILE === undefined) {
    delete process.env.SQUADRAIL_SECRETS_MASTER_KEY_FILE;
  } else {
    process.env.SQUADRAIL_SECRETS_MASTER_KEY_FILE = ORIGINAL_ENV.SQUADRAIL_SECRETS_MASTER_KEY_FILE;
  }
}

describe("local encrypted secret provider", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("creates and resolves encrypted versions with an env master key", async () => {
    process.env.SQUADRAIL_SECRETS_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

    const created = await localEncryptedProvider.createVersion({
      value: "super-secret-token",
    } as never);
    const resolved = await localEncryptedProvider.resolveVersion({
      material: created.material,
    } as never);

    expect(created.externalRef).toBeNull();
    expect(created.valueSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(created.material).toMatchObject({
      scheme: "local_encrypted_v1",
      iv: expect.any(String),
      tag: expect.any(String),
      ciphertext: expect.any(String),
    });
    expect(resolved).toBe("super-secret-token");
  });

  it("loads the master key from disk and creates the file when missing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "squadrail-secret-provider-"));
    const keyPath = path.join(dir, "master.key");
    process.env.SQUADRAIL_SECRETS_MASTER_KEY = "";
    process.env.SQUADRAIL_SECRETS_MASTER_KEY_FILE = keyPath;

    const created = await localEncryptedProvider.createVersion({
      value: "disk-backed-secret",
    } as never);
    const resolved = await localEncryptedProvider.resolveVersion({
      material: created.material,
    } as never);

    expect(readFileSync(keyPath, "utf8").trim().length).toBeGreaterThan(0);
    expect(resolved).toBe("disk-backed-secret");

    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts hex and raw master key formats and rejects invalid material", async () => {
    process.env.SQUADRAIL_SECRETS_MASTER_KEY = "a".repeat(64);
    const created = await localEncryptedProvider.createVersion({
      value: "hex-secret",
    } as never);

    process.env.SQUADRAIL_SECRETS_MASTER_KEY = "b".repeat(32);
    await expect(localEncryptedProvider.resolveVersion({
      material: created.material,
    } as never)).rejects.toThrow();

    process.env.SQUADRAIL_SECRETS_MASTER_KEY = "c".repeat(32);
    await expect(localEncryptedProvider.resolveVersion({
      material: {
        scheme: "wrong",
      },
    } as never)).rejects.toThrow("Invalid local_encrypted secret material");
  });

  it("rejects invalid env and file master key contents", async () => {
    process.env.SQUADRAIL_SECRETS_MASTER_KEY = "short-key";
    await expect(localEncryptedProvider.createVersion({
      value: "bad-env",
    } as never)).rejects.toThrow("Invalid SQUADRAIL_SECRETS_MASTER_KEY");

    const dir = mkdtempSync(path.join(tmpdir(), "squadrail-secret-provider-invalid-"));
    const keyPath = path.join(dir, "master.key");
    writeFileSync(keyPath, "still-invalid", "utf8");
    delete process.env.SQUADRAIL_SECRETS_MASTER_KEY;
    process.env.SQUADRAIL_SECRETS_MASTER_KEY_FILE = keyPath;

    await expect(localEncryptedProvider.createVersion({
      value: "bad-file",
    } as never)).rejects.toThrow(`Invalid secrets master key at ${keyPath}`);

    rmSync(dir, { recursive: true, force: true });
  });
});
