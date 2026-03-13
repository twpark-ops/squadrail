import {
  agentApiKeys,
  agents,
  companyMemberships,
  heartbeatRuns,
  instanceUserRoles,
} from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockVerifyLocalAgentJwt,
  mockLoggerWarn,
} = vi.hoisted(() => ({
  mockVerifyLocalAgentJwt: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock("../agent-auth-jwt.js", () => ({
  verifyLocalAgentJwt: mockVerifyLocalAgentJwt,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    warn: mockLoggerWarn,
  },
}));

import { actorMiddleware, requireBoard } from "../middleware/auth.js";

function shiftTableRows(queueMap: Map<unknown, unknown[][]>, table: unknown) {
  const queue = queueMap.get(table);
  return queue?.shift() ?? [];
}

function createResolvedSelectChain(selectRows: Map<unknown, unknown[][]>) {
  let selectedTable: unknown = null;
  const chain = {
    from: (table: unknown) => {
      selectedTable = table;
      return chain;
    },
    where: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(shiftTableRows(selectRows, selectedTable)).then(resolve),
  };
  return chain;
}

function createAuthDbMock(input?: {
  selectRows?: Map<unknown, unknown[][]>;
}) {
  const selectRows = input?.selectRows ?? new Map();
  const updateSets: Array<{ table: unknown; value: unknown }> = [];

  const db = {
    select: () => createResolvedSelectChain(selectRows),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateSets.push({ table, value });
        return {
          where: async () => [],
        };
      },
    }),
  };

  return { db, updateSets };
}

function buildReq(headers: Record<string, string>) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    method: "GET",
    originalUrl: "/actor",
    actor: { type: "none", source: "none" },
    header(name: string) {
      return normalized[name.toLowerCase()];
    },
  } as any;
}

describe("actor middleware extended flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyLocalAgentJwt.mockReturnValue(null);
  });

  it("resolves authenticated browser sessions into board actors with memberships", async () => {
    const { db } = createAuthDbMock({
      selectRows: new Map([
        [instanceUserRoles, [[{ id: "role-1" }]]],
        [companyMemberships, [[{ companyId: "company-1" }, { companyId: "company-2" }]]],
      ]),
    });
    const req = buildReq({});
    const middleware = actorMiddleware(db as never, {
      deploymentMode: "authenticated",
      resolveSession: async () => ({
        user: { id: "user-1" },
      } as any),
    });

    await middleware(req, {} as any, () => undefined);

    expect(req.actor).toEqual({
      type: "board",
      userId: "user-1",
      companyIds: ["company-1", "company-2"],
      isInstanceAdmin: true,
      runId: undefined,
      source: "session",
    });
    expect(requireBoard(req)).toBe(true);
  });

  it("accepts local agent JWTs when the API key is absent and the run belongs to the agent", async () => {
    mockVerifyLocalAgentJwt.mockReturnValue({
      sub: "agent-1",
      company_id: "company-1",
      run_id: "run-1",
    });
    const { db } = createAuthDbMock({
      selectRows: new Map([
        [agentApiKeys, [[]]],
        [agents, [[{
          id: "agent-1",
          companyId: "company-1",
          status: "idle",
        }]]],
        [heartbeatRuns, [[{ id: "run-1" }]]],
      ]),
    });
    const req = buildReq({
      Authorization: "Bearer local-jwt-token",
    });
    const middleware = actorMiddleware(db as never, {
      deploymentMode: "authenticated",
    });

    await middleware(req, {} as any, () => undefined);

    expect(req.actor).toEqual({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      keyId: undefined,
      runId: "run-1",
      source: "agent_jwt",
    });
  });

  it("hydrates API-key actors and drops invalid run ids with a warning", async () => {
    const { db, updateSets } = createAuthDbMock({
      selectRows: new Map([
        [agentApiKeys, [[{
          id: "key-1",
          companyId: "company-1",
          agentId: "agent-1",
        }]]],
        [agents, [[{
          id: "agent-1",
          companyId: "company-1",
          status: "idle",
        }]]],
        [heartbeatRuns, [[]]],
      ]),
    });
    const req = buildReq({
      Authorization: "Bearer api-key-token",
      "X-Squadrail-Run-Id": "run-missing",
    });
    const middleware = actorMiddleware(db as never, {
      deploymentMode: "authenticated",
    });

    await middleware(req, {} as any, () => undefined);

    expect(updateSets[0]).toMatchObject({
      table: agentApiKeys,
      value: expect.objectContaining({
        lastUsedAt: expect.any(Date),
      }),
    });
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-missing",
        agentId: "agent-1",
        keyId: "key-1",
      }),
      "Invalid run ID in API key request - run not found or mismatch",
    );
    expect(req.actor).toEqual({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      keyId: "key-1",
      runId: undefined,
      source: "agent_key",
    });
  });
});
