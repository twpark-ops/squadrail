import { describe, expect, it } from "vitest";
import { assets } from "@squadrail/db";
import { assetService } from "../services/assets.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createAssetDbMock(input: {
  selectResults?: unknown[][];
  insertResults?: unknown[][];
}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const insertQueue = [...(input.insertResults ?? [])];
  const insertValues: Array<{ table: unknown; value: unknown }> = [];

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
  };

  return { db, insertValues };
}

describe("asset service", () => {
  it("creates and reads company-scoped assets", async () => {
    const created = {
      id: "asset-1",
      companyId: "company-1",
      objectKey: "company-1/files/test.txt",
      contentType: "text/plain",
    };
    const { db, insertValues } = createAssetDbMock({
      insertResults: [[created]],
      selectResults: [[created]],
    });
    const service = assetService(db as never);

    const row = await service.create("company-1", {
      objectKey: "company-1/files/test.txt",
      provider: "local_disk",
      contentType: "text/plain",
      byteSize: 12,
      sha256: "abc",
      originalFilename: "test.txt",
    } as never);
    const lookedUp = await service.getById("asset-1");

    expect(row).toEqual(created);
    expect(lookedUp).toEqual(created);
    expect(insertValues).toEqual([
      {
        table: assets,
        value: expect.objectContaining({
          companyId: "company-1",
          objectKey: "company-1/files/test.txt",
        }),
      },
    ]);
  });
});
