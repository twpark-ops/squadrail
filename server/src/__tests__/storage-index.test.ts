import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLoadConfig,
  mockCreateStorageProviderFromConfig,
  mockCreateStorageService,
} = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockCreateStorageProviderFromConfig: vi.fn(),
  mockCreateStorageService: vi.fn(),
}));

vi.mock("../config.js", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("../storage/provider-registry.js", () => ({
  createStorageProviderFromConfig: mockCreateStorageProviderFromConfig,
}));

vi.mock("../storage/service.js", () => ({
  createStorageService: mockCreateStorageService,
}));

describe("storage index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("creates a storage service from provider registry output", async () => {
    mockCreateStorageProviderFromConfig.mockReturnValue({ id: "local_disk" });
    mockCreateStorageService.mockReturnValue({ provider: "local_disk" });

    const mod = await import("../storage/index.js");
    const result = mod.createStorageServiceFromConfig({
      storageProvider: "local_disk",
      storageLocalDiskBaseDir: "/tmp/storage",
      storageS3Bucket: "bucket",
      storageS3Region: "ap-northeast-2",
      storageS3Endpoint: null,
      storageS3Prefix: null,
      storageS3ForcePathStyle: false,
    } as never);

    expect(result).toEqual({ provider: "local_disk" });
    expect(mockCreateStorageProviderFromConfig).toHaveBeenCalledTimes(1);
    expect(mockCreateStorageService).toHaveBeenCalledWith({ id: "local_disk" });
  });

  it("caches the storage service until the effective config signature changes", async () => {
    mockLoadConfig
      .mockReturnValueOnce({
        storageProvider: "local_disk",
        storageLocalDiskBaseDir: "/tmp/storage-a",
        storageS3Bucket: "bucket-a",
        storageS3Region: "ap-northeast-2",
        storageS3Endpoint: null,
        storageS3Prefix: null,
        storageS3ForcePathStyle: false,
      })
      .mockReturnValueOnce({
        storageProvider: "local_disk",
        storageLocalDiskBaseDir: "/tmp/storage-a",
        storageS3Bucket: "bucket-a",
        storageS3Region: "ap-northeast-2",
        storageS3Endpoint: null,
        storageS3Prefix: null,
        storageS3ForcePathStyle: false,
      })
      .mockReturnValueOnce({
        storageProvider: "s3",
        storageLocalDiskBaseDir: "/tmp/storage-a",
        storageS3Bucket: "bucket-b",
        storageS3Region: "ap-northeast-2",
        storageS3Endpoint: "https://s3.example.com",
        storageS3Prefix: "files",
        storageS3ForcePathStyle: true,
      });
    mockCreateStorageProviderFromConfig
      .mockReturnValueOnce({ id: "local_disk" })
      .mockReturnValueOnce({ id: "s3" });
    mockCreateStorageService
      .mockReturnValueOnce({ provider: "local_disk", id: "svc-a" })
      .mockReturnValueOnce({ provider: "s3", id: "svc-b" });

    const mod = await import("../storage/index.js");
    const first = mod.getStorageService();
    const second = mod.getStorageService();
    const third = mod.getStorageService();

    expect(first).toBe(second);
    expect(third).toEqual({ provider: "s3", id: "svc-b" });
    expect(mockCreateStorageService).toHaveBeenCalledTimes(2);
  });
});
