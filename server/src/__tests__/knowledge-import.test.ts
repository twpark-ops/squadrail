import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  chunkWorkspaceFile,
  classifyWorkspaceDocument,
  detectWorkspaceSecret,
  extractSemanticTopLevelSymbols,
  extractTypeScriptTopLevelSymbols,
  normalizeChunksForEmbedding,
  prioritizeWorkspaceImportPaths,
  resolveWorkspaceImportRoot,
  scoreWorkspaceImportPath,
  shouldIncludeWorkspacePath,
  walkWorkspaceFiles,
} from "../services/knowledge-import.js";

describe("knowledge import helpers", () => {
  it("filters ignored directories and unsupported files", () => {
    expect(shouldIncludeWorkspacePath({ relativePath: "src/index.ts" })).toBe(true);
    expect(shouldIncludeWorkspacePath({ relativePath: "node_modules/react/index.js" })).toBe(false);
    expect(shouldIncludeWorkspacePath({ relativePath: ".bmad/agents/dev.md" })).toBe(false);
    expect(shouldIncludeWorkspacePath({ relativePath: ".claude/settings.local.json" })).toBe(false);
    expect(shouldIncludeWorkspacePath({ relativePath: "gen/es/core/settings/v1/settings_pb.ts" })).toBe(false);
    expect(shouldIncludeWorkspacePath({ relativePath: "internal/graphql/relay/generated.go" })).toBe(false);
    expect(shouldIncludeWorkspacePath({ relativePath: "assets/logo.png" })).toBe(false);
  });

  it("prioritizes source files ahead of docs and hidden tooling", () => {
    expect(scoreWorkspaceImportPath({ relativePath: "src/server/main.go" })).toBeGreaterThan(
      scoreWorkspaceImportPath({ relativePath: "docs/architecture.md" }),
    );
    expect(scoreWorkspaceImportPath({ relativePath: "src/server/main.go" })).toBeGreaterThan(
      scoreWorkspaceImportPath({ relativePath: "src/server/main_test.go" }),
    );
    expect(
      prioritizeWorkspaceImportPaths([
        "docs/architecture.md",
        "src/server/main.go",
        "src/server/main_test.go",
        "docker/docker-compose.yml",
      ]),
    ).toEqual([
      "src/server/main.go",
      "src/server/main_test.go",
      "docs/architecture.md",
      "docker/docker-compose.yml",
    ]);
  });

  it("classifies workspace documents by path and file role", () => {
    expect(
      classifyWorkspaceDocument({
        relativePath: "docs/adr/001-retries.md",
        content: "# Decision\nUse bounded retries.",
      }),
    ).toMatchObject({
      sourceType: "adr",
      language: "markdown",
    });

    expect(
      classifyWorkspaceDocument({
        relativePath: "src/retry-worker.test.ts",
        content: "describe('retryWorker', () => {})",
      }),
    ).toMatchObject({
      sourceType: "test_report",
      language: "typescript",
    });
  });

  it("extracts top-level TypeScript symbols with AST when compiler is available", () => {
    const symbols = extractTypeScriptTopLevelSymbols({
      relativePath: "src/example.ts",
      content: [
        "export interface RetryConfig {",
        "  attempts: number;",
        "}",
        "",
        "export function retryWorker() {",
        "  return true;",
        "}",
      ].join("\n"),
    });

    if (!symbols) {
      expect(symbols).toBeNull();
      return;
    }

    expect(symbols.map((symbol) => symbol.symbolName)).toEqual([
      "RetryConfig",
      "retryWorker",
    ]);
    expect(symbols[0]).toMatchObject({
      symbolKind: "interface",
      exported: true,
      lineStart: 1,
    });
  });

  it("extracts semantic top-level symbols for python and sql", () => {
    const pythonSymbols = extractSemanticTopLevelSymbols({
      relativePath: "src/worker.py",
      language: "python",
      content: [
        "@dataclass",
        "class RetryWorker:",
        "    pass",
        "",
        "def run_job():",
        "    return True",
      ].join("\n"),
    });
    expect(pythonSymbols).toMatchObject([
      {
        symbolName: "RetryWorker",
        symbolKind: "class",
        parser: "semantic_python",
        lineStart: 1,
        lineEnd: 3,
      },
      {
        symbolName: "run_job",
        symbolKind: "function",
        parser: "semantic_python",
        lineEnd: 6,
      },
    ]);

    const sqlSymbols = extractSemanticTopLevelSymbols({
      relativePath: "db/schema.sql",
      language: "sql",
      content: [
        "CREATE TABLE retry_jobs (id uuid);",
        "",
        "CREATE VIEW retry_job_view AS SELECT * FROM retry_jobs;",
      ].join("\n"),
    });
    expect(sqlSymbols).toMatchObject([
      {
        symbolName: "retry_jobs",
        symbolKind: "table",
        parser: "semantic_sql",
      },
      {
        symbolName: "retry_job_view",
        symbolKind: "view",
        parser: "semantic_sql",
      },
    ]);

    const goSymbols = extractSemanticTopLevelSymbols({
      relativePath: "src/retry.go",
      language: "go",
      content: [
        "type RetryWorker struct {",
        "  attempts int",
        "}",
        "",
        "func RunJob() error {",
        "  return nil",
        "}",
      ].join("\n"),
    });
    expect(goSymbols).toMatchObject([
      {
        symbolName: "RetryWorker",
        symbolKind: "type_struct",
        parser: "semantic_go",
        lineStart: 1,
        lineEnd: 3,
      },
      {
        symbolName: "RunJob",
        symbolKind: "function",
        parser: "semantic_go",
        lineStart: 5,
        lineEnd: 7,
      },
    ]);
  });

  it("chunks workspace files with overlap and symbol hints", () => {
    const content = [
      "export function alpha() {",
      ...Array.from({ length: 20 }, () => "  return 1;"),
      "}",
      "",
      "export function beta() {",
      ...Array.from({ length: 20 }, () => "  return 2;"),
      "}",
    ].join("\n");

    const chunks = chunkWorkspaceFile({
      relativePath: "src/example.ts",
      content,
      language: "typescript",
      maxLines: 20,
      overlapLines: 2,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.symbolName).toBe("alpha");
    expect(chunks[0]?.metadata).toMatchObject({
      language: "typescript",
      lineStart: 1,
      chunkKind: "ast_symbol",
    });
    expect(Number(chunks[0]?.metadata?.lineEnd ?? 0)).toBeGreaterThan(20);
    expect(chunks[0]?.metadata?.parser).toBe("typescript_ast");
    expect(chunks[1]?.metadata?.lineStart).toBeGreaterThan(1);
  });

  it("chunks markdown documents by heading path", () => {
    const chunks = chunkWorkspaceFile({
      relativePath: "docs/runbook/deploy.md",
      content: [
        "# Deploy",
        "Prepare rollout.",
        "## Verify",
        "Check metrics and alerts.",
      ].join("\n"),
      language: "markdown",
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.headingPath).toContain("Deploy");
    expect(chunks[1]?.headingPath).toContain("Verify");
    expect(chunks[0]?.metadata).toMatchObject({
      chunkKind: "section",
      language: "markdown",
    });
  });

  it("assigns unique monotonic chunk indexes for large markdown sections", () => {
    const largeSection = Array.from({ length: 220 }, (_, index) => `line ${index + 1}`).join("\n");
    const chunks = chunkWorkspaceFile({
      relativePath: "docs/runbook/large.md",
      content: [
        "# Intro",
        largeSection,
        "## Followup",
        largeSection,
      ].join("\n"),
      language: "markdown",
    });

    const chunkIndexes = chunks.map((chunk) => chunk.chunkIndex);
    expect(new Set(chunkIndexes).size).toBe(chunkIndexes.length);
    expect(chunkIndexes).toEqual([...chunkIndexes].sort((left, right) => left - right));
  });

  it("splits oversized chunks until each embedding input fits the provider budget", () => {
    const oversizedChunk = {
      chunkIndex: 0,
      headingPath: "Design",
      symbolName: "HugeSpec",
      tokenCount: 12_000,
      textContent: Array.from({ length: 240 }, (_, index) => `line ${index + 1} repeated words repeated words repeated words repeated words`).join("\n"),
      searchText: "Design\nHugeSpec",
      metadata: {
        lineStart: 1,
        lineEnd: 240,
        chunkKind: "section",
      },
    };

    const normalized = normalizeChunksForEmbedding({
      relativePath: "docs/spec.md",
      language: "markdown",
      chunks: [oversizedChunk],
    });

    expect(normalized.length).toBeGreaterThan(1);
    expect(normalized.every((chunk) => chunk.tokenCount <= 7000)).toBe(true);
    expect(normalized.every((chunk) => chunk.metadata.oversizeSplit === true)).toBe(true);
    expect(normalized[0]?.metadata.lineStart).toBe(1);
    expect(Number(normalized.at(-1)?.metadata.lineEnd ?? 0)).toBe(240);
  });

  it("chunks python files with semantic parser metadata", () => {
    const chunks = chunkWorkspaceFile({
      relativePath: "src/worker.py",
      content: [
        "@dataclass",
        "class RetryWorker:",
        "    pass",
        "",
        "def run_job():",
        "    return True",
      ].join("\n"),
      language: "python",
    });

    expect(chunks[0]?.symbolName).toBe("RetryWorker");
    expect(chunks[0]?.metadata).toMatchObject({
      chunkKind: "semantic_symbol",
      parser: "semantic_python",
      symbolKind: "class",
      lineEnd: 3,
    });
    expect(chunks[1]?.symbolName).toBe("run_job");
    expect(chunks[1]?.metadata?.lineEnd).toBe(6);
  });

  it("detects secrets in workspace content", () => {
    expect(
      detectWorkspaceSecret({
        relativePath: "config/runtime.yaml",
        content: 'api_key: "sk-secret-value-1234567890"',
      }),
    ).toMatchObject({
      reason: "sensitive_content",
    });

    expect(
      detectWorkspaceSecret({
        relativePath: "src/app.ts",
        content: "export const ok = true;",
      }),
    ).toBeNull();
  });

  it("rejects workspace roots outside the configured allowlist", async () => {
    const resolved = await resolveWorkspaceImportRoot({
      cwd: "/tmp",
      allowedRoots: ["/tmp"],
    });
    expect(resolved).toBe("/tmp");

    await expect(resolveWorkspaceImportRoot({
      cwd: "/tmp",
      allowedRoots: ["/var"],
    })).rejects.toThrow("outside allowed workspace roots");
  });

  it("walks past lexicographic docs noise and keeps source files in the top import set", async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), "knowledge-import-"));
    try {
      await mkdir(path.join(fixtureRoot, "docs"), { recursive: true });
      await mkdir(path.join(fixtureRoot, "src"), { recursive: true });

      await Promise.all([
        ...Array.from({ length: 120 }, (_, index) => (
          writeFile(
            path.join(fixtureRoot, "docs", `guide-${String(index + 1).padStart(3, "0")}.md`),
            `# Guide ${index + 1}\nDocumentation`,
          )
        )),
        writeFile(
          path.join(fixtureRoot, "src", "main.ts"),
          "export function runService() { return true; }\n",
        ),
      ]);

      const selected = await walkWorkspaceFiles({
        cwd: fixtureRoot,
        maxFiles: 50,
      });
      const relativeSelected = selected.map((entry) => path.relative(fixtureRoot, entry).split(path.sep).join("/"));

      expect(relativeSelected).toContain("src/main.ts");
      expect(relativeSelected[0]).toBe("src/main.ts");
      expect(relativeSelected).toHaveLength(50);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
