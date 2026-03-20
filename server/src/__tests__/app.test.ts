import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockActorMiddleware,
  mockApiCors,
  mockApiRateLimit,
  mockBoardMutationGuard,
  mockFsExistsSync,
  mockHealthRoutes,
  mockPrivateHostnameGuard,
  mockResolvePrivateHostnameAllowSet,
  mockRlsRequestContextMiddleware,
} = vi.hoisted(() => ({
  mockActorMiddleware: vi.fn(),
  mockApiCors: vi.fn(),
  mockApiRateLimit: vi.fn(),
  mockBoardMutationGuard: vi.fn(),
  mockFsExistsSync: vi.fn(),
  mockHealthRoutes: vi.fn(),
  mockPrivateHostnameGuard: vi.fn(),
  mockResolvePrivateHostnameAllowSet: vi.fn(),
  mockRlsRequestContextMiddleware: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      existsSync: mockFsExistsSync,
    },
    existsSync: mockFsExistsSync,
  };
});

vi.mock("../middleware/index.js", () => ({
  httpLogger: (_req: any, _res: any, next: () => void) => next(),
  errorHandler: (err: unknown, _req: any, res: any, _next: any) => {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  },
}));

vi.mock("../middleware/api-cors.js", () => ({
  apiCors: mockApiCors.mockImplementation(() => (_req: any, _res: any, next: () => void) => next()),
}));

vi.mock("../middleware/api-rate-limit.js", () => ({
  apiRateLimit: mockApiRateLimit.mockImplementation(() => (_req: any, _res: any, next: () => void) => next()),
}));

vi.mock("../middleware/auth.js", () => ({
  actorMiddleware: mockActorMiddleware.mockImplementation(() => (req: any, _res: any, next: () => void) => {
    const requestedActor = req.header("x-test-actor");
    req.actor = requestedActor === "board"
      ? {
        type: "board",
        source: "local_implicit",
        isInstanceAdmin: true,
        userId: "user-1",
        companyIds: ["company-1"],
        runId: null,
      }
      : {
        type: "none",
      };
    next();
  }),
}));

vi.mock("../middleware/board-mutation-guard.js", () => ({
  boardMutationGuard: mockBoardMutationGuard.mockImplementation(() => (_req: any, _res: any, next: () => void) => next()),
}));

vi.mock("../middleware/private-hostname-guard.js", () => ({
  privateHostnameGuard: mockPrivateHostnameGuard.mockImplementation(() => (_req: any, _res: any, next: () => void) => next()),
  resolvePrivateHostnameAllowSet: mockResolvePrivateHostnameAllowSet.mockImplementation(() => new Set(["app.internal"])),
}));

vi.mock("../middleware/rls.js", () => ({
  rlsRequestContextMiddleware: mockRlsRequestContextMiddleware.mockImplementation(() => (_req: any, _res: any, next: () => void) => next()),
}));

function createRootResponder(payload: unknown) {
  return (_req: any, res: any) => {
    res.json(payload);
  };
}

vi.mock("../routes/health.js", () => ({
  healthRoutes: mockHealthRoutes.mockImplementation(() => createRootResponder({ status: "ok" })),
}));

vi.mock("../routes/companies.js", () => ({
  companyRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("../routes/agents.js", () => ({
  agentRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("../routes/projects.js", () => ({
  projectRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("../routes/issues.js", () => ({
  issueRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("../routes/goals.js", () => ({
  goalRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("../routes/approvals.js", () => ({
  approvalRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("../routes/secrets.js", () => ({
  secretRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("../routes/costs.js", () => ({
  costRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("../routes/activity.js", () => ({
  activityRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("../routes/dashboard.js", () => ({
  dashboardRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("../routes/sidebar-badges.js", () => ({
  sidebarBadgeRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("../routes/llms.js", () => ({
  llmRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("../routes/assets.js", () => ({
  assetRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("../routes/access.js", () => ({
  accessRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("../routes/knowledge.js", () => ({
  knowledgeRoutes: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}));

import { createApp } from "../app.js";

function buildOptions(overrides: Partial<Parameters<typeof createApp>[1]> = {}) {
  return {
    uiMode: "none" as const,
    storageService: {} as never,
    deploymentMode: "local_trusted" as const,
    deploymentExposure: "public" as const,
    allowedHostnames: ["app.internal"],
    bindHost: "0.0.0.0",
    authReady: true,
    companyDeletionEnabled: true,
    protocolTimeoutsEnabled: true,
    knowledgeBackfillEnabled: true,
    issueDocumentMaxBodyChars: 200_000,
    ...overrides,
  };
}

describe("createApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFsExistsSync.mockReturnValue(false);
  });

  it("returns a board session for authenticated board actors and rejects anonymous access", async () => {
    const app = await createApp({} as never, buildOptions());

    const unauthorized = await request(app).get("/api/auth/get-session");
    const authorized = await request(app)
      .get("/api/auth/get-session")
      .set("x-test-actor", "board");

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(authorized.body).toEqual({
      session: {
        id: "squadrail:local_implicit:user-1",
        userId: "user-1",
      },
      user: {
        id: "user-1",
        email: null,
        name: "Local Board",
      },
    });
  });

  it("mounts API routes and configures the private-hostname guard for authenticated private deployments", async () => {
    const app = await createApp({} as never, buildOptions({
      deploymentMode: "authenticated",
      deploymentExposure: "private",
    }));

    const response = await request(app)
      .get("/api/health")
      .set("x-test-actor", "board")
      .set("x-forwarded-proto", "https");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(mockResolvePrivateHostnameAllowSet).toHaveBeenCalledWith({
      allowedHostnames: ["app.internal"],
      bindHost: "0.0.0.0",
    });
    expect(mockPrivateHostnameGuard).toHaveBeenCalledWith({
      enabled: true,
      allowedHostnames: ["app.internal"],
      bindHost: "0.0.0.0",
    });
    expect(mockActorMiddleware).toHaveBeenCalledWith({} as never, expect.objectContaining({
      deploymentMode: "authenticated",
    }));
  });

  it("mounts the better-auth handler when provided", async () => {
    const betterAuthHandler = vi.fn((_: any, res: any) => {
      res.status(204).end();
    });
    const app = await createApp({} as never, buildOptions({
      betterAuthHandler,
    }));

    const response = await request(app).post("/api/auth/login");

    expect(response.status).toBe(204);
    expect(betterAuthHandler).toHaveBeenCalled();
  });

  it("accepts JSON bodies larger than the default parser limit when issue document limits require it", async () => {
    const betterAuthHandler = vi.fn((req: any, res: any) => {
      res.status(200).json({ payloadSize: JSON.stringify(req.body).length });
    });
    const app = await createApp({} as never, buildOptions({
      betterAuthHandler,
      issueDocumentMaxBodyChars: 200_000,
    }));

    const response = await request(app)
      .post("/api/auth/login")
      .send({ body: "x".repeat(150_000) });

    expect(response.status).toBe(200);
    expect(response.body.payloadSize).toBeGreaterThan(100_000);
  });

  it("falls back to API-only mode when static UI assets are missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const app = await createApp({} as never, buildOptions({
        uiMode: "static",
      }));

      const response = await request(app).get("/api/health").set("x-test-actor", "board");

      expect(response.status).toBe(200);
      expect(mockFsExistsSync).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith("[squadrail] UI dist not found; running in API-only mode");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
