import { Readable } from "node:stream";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

const {
  mockCreateAsset,
  mockGetAssetById,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockCreateAsset: vi.fn(),
  mockGetAssetById: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  assetService: () => ({
    create: mockCreateAsset,
    getById: mockGetAssetById,
  }),
  logActivity: mockLogActivity,
}));

import { assetRoutes } from "../routes/assets.js";

function createStorage() {
  return {
    putFile: vi.fn(),
    getObject: vi.fn(),
  };
}

function createApp(storage: ReturnType<typeof createStorage>) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
      userId: "user-1",
      companyIds: [COMPANY_ID],
      runId: null,
    };
    next();
  });
  app.use(assetRoutes({} as never, storage as never));
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Unhandled error" });
  });
  return app;
}

describe("asset routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads images, stores the blob, and persists the asset metadata", async () => {
    const storage = createStorage();
    storage.putFile.mockResolvedValue({
      provider: "s3",
      objectKey: "assets/general/capture.png",
      contentType: "image/png",
      byteSize: 7,
      sha256: "hash",
      originalFilename: "capture.png",
    });
    mockCreateAsset.mockResolvedValue({
      id: "asset-1",
      companyId: COMPANY_ID,
      provider: "s3",
      objectKey: "assets/general/capture.png",
      contentType: "image/png",
      byteSize: 7,
      sha256: "hash",
      originalFilename: "capture.png",
      createdByAgentId: null,
      createdByUserId: "user-1",
      createdAt: new Date("2026-03-13T10:00:00.000Z"),
      updatedAt: new Date("2026-03-13T10:00:00.000Z"),
    });
    const app = createApp(storage);

    const response = await request(app)
      .post(`/companies/${COMPANY_ID}/assets/images`)
      .field("namespace", "general")
      .attach("file", Buffer.from("pngdata"), {
        filename: "capture.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      assetId: "asset-1",
      contentType: "image/png",
      contentPath: "/api/assets/asset-1/content",
    });
    expect(storage.putFile).toHaveBeenCalledWith(expect.objectContaining({
      companyId: COMPANY_ID,
      namespace: "assets/general",
      contentType: "image/png",
    }));
    expect(mockCreateAsset).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({
        provider: "s3",
        objectKey: "assets/general/capture.png",
        sha256: "hash",
      }),
    );
  });

  it("rejects unsupported image content types before storage writes", async () => {
    const storage = createStorage();
    const app = createApp(storage);

    const response = await request(app)
      .post(`/companies/${COMPANY_ID}/assets/images`)
      .attach("file", Buffer.from("hello"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: "Unsupported image type: text/plain",
    });
    expect(storage.putFile).not.toHaveBeenCalled();
    expect(mockCreateAsset).not.toHaveBeenCalled();
  });

  it("streams stored asset content back through the download route", async () => {
    const storage = createStorage();
    mockGetAssetById.mockResolvedValue({
      id: "asset-2",
      companyId: COMPANY_ID,
      contentType: "image/png",
      byteSize: 7,
      objectKey: "assets/general/capture.png",
      originalFilename: "capture.png",
    });
    storage.getObject.mockResolvedValue({
      contentType: "image/png",
      contentLength: 7,
      stream: Readable.from([Buffer.from("pngdata")]),
    });
    const app = createApp(storage);

    const response = await request(app).get("/assets/asset-2/content");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["content-disposition"]).toContain("capture.png");
    expect(storage.getObject).toHaveBeenCalledWith(COMPANY_ID, "assets/general/capture.png");
  });
});
