import {
  issueLabels,
  issueProtocolArtifacts,
  issueProtocolMessages,
  issueProtocolRecipients,
  issueProtocolState,
  issues,
  knowledgeDocuments,
  labels,
  projects,
} from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateDocument,
  mockGetDocumentById,
  mockReplaceDocumentChunks,
  mockUpdateDocumentMetadata,
  mockDeprecateSupersededDocuments,
  mockTouchProjectKnowledgeRevision,
  mockIsConfigured,
  mockGenerateEmbeddings,
} = vi.hoisted(() => ({
  mockCreateDocument: vi.fn(),
  mockGetDocumentById: vi.fn(),
  mockReplaceDocumentChunks: vi.fn(),
  mockUpdateDocumentMetadata: vi.fn(),
  mockDeprecateSupersededDocuments: vi.fn(),
  mockTouchProjectKnowledgeRevision: vi.fn(),
  mockIsConfigured: vi.fn(),
  mockGenerateEmbeddings: vi.fn(),
}));

vi.mock("../services/knowledge.js", () => ({
  knowledgeService: () => ({
    createDocument: mockCreateDocument,
    getDocumentById: mockGetDocumentById,
    replaceDocumentChunks: mockReplaceDocumentChunks,
    updateDocumentMetadata: mockUpdateDocumentMetadata,
    deprecateSupersededDocuments: mockDeprecateSupersededDocuments,
    touchProjectKnowledgeRevision: mockTouchProjectKnowledgeRevision,
  }),
}));

vi.mock("../services/knowledge-embeddings.js", () => ({
  knowledgeEmbeddingService: () => ({
    isConfigured: mockIsConfigured,
    generateEmbeddings: mockGenerateEmbeddings,
  }),
}));

import { organizationalMemoryService } from "../services/organizational-memory-ingest.js";

function shiftTableRows(queueMap: Map<unknown, unknown[][]>, table: unknown) {
  const queue = queueMap.get(table);
  return queue?.shift() ?? [];
}

function createResolvedSelectChain(selectRows: Map<unknown, unknown[][]>) {
  let selectedTable: unknown = null;
  const chain = {
    from: (table: unknown) => {
      selectedTable = table;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    innerJoin: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(shiftTableRows(selectRows, selectedTable)).then(resolve),
  };
  return chain;
}

function createMutationResult(updateSets: Array<{ table: unknown; value: unknown }>, table: unknown, value: unknown) {
  updateSets.push({ table, value });
  return {
    where: async () => [],
  };
}

function createOrganizationalMemoryDbMock(input?: {
  selectRows?: Map<unknown, unknown[][]>;
  executeRows?: unknown[][];
}) {
  const selectRows = input?.selectRows ?? new Map();
  const executeRows = [...(input?.executeRows ?? [])];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];
  const db = {
    select: () => createResolvedSelectChain(selectRows),
    update: (table: unknown) => ({
      set: (value: unknown) => createMutationResult(updateSets, table, value),
    }),
    execute: async () => executeRows.shift() ?? [],
  };
  return { db, updateSets };
}

