import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";

const {
  mockGetSidebarBadges,
  mockCanUser,
  mockHasPermission,
} = vi.hoisted(() => ({
  mockGetSidebarBadges: vi.fn(),
  mockCanUser: vi.fn(),
  mockHasPermission: vi.fn(),
}));

vi.mock("../services/sidebar-badges.js", () => ({
  sidebarBadgeService: () => ({
    get: mockGetSidebarBadges,
  }),
}));

vi.mock("../services/access.js", () => ({
  accessService: () => ({
    canUser: mockCanUser,
    hasPermission: mockHasPermission,
  }),
}));

import { sidebarBadgeRoutes } from "../routes/sidebar-badges.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createDbMock(selectResults: unknown[][]) {
  const queue = [...selectResults];
  return {
    select: () => createResolvedChain(queue.shift() ?? []),
  };
}

function createApp(actorKind: "board" | "agent", db: ReturnType<typeof createDbMock>) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).actor = actorKind === "agent"
      ? {
          type: "agent",
          source: "api_key",
          agentId: AGENT_ID,
          companyId: COMPANY_ID,
          userId: null,
          companyIds: [COMPANY_ID],
          runId: "run-1",
        }
      : {
          type: "board",
          source: "local_implicit",
          isInstanceAdmin: true,
          userId: "user-1",
          companyIds: [COMPANY_ID],
          runId: null,
        };
    next();
  });
  app.use(sidebarBadgeRoutes(db as never));
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Unhandled error" });
  });
  return app;
}

describe("sidebar badge routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes join approval and assigned issue counts for board operators", async () => {
    mockGetSidebarBadges.mockResolvedValue({
      joinRequests: 2,
      assignedIssues: 3,
      approvals: 1,
    });
    const app = createApp("board", createDbMock([
      [{ count: 2 }],
      [{ count: 3 }],
    ]));

    const response = await request(app).get(`/companies/${COMPANY_ID}/sidebar-badges`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      joinRequests: 2,
      assignedIssues: 3,
      approvals: 1,
    });
    expect(mockGetSidebarBadges).toHaveBeenCalledWith(COMPANY_ID, {
      joinRequests: 2,
      assignedIssues: 3,
    });
  });

  it("uses agent permission checks before counting join approvals", async () => {
    mockHasPermission.mockResolvedValue(true);
    mockGetSidebarBadges.mockResolvedValue({
      joinRequests: 1,
      assignedIssues: 0,
    });
    const app = createApp("agent", createDbMock([
      [{ count: 1 }],
    ]));

    const response = await request(app).get(`/companies/${COMPANY_ID}/sidebar-badges`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      joinRequests: 1,
      assignedIssues: 0,
    });
    expect(mockHasPermission).toHaveBeenCalledWith(COMPANY_ID, "agent", AGENT_ID, "joins:approve");
    expect(mockGetSidebarBadges).toHaveBeenCalledWith(COMPANY_ID, {
      joinRequests: 1,
      assignedIssues: 0,
    });
  });
});
