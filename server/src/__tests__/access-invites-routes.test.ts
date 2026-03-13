import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnsureMembership,
  mockSetPrincipalGrants,
  mockCreateAgent,
  mockCreateApiKey,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockEnsureMembership: vi.fn(),
  mockSetPrincipalGrants: vi.fn(),
  mockCreateAgent: vi.fn(),
  mockCreateApiKey: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    isInstanceAdmin: vi.fn().mockResolvedValue(true),
    hasPermission: vi.fn().mockResolvedValue(true),
    canUser: vi.fn().mockResolvedValue(true),
    ensureMembership: mockEnsureMembership,
    setPrincipalGrants: mockSetPrincipalGrants,
    promoteInstanceAdmin: vi.fn(),
    listMembers: vi.fn(),
    setMemberPermissions: vi.fn(),
    demoteInstanceAdmin: vi.fn(),
    listUserCompanyAccess: vi.fn(),
    setUserCompanyAccess: vi.fn(),
  }),
  agentService: () => ({
    create: mockCreateAgent,
    createApiKey: mockCreateApiKey,
  }),
  logActivity: mockLogActivity,
}));

vi.mock("../board-claim.js", () => ({
  inspectBoardClaimChallenge: vi.fn(),
  claimBoardOwnership: vi.fn(),
}));

import { accessRoutes } from "../routes/access.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createMutationResult(queue: unknown[][]) {
  return {
    returning: async () => queue.shift() ?? [],
    then: <T>(resolve: (value: undefined) => T | PromiseLike<T>) => Promise.resolve(undefined).then(resolve),
  };
}

function createAccessDbMock(input: {
  selectResults?: unknown[][];
  insertResults?: unknown[][];
  updateResults?: unknown[][];
}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const insertQueue = [...(input.insertResults ?? [])];
  const updateQueue = [...(input.updateResults ?? [])];
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const updateValues: Array<{ table: unknown; value: unknown }> = [];

  const db = {
    select: (..._args: unknown[]) => createResolvedChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        return createMutationResult(insertQueue);
      },
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateValues.push({ table, value });
        return {
          where: () => createMutationResult(updateQueue),
        };
      },
    }),
    transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
  };

  return { db, insertValues, updateValues };
}

function createInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: "invite-1",
    companyId: "company-1",
    inviteType: "company_join",
    tokenHash: "token-hash",
    allowedJoinTypes: "both",
    defaultsPayload: null,
    expiresAt: new Date("2026-03-20T00:00:00.000Z"),
    invitedByUserId: "user-1",
    revokedAt: null,
    acceptedAt: null,
    createdAt: new Date("2026-03-13T00:00:00.000Z"),
    updatedAt: new Date("2026-03-13T00:00:00.000Z"),
    ...overrides,
  };
}

function createJoinRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "join-1",
    inviteId: "invite-1",
    companyId: "company-1",
    requestType: "agent",
    status: "pending_approval",
    requestIp: "127.0.0.1",
    requestingUserId: null,
    requestEmailSnapshot: null,
    agentName: "Runtime Agent",
    adapterType: "openclaw",
    capabilities: "Handle runtime incidents",
    agentDefaultsPayload: { url: "https://openclaw.example.com/hook" },
    claimSecretHash: "claim-hash",
    claimSecretExpiresAt: new Date("2026-03-20T00:00:00.000Z"),
    claimSecretConsumedAt: null,
    createdAgentId: null,
    approvedByUserId: null,
    approvedAt: null,
    rejectedByUserId: null,
    rejectedAt: null,
    createdAt: new Date("2026-03-13T00:00:00.000Z"),
    updatedAt: new Date("2026-03-13T00:00:00.000Z"),
    ...overrides,
  };
}

function createApp(db: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
      userId: "user-1",
      companyIds: ["company-1"],
      runId: null,
    };
    next();
  });
  app.use(accessRoutes(db as never, {
    deploymentMode: "local_trusted",
    deploymentExposure: "private",
    bindHost: "127.0.0.1",
    allowedHostnames: [],
  }));
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Unhandled error" });
  });
  return app;
}

