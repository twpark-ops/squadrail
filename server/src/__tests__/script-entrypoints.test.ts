import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateDbClient,
  mockKnowledgeEmbeddingService,
  mockRunRetrievalConfigVerification,
} = vi.hoisted(() => ({
  mockCreateDbClient: vi.fn(),
  mockKnowledgeEmbeddingService: vi.fn(),
  mockRunRetrievalConfigVerification: vi.fn(),
}));

vi.mock("../../../packages/db/src/client.js", () => ({
  createDbClient: mockCreateDbClient,
}));

vi.mock("@squadrail/db", () => ({
  db: { id: "db" },
}));

vi.mock("drizzle-orm", () => ({
  sql: { kind: "sql" },
}));

vi.mock("../services/knowledge-embeddings.js", () => ({
  knowledgeEmbeddingService: mockKnowledgeEmbeddingService,
}));

vi.mock("../scripts/verify-retrieval-config-lib.js", () => ({
  runRetrievalConfigVerification: mockRunRetrievalConfigVerification,
}));

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("script entrypoints", () => {
  const originalExit = process.exit;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  it("prints the local import inspection report and closes the db client", async () => {
    const dbTag = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("FROM companies")) {
        return [{
          name: "Cloud Swiftsight",
          issue_prefix: "CLO",
          description: "Ops company",
        }];
      }
      if (query.includes("FROM agents")) {
        return [
          { name: "Atlas", role: "cto", adapter_type: "codex_local" },
          { name: "Nova", role: "pm", adapter_type: "claude_local" },
        ];
      }
      if (query.includes("FROM projects")) {
        return [
          { id: "project-1", name: "Runtime", lead_agent_slug: "atlas", status: "active" },
        ];
      }
      if (query.includes("FROM project_workspaces")) {
        return [
          { name: "primary", cwd: "/workspace/runtime", is_primary: true },
        ];
      }
      return [];
    }) as unknown as ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>) & {
      end: () => Promise<void>;
    };
    dbTag.end = vi.fn(async () => undefined);
    mockCreateDbClient.mockResolvedValue(dbTag);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await import("../../check-import.ts");
    await flushMicrotasks();

    expect(mockCreateDbClient).toHaveBeenCalledWith({
      databaseUrl: "postgresql://postgres@127.0.0.1:54329/squadrail",
    });
    expect(logSpy).toHaveBeenCalledWith("=== COMPANY ===");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Name: Cloud Swiftsight"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("=== AGENTS (2/18) ==="));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[PRIMARY] primary: /workspace/runtime"));
    expect(dbTag.end).toHaveBeenCalledTimes(1);
  });

  it("exits with the verification result code when retrieval config verification fails", async () => {
    mockKnowledgeEmbeddingService.mockReturnValue({ provider: "mock" });
    mockRunRetrievalConfigVerification.mockResolvedValue({ ok: false, exitCode: 7 });
    const exitSpy = vi.fn() as typeof process.exit;
    process.exit = exitSpy;

    await import("../../scripts/verify-retrieval-config.ts");
    await flushMicrotasks();

    expect(mockRunRetrievalConfigVerification).toHaveBeenCalledWith({
      embeddings: { provider: "mock" },
      db: { id: "db" },
      sql: { kind: "sql" },
    });
    expect(exitSpy).toHaveBeenCalledWith(7);
  });

  it("logs fatal verification errors and exits with code 1", async () => {
    mockKnowledgeEmbeddingService.mockReturnValue({ provider: "mock" });
    mockRunRetrievalConfigVerification.mockRejectedValue(new Error("fatal"));
    const exitSpy = vi.fn() as typeof process.exit;
    process.exit = exitSpy;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await import("../../scripts/verify-retrieval-config.ts");
    await flushMicrotasks();

    expect(errorSpy).toHaveBeenCalledWith("Fatal error:", expect.any(Error));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
