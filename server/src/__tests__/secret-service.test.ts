import { companySecrets, companySecretVersions } from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSecretProvider,
  mockListSecretProviders,
} = vi.hoisted(() => ({
  mockGetSecretProvider: vi.fn(),
  mockListSecretProviders: vi.fn(),
}));

vi.mock("../secrets/provider-registry.js", () => ({
  getSecretProvider: mockGetSecretProvider,
  listSecretProviders: mockListSecretProviders,
}));

import { secretService } from "../services/secrets.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createSecretDbMock(input: {
  selectResults?: unknown[][];
  insertResults?: unknown[][];
  updateResults?: unknown[][];
  deleteResults?: unknown[][];
}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const insertQueue = [...(input.insertResults ?? [])];
  const updateQueue = [...(input.updateResults ?? [])];
  const deleteQueue = [...(input.deleteResults ?? [])];
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];
  const deletedTables: unknown[] = [];

  const db = {
    select: () => createResolvedChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        return {
          returning: async () => insertQueue.shift() ?? [],
        };
      },
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateSets.push({ table, value });
        return {
          where: () => ({
            returning: async () => updateQueue.shift() ?? [],
          }),
        };
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        deletedTables.push(table);
        return {
          returning: async () => deleteQueue.shift() ?? [],
        };
      },
    }),
    transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
  };

  return { db, insertValues, updateSets, deletedTables };
}

describe("secret service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSecretProviders.mockReturnValue([
      { provider: "local_encrypted", label: "Local encrypted" },
    ]);
    mockGetSecretProvider.mockReturnValue({
      createVersion: vi.fn(async ({ value, externalRef }) => ({
        material: { ciphertext: `enc:${value}` },
        valueSha256: `sha:${value}`,
        externalRef,
      })),
      resolveVersion: vi.fn(({ material }) => String((material as Record<string, string>).ciphertext).replace(/^enc:/, "")),
    });
  });

  it("normalizes persistence payloads and rejects plain sensitive values in strict mode", async () => {
    const secretId = "00000000-0000-0000-0000-000000000001";
    const secret = {
      id: secretId,
      companyId: "company-1",
      name: "OPENAI_API_KEY",
      provider: "local_encrypted",
      latestVersion: 1,
      externalRef: null,
    };
    const { db } = createSecretDbMock({
      selectResults: [[secret]],
    });
    const service = secretService(db as never);

    await expect(service.normalizeAdapterConfigForPersistence("company-1", {
      env: {
        OPENAI_API_KEY: { type: "plain", value: "secret" },
      },
    }, { strictMode: true })).rejects.toThrow("Strict secret mode requires secret references");

    await expect(service.normalizeHireApprovalPayloadForPersistence("company-1", {
      adapterConfig: {
        env: {
          OPENAI_API_KEY: { type: "secret_ref", secretId, version: "latest" },
        },
      },
    })).resolves.toMatchObject({
      adapterConfig: {
        env: {
          OPENAI_API_KEY: {
            type: "secret_ref",
            secretId,
            version: "latest",
          },
        },
      },
    });
  });

  it("creates and rotates secret versions through the provider", async () => {
    const createdSecret = {
      id: "secret-1",
      companyId: "company-1",
      name: "OPENAI_API_KEY",
      provider: "local_encrypted",
      latestVersion: 1,
      externalRef: null,
      description: null,
    };
    const updatedSecret = {
      ...createdSecret,
      latestVersion: 2,
      updatedAt: new Date("2026-03-13T10:00:00.000Z"),
    };
    const { db, insertValues, updateSets } = createSecretDbMock({
      selectResults: [
        [],
        [createdSecret],
      ],
      insertResults: [[createdSecret], []],
      updateResults: [[updatedSecret]],
    });
    const service = secretService(db as never);

    const created = await service.create("company-1", {
      name: "OPENAI_API_KEY",
      provider: "local_encrypted",
      value: "secret-1",
    }, { userId: "board-1" });
    const rotated = await service.rotate("secret-1", { value: "secret-2" }, { userId: "board-1" });

    expect(created).toEqual(createdSecret);
    expect(insertValues.find((entry) => entry.table === companySecrets)?.value).toMatchObject({
      companyId: "company-1",
      name: "OPENAI_API_KEY",
      latestVersion: 1,
    });
    expect(insertValues.find((entry) => entry.table === companySecretVersions)?.value).toMatchObject({
      secretId: "secret-1",
      version: 1,
    });
    expect(rotated).toEqual(updatedSecret);
    expect(updateSets.find((entry) => entry.table === companySecrets)?.value).toMatchObject({
      latestVersion: 2,
      updatedAt: expect.any(Date),
    });
  });

  it("updates metadata, resolves env bindings, and deletes secrets", async () => {
    const secretId = "00000000-0000-0000-0000-000000000001";
    const secret = {
      id: secretId,
      companyId: "company-1",
      name: "OPENAI_API_KEY",
      provider: "local_encrypted",
      latestVersion: 2,
      externalRef: null,
      description: null,
    };
    const version = {
      secretId,
      version: 2,
      material: { ciphertext: "enc:resolved" },
    };
    const updated = {
      ...secret,
      description: "primary credential",
    };
    const { db, updateSets, deletedTables } = createSecretDbMock({
      selectResults: [
        [secret],
        [secret],
        [version],
        [secret],
      ],
      updateResults: [[updated]],
    });
    const service = secretService(db as never);

    const row = await service.update("secret-1", { description: "primary credential" });
    const resolved = await service.resolveEnvBindings("company-1", {
      OPENAI_API_KEY: { type: "secret_ref", secretId, version: 2 },
      LOG_LEVEL: { type: "plain", value: "debug" },
    });
    const removed = await service.remove("secret-1");

    expect(row).toEqual(updated);
    expect(updateSets.find((entry) => entry.table === companySecrets)?.value).toMatchObject({
      description: "primary credential",
      updatedAt: expect.any(Date),
    });
    expect(resolved).toEqual({
      OPENAI_API_KEY: "resolved",
      LOG_LEVEL: "debug",
    });
    expect(deletedTables).toContain(companySecrets);
    expect(removed).toEqual(secret);
  });
});
