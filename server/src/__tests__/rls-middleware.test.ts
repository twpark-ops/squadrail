import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRunWithDbContext, mockRunWithoutDbContext, mockLoggerError } = vi.hoisted(() => ({
  mockRunWithDbContext: vi.fn(),
  mockRunWithoutDbContext: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("@squadrail/db", () => ({
  runWithDbContext: mockRunWithDbContext,
  runWithoutDbContext: mockRunWithoutDbContext,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    error: mockLoggerError,
  },
}));

import { rlsRequestContextMiddleware } from "../middleware/rls.js";

class MockResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
}

async function flushAsyncWork() {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

function createDb() {
  const execute = vi.fn().mockResolvedValue(undefined);
  const tx = { execute };
  const db = {
    transaction: vi.fn(async (callback: (tx: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return { db, execute };
}

describe("rls request context middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunWithDbContext.mockImplementation(async (_db: unknown, callback: () => Promise<unknown>, opts?: { afterCommitCallbacks?: Array<() => void | Promise<void>> }) => {
      opts?.afterCommitCallbacks?.push(() => Promise.resolve());
      return callback();
    });
    mockRunWithoutDbContext.mockImplementation(async (callback: () => Promise<unknown>) => callback());
  });

  it("becomes a pass-through when disabled", () => {
    const { db } = createDb();
    const middleware = rlsRequestContextMiddleware(db as never, { enabled: false });
    const next = vi.fn();

    middleware({} as never, {} as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("wraps successful requests in db context and runs after-commit callbacks", async () => {
    const { db, execute } = createDb();
    const middleware = rlsRequestContextMiddleware(db as never, { enabled: true });
    const req = {
      actor: {
        type: "board",
        source: "local_implicit",
        isInstanceAdmin: true,
        userId: "user-1",
        companyIds: ["company-1", "company-2"],
      },
    } as never;
    const res = new MockResponse();
    const next = vi.fn(() => {
      res.statusCode = 200;
      queueMicrotask(() => res.emit("finish"));
    });

    middleware(req, res as never, next);
    await flushAsyncWork();
    await flushAsyncWork();

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(mockRunWithDbContext).toHaveBeenCalledTimes(1);
    expect(mockRunWithoutDbContext).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("swallows expected rollback when the response finishes with an error status", async () => {
    const { db } = createDb();
    const middleware = rlsRequestContextMiddleware(db as never, { enabled: true });
    const res = new MockResponse();
    const next = vi.fn((error?: unknown) => {
      if (error) {
        throw error;
      }
      res.statusCode = 500;
      queueMicrotask(() => res.emit("finish"));
    });

    middleware({
      actor: {
        type: "agent",
        companyId: "company-1",
        agentId: "agent-1",
      },
    } as never, res as never, next);
    await Promise.resolve();
    await Promise.resolve();

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockRunWithoutDbContext).not.toHaveBeenCalled();
  });

  it("logs but tolerates after-commit callback failures", async () => {
    const { db } = createDb();
    mockRunWithDbContext.mockImplementationOnce(async (_db: unknown, callback: () => Promise<unknown>, opts?: { afterCommitCallbacks?: Array<() => void | Promise<void>> }) => {
      opts?.afterCommitCallbacks?.push(() => {
        throw new Error("after-commit failed");
      });
      return callback();
    });

    const middleware = rlsRequestContextMiddleware(db as never, { enabled: true });
    const res = new MockResponse();
    const next = vi.fn(() => {
      queueMicrotask(() => res.emit("finish"));
    });

    middleware({
      actor: {
        type: "board",
        source: "session",
        isInstanceAdmin: false,
        userId: "user-1",
        companyIds: ["company-1"],
      },
    } as never, res as never, next);
    await flushAsyncWork();
    await flushAsyncWork();

    expect(mockRunWithoutDbContext).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "after-commit callback failed",
    );
  });
});
