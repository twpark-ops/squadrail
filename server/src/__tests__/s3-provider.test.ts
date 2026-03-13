import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sentCommands, mockSend, mockS3Client } = vi.hoisted(() => {
  const sentCommands: Array<{ type: string; input: Record<string, unknown> }> = [];
  const mockSend = vi.fn();
  const mockS3Client = vi.fn().mockImplementation((config: unknown) => ({
    config,
    send: mockSend,
  }));
  return {
    sentCommands,
    mockSend,
    mockS3Client,
  };
});

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
      sentCommands.push({
        type: this.constructor.name,
        input,
      });
    }
  }

  return {
    S3Client: mockS3Client,
    PutObjectCommand: class PutObjectCommand extends Command {},
    GetObjectCommand: class GetObjectCommand extends Command {},
    HeadObjectCommand: class HeadObjectCommand extends Command {},
    DeleteObjectCommand: class DeleteObjectCommand extends Command {},
  };
});

import { createS3StorageProvider } from "../storage/s3-provider.js";

async function readStream(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

describe("s3 storage provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sentCommands.length = 0;
  });

  it("requires non-empty bucket and region", () => {
    expect(() => createS3StorageProvider({ bucket: "", region: "ap-northeast-2" })).toThrow(
      "S3 storage bucket is required",
    );
    expect(() => createS3StorageProvider({ bucket: "bucket", region: "" })).toThrow(
      "S3 storage region is required",
    );
  });

  it("puts objects with normalized prefixes", async () => {
    mockSend.mockResolvedValue({});
    const provider = createS3StorageProvider({
      bucket: "artifacts",
      region: "ap-northeast-2",
      prefix: "/teams/runtime/",
      endpoint: "http://minio.local",
      forcePathStyle: true,
    });

    await provider.putObject({
      objectKey: "issues/issue-1/log.txt",
      body: Buffer.from("hello", "utf8"),
      contentType: "text/plain",
      contentLength: 5,
    });

    expect(mockS3Client).toHaveBeenCalledWith(expect.objectContaining({
      region: "ap-northeast-2",
      endpoint: "http://minio.local",
      forcePathStyle: true,
    }));
    expect(sentCommands[0]).toEqual({
      type: "PutObjectCommand",
      input: {
        Bucket: "artifacts",
        Key: "teams/runtime/issues/issue-1/log.txt",
        Body: Buffer.from("hello", "utf8"),
        ContentType: "text/plain",
        ContentLength: 5,
      },
    });
  });

  it("reads objects from readable streams, web streams, and array buffers", async () => {
    const provider = createS3StorageProvider({
      bucket: "artifacts",
      region: "ap-northeast-2",
    });

    mockSend
      .mockResolvedValueOnce({
        Body: Readable.from("alpha"),
        ContentType: "text/plain",
        ContentLength: 5,
        ETag: "etag-1",
        LastModified: new Date("2026-03-13T00:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        Body: {
          transformToWebStream() {
            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("beta"));
                controller.close();
              },
            });
          },
        },
      })
      .mockResolvedValueOnce({
        Body: {
          async arrayBuffer() {
            return new TextEncoder().encode("gamma").buffer;
          },
        },
      });

    const direct = await provider.getObject({ objectKey: "one.txt" });
    const web = await provider.getObject({ objectKey: "two.txt" });
    const buffered = await provider.getObject({ objectKey: "three.txt" });

    expect(await readStream(direct.stream)).toBe("alpha");
    expect(await readStream(web.stream)).toBe("beta");
    expect(await readStream(buffered.stream)).toBe("gamma");
    expect(direct).toMatchObject({
      contentType: "text/plain",
      contentLength: 5,
      etag: "etag-1",
      lastModified: new Date("2026-03-13T00:00:00.000Z"),
    });
  });

  it("maps not found conditions for get and head", async () => {
    const provider = createS3StorageProvider({
      bucket: "artifacts",
      region: "ap-northeast-2",
      prefix: "runtime",
    });

    mockSend
      .mockRejectedValueOnce({ name: "NoSuchKey" })
      .mockRejectedValueOnce({ name: "NotFound" });

    await expect(provider.getObject({ objectKey: "missing.txt" })).rejects.toMatchObject({ status: 404 });
    await expect(provider.headObject({ objectKey: "missing.txt" })).resolves.toEqual({ exists: false });
  });

  it("heads and deletes objects using prefixed keys", async () => {
    mockSend
      .mockResolvedValueOnce({
        ContentType: "application/json",
        ContentLength: 12,
        ETag: "etag-2",
        LastModified: new Date("2026-03-13T00:00:00.000Z"),
      })
      .mockResolvedValueOnce({});
    const provider = createS3StorageProvider({
      bucket: "artifacts",
      region: "ap-northeast-2",
      prefix: "runtime",
    });

    const head = await provider.headObject({ objectKey: "state.json" });
    await provider.deleteObject({ objectKey: "state.json" });

    expect(head).toEqual({
      exists: true,
      contentType: "application/json",
      contentLength: 12,
      etag: "etag-2",
      lastModified: new Date("2026-03-13T00:00:00.000Z"),
    });
    expect(sentCommands.at(-1)).toEqual({
      type: "DeleteObjectCommand",
      input: {
        Bucket: "artifacts",
        Key: "runtime/state.json",
      },
    });
  });
});
