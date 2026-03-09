import { describe, expect, it } from "vitest";
import {
  chunkWorkspaceFile,
  classifyWorkspaceDocument,
  detectWorkspaceSecret,
  extractSemanticTopLevelSymbols,
  extractTypeScriptTopLevelSymbols,
  resolveWorkspaceImportRoot,
  shouldIncludeWorkspacePath,
} from "../services/knowledge-import.js";

describe("knowledge import helpers", () => {
  it("filters ignored directories and unsupported files", () => {
    expect(shouldIncludeWorkspacePath({ relativePath: "src/index.ts" })).toBe(true);
    expect(shouldIncludeWorkspacePath({ relativePath: "node_modules/react/index.js" })).toBe(false);
    expect(shouldIncludeWorkspacePath({ relativePath: "assets/logo.png" })).toBe(false);
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
});
