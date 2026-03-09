import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAccessService, mockAgentService } = vi.hoisted(() => ({
  mockAccessService: vi.fn(),
  mockAgentService: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: mockAccessService,
  agentService: mockAgentService,
  logActivity: vi.fn(),
}));

import { accessRoutes } from "../routes/access.js";

function buildBoardActor() {
  return {
    type: "board" as const,
    source: "local_implicit" as const,
    isInstanceAdmin: true,
    userId: "user-1",
    companyIds: [],
    runId: null,
  };
}

function createTestRouter() {
  return accessRoutes({} as never, {
    deploymentMode: "local_trusted",
    deploymentExposure: "private",
    bindHost: "127.0.0.1",
    allowedHostnames: [],
  }) as any;
}

function findRouteLayer(router: any, path: string, method: "get") {
  const layer = router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method] === true,
  );
  if (!layer?.route?.stack) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  }
  return layer.route.stack.map((entry: any) => entry.handle as Function);
}

async function invokeRoute(input: {
  path: string;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
}) {
  const router = createTestRouter();
  const handlers = findRouteLayer(router, input.path, "get");
  const req = {
    params: input.params ?? {},
    query: input.query ?? {},
    actor: buildBoardActor(),
    header() {
      return undefined;
    },
    protocol: "http",
  } as any;
  const state: {
    statusCode: number;
    body: unknown;
    type: string | null;
  } = {
    statusCode: 200,
    body: undefined,
    type: null,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      state.body = payload;
      return this;
    },
    type(value: string) {
      state.type = value;
      return this;
    },
    send(payload: unknown) {
      state.body = payload;
      return this;
    },
  };

  for (const handler of handlers) {
    await new Promise<void>((resolve, reject) => {
      try {
        const result = handler(req, res, (error?: unknown) => {
          if (error) reject(error);
          else resolve();
        });

        if (result && typeof result.then === "function") {
          result.then(() => resolve(), reject);
          return;
        }

        if (handler.length < 3) {
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  return state;
}

describe("access skill routes", () => {
  beforeEach(() => {
    mockAccessService.mockReturnValue({
      isInstanceAdmin: vi.fn(),
      hasPermission: vi.fn(),
      canUser: vi.fn(),
    });
    mockAgentService.mockReturnValue({});
  });

  it("returns only canonical squadrail skills", async () => {
    const response = await invokeRoute({ path: "/skills/index" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      skills: [
        { name: "squadrail", path: "/api/skills/squadrail" },
        { name: "squadrail-create-agent", path: "/api/skills/squadrail-create-agent" },
      ],
      aliases: [],
    });
  });

  it("serves the canonical squadrail skill bundle", async () => {
    const response = await invokeRoute({
      path: "/skills/:skillName",
      params: { skillName: "squadrail" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.type).toBe("text/markdown");
    expect(String(response.body)).toContain("name: squadrail");
    expect(String(response.body)).toContain("skills/squadrail/references/api-reference.md");
  });
});
