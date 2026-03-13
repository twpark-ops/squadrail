import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

const {
  mockSubscribeCompanyLiveEvents,
  mockLoggerWarn,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockSubscribeCompanyLiveEvents: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("../services/live-events.js", () => ({
  subscribeCompanyLiveEvents: mockSubscribeCompanyLiveEvents,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    warn: mockLoggerWarn,
    error: mockLoggerError,
  },
}));

import {
  authorizeUpgrade,
  hashToken,
  headersFromIncomingMessage,
  parseBearerToken,
  parseCompanyId,
  rejectUpgrade,
  setupLiveEventsWebSocketServer,
} from "../realtime/live-events-ws.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createLiveEventsDbMock(input: {
  selectResults?: unknown[][];
} = {}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const updateSets: unknown[] = [];

  const db = {
    select: () => createResolvedChain(selectQueue.shift() ?? []),
    update: () => ({
      set: (value: unknown) => {
        updateSets.push(value);
        return {
          where: async () => [],
        };
      },
    }),
  };

  return {
    db,
    updateSets,
  };
}

function createIncomingMessage(input?: {
  url?: string;
  headers?: Record<string, string>;
}) {
  return {
    url: input?.url ?? "/api/companies/company-1/events/ws",
    headers: input?.headers ?? {},
  } as any;
}

describe("live events websocket helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribeCompanyLiveEvents.mockReturnValue(() => {});
  });

  it("parses websocket company ids and bearer tokens", () => {
    expect(parseCompanyId("/api/companies/company-1/events/ws")).toBe("company-1");
    expect(parseCompanyId("/api/companies/company%202/events/ws")).toBe("company 2");
    expect(parseCompanyId("/api/companies/company-1/events")).toBeNull();
    expect(parseBearerToken("Bearer test-token")).toBe("test-token");
    expect(parseBearerToken(["Bearer array-token"])).toBe("array-token");
    expect(parseBearerToken("Basic nope")).toBeNull();
  });

  it("normalizes headers from incoming messages", () => {
    const headers = headersFromIncomingMessage(createIncomingMessage({
      headers: {
        authorization: "Bearer token-1",
        "x-company": "company-1",
      },
    }));

    expect(headers.get("authorization")).toBe("Bearer token-1");
    expect(headers.get("x-company")).toBe("company-1");
  });

  it("rejects upgrades with sanitized messages", () => {
    const writes: string[] = [];
    const socket = {
      write: (value: string) => writes.push(value),
      destroy: vi.fn(),
    } as any;

    rejectUpgrade(socket, "403 Forbidden", "forbidden\r\nextra");

    expect(writes[0]).toContain("HTTP/1.1 403 Forbidden");
    expect(writes[0]).toContain("forbidden extra");
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it("authorizes authenticated board sessions through membership lookup", async () => {
    const { db } = createLiveEventsDbMock({
      selectResults: [
        [],
        [{ companyId: "company-1" }],
      ],
    });

    const context = await authorizeUpgrade(
      db as never,
      createIncomingMessage(),
      "company-1",
      new URL("http://localhost/api/companies/company-1/events/ws"),
      {
        deploymentMode: "authenticated",
        resolveSessionFromHeaders: async () => ({
          session: { id: "session-1", userId: "user-1" },
          user: { id: "user-1", email: "board@example.com" },
        }),
      },
    );

    expect(context).toEqual({
      companyId: "company-1",
      actorType: "board",
      actorId: "user-1",
    });
  });

  it("authorizes agent websocket upgrades with bearer tokens and updates lastUsedAt", async () => {
    const token = "agent-secret";
    const { db, updateSets } = createLiveEventsDbMock({
      selectResults: [[{
        id: "key-1",
        companyId: "company-1",
        agentId: "agent-1",
      }]],
    });

    const context = await authorizeUpgrade(
      db as never,
      createIncomingMessage({
        headers: {
          authorization: `Bearer ${token}`,
        },
      }),
      "company-1",
      new URL("http://localhost/api/companies/company-1/events/ws"),
      {
        deploymentMode: "authenticated",
      },
    );

    expect(hashToken(token)).toHaveLength(64);
    expect(context).toEqual({
      companyId: "company-1",
      actorType: "agent",
      actorId: "agent-1",
    });
    expect(updateSets[0]).toMatchObject({
      lastUsedAt: expect.any(Date),
    });
  });

  it("returns null when authenticated upgrades have no valid session or key", async () => {
    const { db } = createLiveEventsDbMock({
      selectResults: [[]],
    });

    await expect(authorizeUpgrade(
      db as never,
      createIncomingMessage(),
      "company-1",
      new URL("http://localhost/api/companies/company-1/events/ws"),
      {
        deploymentMode: "authenticated",
        resolveSessionFromHeaders: async () => ({
          session: null,
          user: null,
        }),
      },
    )).resolves.toBeNull();

    await expect(authorizeUpgrade(
      db as never,
      createIncomingMessage({
        headers: {
          authorization: "Bearer invalid",
        },
      }),
      "company-1",
      new URL("http://localhost/api/companies/company-1/events/ws"),
      {
        deploymentMode: "authenticated",
      },
    )).resolves.toBeNull();
  });
});

describe("setupLiveEventsWebSocketServer", () => {
  let server: ReturnType<typeof createServer>;
  let wsServer: ReturnType<typeof setupLiveEventsWebSocketServer> | null = null;

  afterEach(async () => {
    if (wsServer) {
      await new Promise<void>((resolve) => wsServer?.close(() => resolve()));
      wsServer = null;
    }
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("upgrades local_trusted clients and forwards subscribed live events", async () => {
    const unsubscribe = vi.fn();
    let subscribedCallback: ((event: unknown) => void) | null = null;
    mockSubscribeCompanyLiveEvents.mockImplementation((_companyId: string, callback: (event: unknown) => void) => {
      subscribedCallback = callback;
      return unsubscribe;
    });

    server = createServer((_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    });
    const { db } = createLiveEventsDbMock();
    wsServer = setupLiveEventsWebSocketServer(server, db as never, {
      deploymentMode: "local_trusted",
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected tcp address");
    }

    const received = new Promise<unknown>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${address.port}/api/companies/company-1/events/ws`);
      client.on("open", () => {
        subscribedCallback?.({
          companyId: "company-1",
          type: "heartbeat.run.queued",
          payload: {
            runId: "run-1",
          },
        });
      });
      client.on("message", (buffer) => {
        const payload = JSON.parse(buffer.toString());
        client.close();
        resolve(payload);
      });
      client.on("error", reject);
    });

    await expect(received).resolves.toEqual({
      companyId: "company-1",
      type: "heartbeat.run.queued",
      payload: {
        runId: "run-1",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(mockSubscribeCompanyLiveEvents).toHaveBeenCalledWith("company-1", expect.any(Function));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
