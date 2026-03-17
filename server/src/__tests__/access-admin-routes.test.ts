import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIsInstanceAdmin,
  mockListMembers,
  mockListMembersWithGrants,
  mockSetMemberPermissions,
  mockPromoteInstanceAdmin,
  mockDemoteInstanceAdmin,
  mockListUserCompanyAccess,
  mockSetUserCompanyAccess,
  mockInspectBoardClaimChallenge,
  mockClaimBoardOwnership,
} = vi.hoisted(() => ({
  mockIsInstanceAdmin: vi.fn(),
  mockListMembers: vi.fn(),
  mockListMembersWithGrants: vi.fn(),
  mockSetMemberPermissions: vi.fn(),
  mockPromoteInstanceAdmin: vi.fn(),
  mockDemoteInstanceAdmin: vi.fn(),
  mockListUserCompanyAccess: vi.fn(),
  mockSetUserCompanyAccess: vi.fn(),
  mockInspectBoardClaimChallenge: vi.fn(),
  mockClaimBoardOwnership: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    isInstanceAdmin: mockIsInstanceAdmin,
    hasPermission: vi.fn(),
    canUser: vi.fn(),
    listMembers: mockListMembers,
    listMembersWithGrants: mockListMembersWithGrants,
    setMemberPermissions: mockSetMemberPermissions,
    promoteInstanceAdmin: mockPromoteInstanceAdmin,
    demoteInstanceAdmin: mockDemoteInstanceAdmin,
    listUserCompanyAccess: mockListUserCompanyAccess,
    setUserCompanyAccess: mockSetUserCompanyAccess,
  }),
  agentService: () => ({}),
  logActivity: vi.fn(),
}));

vi.mock("../board-claim.js", () => ({
  inspectBoardClaimChallenge: mockInspectBoardClaimChallenge,
  claimBoardOwnership: mockClaimBoardOwnership,
}));

import { accessRoutes } from "../routes/access.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const actorSource = req.header("x-test-actor-source") === "session" ? "session" : "local_implicit";
    (req as any).actor = {
      type: "board",
      source: actorSource,
      isInstanceAdmin: true,
      userId: "user-1",
      companyIds: ["company-1"],
      runId: null,
    };
    next();
  });
  app.use(accessRoutes({} as never, {
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

describe("access admin and board-claim routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the current board claim challenge", async () => {
    mockInspectBoardClaimChallenge.mockReturnValue({
      status: "available",
      token: "token-1",
      expiresAt: "2026-03-13T12:00:00.000Z",
    });
    const app = createApp();

    const response = await request(app).get("/board-claim/token-1").query({ code: "123456" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "available",
      token: "token-1",
    });
    expect(mockInspectBoardClaimChallenge).toHaveBeenCalledWith("token-1", "123456");
  });

  it("claims board ownership for an authenticated session actor", async () => {
    mockClaimBoardOwnership.mockResolvedValue({
      status: "claimed",
      claimedByUserId: "user-1",
    });
    const app = createApp();

    const response = await request(app)
      .post("/board-claim/token-1/claim")
      .set("x-test-actor-source", "session")
      .send({
        code: "123456",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      claimed: true,
      userId: "user-1",
    });
    expect(mockClaimBoardOwnership).toHaveBeenCalledWith(
      {} as never,
      { token: "token-1", code: "123456", userId: "user-1" },
    );
  });

  it("lists company members for board operators", async () => {
    mockListMembersWithGrants.mockResolvedValue([
      {
        id: "member-1",
        companyId: "company-1",
        principalType: "user",
        principalId: "user-2",
        grants: [],
      },
    ]);
    const app = createApp();

    const response = await request(app).get("/companies/company-1/members");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: "member-1",
        companyId: "company-1",
        grants: [],
      }),
    ]);
    expect(mockListMembersWithGrants).toHaveBeenCalledWith("company-1");
  });

  it("patches member permissions inside the company scope", async () => {
    mockSetMemberPermissions.mockResolvedValue({
      id: "member-1",
      companyId: "company-1",
      grants: [
        {
          permissionKey: "users:invite",
          scope: null,
        },
      ],
    });
    const app = createApp();

    const response = await request(app)
      .patch("/companies/company-1/members/member-1/permissions")
      .send({
        grants: [
          {
            permissionKey: "users:invite",
            scope: null,
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: "member-1",
      companyId: "company-1",
      grants: [
        {
          permissionKey: "users:invite",
        },
      ],
    });
    expect(mockSetMemberPermissions).toHaveBeenCalledWith("company-1", "member-1", [
      {
        permissionKey: "users:invite",
        scope: null,
      },
    ], "user-1");
  });

  it("promotes instance admins through the admin surface", async () => {
    mockPromoteInstanceAdmin.mockResolvedValue({
      userId: "user-2",
      role: "instance_admin",
    });
    const app = createApp();

    const response = await request(app).post("/admin/users/user-2/promote-instance-admin");

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      userId: "user-2",
      role: "instance_admin",
    });
    expect(mockPromoteInstanceAdmin).toHaveBeenCalledWith("user-2");
  });

  it("lists and updates user company access through the admin surface", async () => {
    mockListUserCompanyAccess.mockResolvedValue([
      {
        companyId: "11111111-1111-4111-8111-111111111111",
        membershipRole: "member",
      },
    ]);
    mockSetUserCompanyAccess.mockResolvedValue([
      {
        companyId: "11111111-1111-4111-8111-111111111111",
        membershipRole: "member",
      },
      {
        companyId: "22222222-2222-4222-8222-222222222222",
        membershipRole: "member",
      },
    ]);
    const app = createApp();

    const listed = await request(app).get("/admin/users/user-2/company-access");
    const updated = await request(app)
      .put("/admin/users/user-2/company-access")
      .send({
        companyIds: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
      });

    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([
      expect.objectContaining({
        companyId: "11111111-1111-4111-8111-111111111111",
      }),
    ]);
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual([
      expect.objectContaining({
        companyId: "11111111-1111-4111-8111-111111111111",
      }),
      expect.objectContaining({
        companyId: "22222222-2222-4222-8222-222222222222",
      }),
    ]);
    expect(mockSetUserCompanyAccess).toHaveBeenCalledWith("user-2", [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });
});
