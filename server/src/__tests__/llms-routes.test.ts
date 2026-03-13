import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENT_ID = "22222222-2222-4222-8222-222222222222";

const {
  mockListAdapters,
  mockFindAdapter,
  mockGetAgentById,
} = vi.hoisted(() => ({
  mockListAdapters: vi.fn(),
  mockFindAdapter: vi.fn(),
  mockGetAgentById: vi.fn(),
}));

vi.mock("../adapters/index.js", () => ({
  listProductVisibleServerAdapters: mockListAdapters,
  findServerAdapter: mockFindAdapter,
}));

vi.mock("../services/agents.js", () => ({
  agentService: () => ({
    getById: mockGetAgentById,
  }),
}));

import { llmRoutes } from "../routes/llms.js";

function createApp(actorKind: "board" | "agent" = "board") {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).actor = actorKind === "agent"
      ? {
          type: "agent",
          source: "api_key",
          agentId: AGENT_ID,
          userId: null,
          companyIds: ["company-1"],
          runId: "run-1",
        }
      : {
          type: "board",
          source: "local_implicit",
          isInstanceAdmin: true,
          userId: "user-1",
          companyIds: ["company-1"],
          runId: null,
        };
    next();
  });
  app.use(llmRoutes({} as never));
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Unhandled error" });
  });
  return app;
}

describe("llm routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the configuration index for board operators", async () => {
    mockListAdapters.mockReturnValue([
      { type: "codex_local" },
      { type: "claude_local" },
    ]);
    const app = createApp();

    const response = await request(app).get("/llms/agent-configuration.txt");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Squadrail Agent Configuration Index");
    expect(response.text).toContain("/llms/agent-configuration/claude_local.txt");
    expect(response.text).toContain("/llms/agent-icons.txt");
  });

  it("rejects agents without the create-agent reflection permission", async () => {
    mockGetAgentById.mockResolvedValue({
      id: AGENT_ID,
      role: "engineer",
      permissions: { canCreateAgents: false },
    });
    const app = createApp("agent");

    const response = await request(app).get("/llms/agent-icons.txt");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "Missing permission to read agent configuration reflection",
    });
  });

  it("returns adapter-specific documentation or 404 for unknown adapters", async () => {
    mockFindAdapter.mockReturnValueOnce({
      type: "codex_local",
      agentConfigurationDoc: "# Codex configuration\n\nUse codex_local.",
    });
    mockFindAdapter.mockReturnValueOnce(null);
    const app = createApp();

    const existing = await request(app).get("/llms/agent-configuration/codex_local.txt");
    const missing = await request(app).get("/llms/agent-configuration/unknown.txt");

    expect(existing.status).toBe(200);
    expect(existing.text).toContain("Codex configuration");
    expect(missing.status).toBe(404);
    expect(missing.text).toContain("Unknown adapter type: unknown");
  });
});
