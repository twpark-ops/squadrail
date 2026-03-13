import { describe, expect, it, vi } from "vitest";

const {
  mockCreateLocalDiskStorageProvider,
  mockCreateS3StorageProvider,
} = vi.hoisted(() => ({
  mockCreateLocalDiskStorageProvider: vi.fn(),
  mockCreateS3StorageProvider: vi.fn(),
}));

vi.mock("../storage/local-disk-provider.js", () => ({
  createLocalDiskStorageProvider: mockCreateLocalDiskStorageProvider,
}));

vi.mock("../storage/s3-provider.js", () => ({
  createS3StorageProvider: mockCreateS3StorageProvider,
}));

import { createStorageProviderFromConfig } from "../storage/provider-registry.js";

describe("storage provider registry", () => {
  it("creates the local disk provider when configured", () => {
    mockCreateLocalDiskStorageProvider.mockReturnValue({ id: "local" });

    const provider = createStorageProviderFromConfig({
      storageProvider: "local_disk",
      storageLocalDiskBaseDir: "/tmp/storage",
    } as never);

    expect(provider).toEqual({ id: "local" });
    expect(mockCreateLocalDiskStorageProvider).toHaveBeenCalledWith("/tmp/storage");
    expect(mockCreateS3StorageProvider).not.toHaveBeenCalled();
  });

  it("creates the s3 provider with normalized config otherwise", () => {
    mockCreateS3StorageProvider.mockReturnValue({ id: "s3" });

    const provider = createStorageProviderFromConfig({
      storageProvider: "s3",
      storageS3Bucket: "bucket-1",
      storageS3Region: "ap-northeast-2",
      storageS3Endpoint: "https://s3.example.com",
      storageS3Prefix: "artifacts/",
      storageS3ForcePathStyle: true,
    } as never);

    expect(provider).toEqual({ id: "s3" });
    expect(mockCreateS3StorageProvider).toHaveBeenCalledWith({
      bucket: "bucket-1",
      region: "ap-northeast-2",
      endpoint: "https://s3.example.com",
      prefix: "artifacts/",
      forcePathStyle: true,
    });
  });
});
