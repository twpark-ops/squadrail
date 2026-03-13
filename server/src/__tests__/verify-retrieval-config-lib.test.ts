import { describe, expect, it } from "vitest";
import { runRetrievalConfigVerification } from "../scripts/verify-retrieval-config-lib.js";

function createSqlTag() {
  return (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ""),
      "",
    );
}

describe("verify retrieval config library", () => {
  it("reports incomplete configuration when embeddings are unavailable", async () => {
    const outputs: string[] = [];
    const execute = async (query: unknown) => {
      const text = String(query);
      if (text.includes("SELECT 1")) return [{}];
      if (text.includes("knowledge_documents")) return [{ count: 0 }];
      if (text.includes("knowledge_chunks WHERE embedding IS NOT NULL")) return [{ count: 0 }];
      if (text.includes("knowledge_chunks")) return [{ count: 0 }];
      if (text.includes("retrieval_policies")) return [{ count: 0 }];
      if (text.includes("retrieval_runs")) return [{ count: 0 }];
      if (text.includes("task_briefs")) return [{ count: 0 }];
      return [];
    };

    const result = await runRetrievalConfigVerification({
      embeddings: {
        getProviderInfo: () => ({
          available: false,
          provider: null,
          model: null,
          dimensions: null,
          endpoint: null,
        }),
        generateEmbeddings: async () => ({ embeddings: [], usage: { totalTokens: 0 } }),
      },
      db: { execute },
      sql: createSqlTag(),
      print: (line = "") => outputs.push(line),
    });

    expect(result).toEqual({
      ok: false,
      exitCode: 1,
    });
    expect(outputs).toContain("   ❌ Embedding provider NOT configured");
    expect(outputs).toContain("   ⚠️  No retrieval policies configured");
    expect(outputs).toContain("⚠️  CONFIGURATION INCOMPLETE");
  });

  it("reports ready state when embeddings, policies, and history are available", async () => {
    const outputs: string[] = [];
    const execute = async (query: unknown) => {
      const text = String(query);
      if (text.includes("SELECT 1")) return [{}];
      if (text.includes("knowledge_documents")) return [{ count: 5 }];
      if (text.includes("knowledge_chunks WHERE embedding IS NOT NULL")) return [{ count: 8 }];
      if (text.includes("knowledge_chunks")) return [{ count: 10 }];
      if (text.includes("SELECT COUNT(*) as count FROM retrieval_policies")) return [{ count: 2 }];
      if (text.includes("WHERE role = 'engineer'")) {
        return [{ event_type: "on_assignment", top_k_sparse: 20, top_k_dense: 10, final_k: 5 }];
      }
      if (text.includes("retrieval_runs")) return [{ count: 3 }];
      if (text.includes("task_briefs")) return [{ count: 2 }];
      return [];
    };

    const result = await runRetrievalConfigVerification({
      embeddings: {
        getProviderInfo: () => ({
          available: true,
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
          endpoint: "https://api.openai.com/v1",
        }),
        generateEmbeddings: async () => ({
          embeddings: [[0.1, 0.2, 0.3]],
          usage: { totalTokens: 42 },
        }),
      },
      db: { execute },
      sql: createSqlTag(),
      print: (line = "") => outputs.push(line),
    });

    expect(result).toEqual({
      ok: true,
      exitCode: 0,
    });
    expect(outputs).toContain("   ✅ Embedding provider configured");
    expect(outputs).toContain("   ✅ Embedding generation successful");
    expect(outputs).toContain("   ✅ 2 retrieval policies configured");
    expect(outputs).toContain("   ✅ Retrieval system has been used");
    expect(outputs).toContain("✅ CONFIGURATION COMPLETE");
  });

  it("fails fast when database connectivity is unavailable", async () => {
    const outputs: string[] = [];

    const result = await runRetrievalConfigVerification({
      embeddings: {
        getProviderInfo: () => ({
          available: true,
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
          endpoint: "https://api.openai.com/v1",
        }),
        generateEmbeddings: async () => ({
          embeddings: [[0.1]],
          usage: { totalTokens: 1 },
        }),
      },
      db: {
        execute: async (query: unknown) => {
          if (String(query).includes("SELECT 1")) {
            throw new Error("connection refused");
          }
          return [];
        },
      },
      sql: createSqlTag(),
      print: (line = "") => outputs.push(line),
    });

    expect(result).toEqual({
      ok: false,
      exitCode: 1,
    });
    expect(outputs).toContain("   ❌ Database connection failed");
    expect(outputs.some((line) => line.includes("connection refused"))).toBe(true);
  });
});