describe("organizational memory service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateDocument.mockResolvedValue({
      id: "doc-1",
      metadata: { existing: true },
    });
    mockGetDocumentById.mockResolvedValue({
      id: "doc-1",
      metadata: { existing: true },
    });
    mockReplaceDocumentChunks.mockResolvedValue([]);
    mockUpdateDocumentMetadata.mockResolvedValue(null);
    mockDeprecateSupersededDocuments.mockResolvedValue(null);
    mockTouchProjectKnowledgeRevision.mockResolvedValue(null);
    mockIsConfigured.mockReturnValue(false);
    mockGenerateEmbeddings.mockResolvedValue({
      embeddings: [[0.1, 0.2]],
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      usage: { totalTokens: 42 },
    });
  });

  it("ingests issue snapshots into canonical organizational-memory documents", async () => {
    const { db, updateSets } = createOrganizationalMemoryDbMock({
      selectRows: new Map([
        [issues, [[{
          id: "issue-1",
          companyId: "company-1",
          issueNumber: 1,
          identifier: "CLO-1",
          parentId: null,
          projectId: "project-1",
          goalId: null,
          title: "Stabilize runtime recovery",
          description: "Need durable issue snapshots.",
          status: "in_progress",
          priority: "high",
          assigneeAgentId: null,
          assigneeUserId: null,
          requestDepth: 0,

          createdAt: new Date("2026-03-13T08:00:00.000Z"),
          updatedAt: new Date("2026-03-13T09:00:00.000Z"),
          completedAt: null,
          cancelledAt: null,
        }]]],
        [projects, [[{ name: "Runtime" }]]],
        [issueProtocolState, [[{ workflowState: "implementing" }]]],
        [issueLabels, [[
          { name: "priority:high", color: "#ef4444" },
          { name: "backend", color: "#0ea5e9" },
        ]]],
      ]),
      executeRows: [[
        { status: "todo", count: 1 },
        { status: "in_review", count: 2 },
      ]],
    });
    const service = organizationalMemoryService(db as never);

    const result = await service.ingestIssueSnapshot({
      issueId: "issue-1",
      mutation: "update",
    });

    expect(result).toEqual({
      issueId: "issue-1",
      documentId: "doc-1",
      sourceType: "issue",
      path: "issues/CLO-1/issue.md",
    });
    expect(mockCreateDocument).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "issue",
      authorityLevel: "canonical",
      path: "issues/CLO-1/issue.md",
      metadata: expect.objectContaining({
        artifactKind: "issue_snapshot",
        workflowState: "implementing",
        labels: ["priority:high", "backend"],
      }),
    }));
    expect(updateSets.find((entry) => entry.table === knowledgeDocuments)?.value).toMatchObject({
      authorityLevel: "canonical",
      issueId: "issue-1",
      metadata: expect.objectContaining({
        isLatestForScope: true,
      }),
    });
    const issueChunksInput = mockReplaceDocumentChunks.mock.calls[0]?.[0];
    expect(issueChunksInput).toMatchObject({
      companyId: "company-1",
      documentId: "doc-1",
    });
    expect(issueChunksInput?.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            organizationalMemory: true,
            embeddingOrigin: "not_configured",
          }),
        }),
      ]),
    );
    expect(mockTouchProjectKnowledgeRevision).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      metadata: expect.objectContaining({
        sourceType: "issue",
        issueId: "issue-1",
      }),
    }));
  });

  it("ingests review protocol messages with changed-path and related-issue links", async () => {
    mockIsConfigured.mockReturnValue(true);
    const { db } = createOrganizationalMemoryDbMock({
      selectRows: new Map([
        [issueProtocolMessages, [[{
          id: "message-1",
          companyId: "company-1",
          issueId: "issue-1",
          seq: 7,
          messageType: "REQUEST_CHANGES",
          senderActorType: "agent",
          senderActorId: "reviewer-1",
          senderRole: "reviewer",
          workflowStateBefore: "under_review",
          workflowStateAfter: "changes_requested",
          summary: "Need stronger test evidence.",
          payload: {
            reviewSummary: "Please add failure-path coverage.",
            changedFiles: ["./src/runtime.ts"],
            followUpIssueIds: ["issue-2"],
            changeRequests: [
              {
                affectedFiles: ["src/fallback.ts"],
              },
            ],
          },
          createdAt: new Date("2026-03-13T10:00:00.000Z"),
        }]]],
        [issues, [[{
          id: "issue-1",
          companyId: "company-1",
          identifier: "CLO-1",
          title: "Stabilize runtime recovery",
          projectId: "project-1",
        }]]],
        [projects, [[{ name: "Runtime" }]]],
        [issueProtocolRecipients, [[{
          recipientType: "agent",
          recipientId: "engineer-1",
          recipientRole: "engineer",
        }]]],
        [issueProtocolArtifacts, [[{
          artifactKind: "diff",
          artifactUri: "run://diff",
          label: "Workspace diff",
          metadata: {},
        }]]],
      ]),
    });
    const service = organizationalMemoryService(db as never);

    const result = await service.ingestProtocolMessage({
      messageId: "message-1",
    });

    expect(result).toEqual({
      issueId: "issue-1",
      messageId: "message-1",
      documentId: "doc-1",
      sourceType: "review",
      path: "issues/CLO-1/review/0007-request-changes.md",
    });
    expect(mockCreateDocument).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "review",
      authorityLevel: "canonical",
      metadata: expect.objectContaining({
        linkedIssueIds: ["issue-2"],
        changedPaths: ["src/runtime.ts", "src/fallback.ts"],
      }),
    }));
    const reviewChunksInput = mockReplaceDocumentChunks.mock.calls[0]?.[0];
    expect(reviewChunksInput).toMatchObject({
      companyId: "company-1",
      documentId: "doc-1",
    });
    expect(reviewChunksInput?.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          embedding: [0.1, 0.2],
        }),
      ]),
    );
    expect(
      reviewChunksInput?.chunks.some((chunk: { links?: Array<{ entityType: string; entityId: string }> }) =>
        (chunk.links ?? []).some((link) => link.entityType === "path" && link.entityId === "src/runtime.ts"),
      ),
    ).toBe(true);
    expect(
      reviewChunksInput?.chunks.some((chunk: { links?: Array<{ entityType: string; entityId: string }> }) =>
        (chunk.links ?? []).some((link) => link.entityType === "issue" && link.entityId === "issue-2"),
      ),
    ).toBe(true);
    expect(mockDeprecateSupersededDocuments).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "review",
      keepDocumentId: "doc-1",
    }));
  });
});