describe("access invite and join-request routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAgent.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      name: "Runtime Agent",
    });
    mockCreateApiKey.mockResolvedValue({
      id: "key-1",
      token: "agent-token",
      createdAt: new Date("2026-03-13T00:00:00.000Z"),
    });
  });

  it("creates company invites and exposes onboarding surfaces", async () => {
    const invite = createInvite();
    const { db, insertValues } = createAccessDbMock({
      selectResults: [[invite], [invite], [invite]],
      insertResults: [[invite]],
    });
    const app = createApp(db);

    const created = await request(app)
      .post("/companies/company-1/invites")
      .send({
        allowedJoinTypes: "both",
        expiresInHours: 12,
      });
    const onboarding = await request(app).get("/invites/test-token/onboarding");
    const onboardingText = await request(app).get("/invites/test-token/onboarding.txt");

    expect(created.status).toBe(201);
    expect(created.body).toEqual(expect.objectContaining({
      id: "invite-1",
      token: expect.stringMatching(/^sqd_invite_/),
      inviteUrl: expect.stringContaining("/invite/"),
    }));
    expect(onboarding.status).toBe(200);
    expect(onboarding.body.onboarding).toEqual(expect.objectContaining({
      registrationEndpoint: expect.objectContaining({
        url: expect.stringContaining("/api/invites/test-token/accept"),
      }),
    }));
    expect(onboardingText.status).toBe(200);
    expect(onboardingText.text).toContain("Submit agent join request");
    expect(insertValues[0]?.value).toEqual(expect.objectContaining({
      companyId: "company-1",
      inviteType: "company_join",
      allowedJoinTypes: "both",
    }));
  });

  it("accepts agent invites and returns claim metadata plus diagnostics", async () => {
    const invite = createInvite();
    const joinRequest = createJoinRequest({
      agentDefaultsPayload: null,
      claimSecretHash: "claim-hash",
    });
    const { db, updateValues, insertValues } = createAccessDbMock({
      selectResults: [[invite]],
      insertResults: [[joinRequest]],
      updateResults: [[]],
    });
    const app = createApp(db);

    const response = await request(app)
      .post("/invites/test-token/accept")
      .send({
        requestType: "agent",
        agentName: "Runtime Agent",
        adapterType: "openclaw",
        agentDefaultsPayload: {},
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual(expect.objectContaining({
      id: "join-1",
      requestType: "agent",
      status: "pending_approval",
      claimSecret: expect.stringMatching(/^sqd_claim_/),
      claimApiKeyPath: "/api/join-requests/join-1/claim-api-key",
    }));
    expect(response.body.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "openclaw_callback_url_missing",
        level: "warn",
      }),
    ]));
    expect(updateValues[0]?.value).toEqual(expect.objectContaining({
      acceptedAt: expect.any(Date),
    }));
    expect(insertValues[0]?.value).toEqual(expect.objectContaining({
      companyId: "company-1",
      requestType: "agent",
      agentName: "Runtime Agent",
      adapterType: "openclaw",
    }));
  });

  it("approves agent join requests by provisioning memberships and grants", async () => {
    const joinRequest = createJoinRequest();
    const invite = createInvite({
      defaultsPayload: {
        agent: {
          grants: [
            {
              permissionKey: "users:invite",
              scope: null,
            },
          ],
        },
      },
    });
    const approvedRequest = createJoinRequest({
      status: "approved",
      createdAgentId: "agent-1",
      approvedByUserId: "user-1",
      approvedAt: new Date("2026-03-13T00:05:00.000Z"),
    });
    const { db } = createAccessDbMock({
      selectResults: [[joinRequest], [invite]],
      updateResults: [[approvedRequest]],
    });
    const app = createApp(db);

    const response = await request(app).post("/companies/company-1/join-requests/join-1/approve");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      id: "join-1",
      status: "approved",
      createdAgentId: "agent-1",
    }));
    expect(mockCreateAgent).toHaveBeenCalledWith("company-1", expect.objectContaining({
      name: "Runtime Agent",
      adapterType: "openclaw",
    }));
    expect(mockEnsureMembership).toHaveBeenCalledWith("company-1", "agent", "agent-1", "member", "active");
    expect(mockSetPrincipalGrants).toHaveBeenCalledWith(
      "company-1",
      "agent",
      "agent-1",
      [{ permissionKey: "users:invite", scope: null }],
      "user-1",
    );
  });

  it("lists pending join requests without exposing claim secret hashes", async () => {
    const joinRequest = createJoinRequest();
    const { db } = createAccessDbMock({
      selectResults: [[joinRequest]],
    });
    const app = createApp(db);

    const response = await request(app).get("/companies/company-1/join-requests");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: "join-1",
        requestType: "agent",
        status: "pending_approval",
      }),
    ]);
    expect(response.body[0]).not.toHaveProperty("claimSecretHash");
  });

  it("rejects pending join requests through the board surface", async () => {
    const joinRequest = createJoinRequest();
    const rejectedRequest = createJoinRequest({
      status: "rejected",
      rejectedByUserId: "user-1",
      rejectedAt: new Date("2026-03-13T00:15:00.000Z"),
    });
    const { db } = createAccessDbMock({
      selectResults: [[joinRequest]],
      updateResults: [[rejectedRequest]],
    });
    const app = createApp(db);

    const response = await request(app).post("/companies/company-1/join-requests/join-1/reject");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      id: "join-1",
      status: "rejected",
      rejectedByUserId: "user-1",
    }));
  });

  it("claims agent API keys from approved join requests exactly once", async () => {
    const joinRequest = createJoinRequest({
      status: "approved",
      createdAgentId: "agent-1",
      claimSecretHash: "b2df3ae9f738c2ae798dc9d6092269931f7eb04f3833cecff2fdc4a5ac7b496e",
    });
    const { db } = createAccessDbMock({
      selectResults: [[joinRequest], []],
      updateResults: [[{ id: "join-1" }]],
    });
    const app = createApp(db);

    const response = await request(app)
      .post("/join-requests/join-1/claim-api-key")
      .send({
        claimSecret: "secret-to-claim-123",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      keyId: "key-1",
      token: "agent-token",
      agentId: "agent-1",
    }));
    expect(mockCreateApiKey).toHaveBeenCalledWith("agent-1", "initial-join-key");
  });

  it("rejects API key claims when the provided claim secret is invalid", async () => {
    const joinRequest = createJoinRequest({
      status: "approved",
      createdAgentId: "agent-1",
      claimSecretHash: "b2df3ae9f738c2ae798dc9d6092269931f7eb04f3833cecff2fdc4a5ac7b496e",
    });
    const { db } = createAccessDbMock({
      selectResults: [[joinRequest]],
    });
    const app = createApp(db);

    const response = await request(app)
      .post("/join-requests/join-1/claim-api-key")
      .send({
        claimSecret: "secret-to-claim-124",
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Invalid claim secret" });
    expect(mockCreateApiKey).not.toHaveBeenCalled();
  });
});
