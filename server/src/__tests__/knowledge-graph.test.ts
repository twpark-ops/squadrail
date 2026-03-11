import { describe, expect, it } from "vitest";
import { buildKnowledgeGraphView } from "../services/knowledge.js";

describe("knowledge graph view helper", () => {
  it("builds project, document, and entity nodes from a graph slice", () => {
    const graph = buildKnowledgeGraphView({
      companyId: "company-1",
      projects: [
        {
          projectId: "project-1",
          projectName: "Workspace Core",
          documentCount: 2,
          linkCount: 5,
        },
      ],
      documents: [
        {
          documentId: "doc-1",
          projectId: "project-1",
          projectName: "Workspace Core",
          title: "session-resume.ts",
          path: "src/session-resume.ts",
          sourceType: "code",
          authorityLevel: "workspace",
          language: "ts",
          chunkCount: 3,
          linkCount: 4,
        },
      ],
      entityEdges: [
        {
          documentId: "doc-1",
          entityType: "symbol",
          entityId: "resumeSession",
          weight: 3,
        },
        {
          documentId: "doc-1",
          entityType: "path",
          entityId: "src/session-resume.ts",
          weight: 1,
        },
      ],
      generatedAt: "2026-03-12T00:00:00.000Z",
    });

    expect(graph.summary).toEqual({
      projectNodeCount: 1,
      documentNodeCount: 1,
      entityNodeCount: 2,
      edgeCount: 3,
    });
    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "project:project-1",
        "document:doc-1",
        "entity:symbol:resumeSession",
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "project:project-1",
          to: "document:doc-1",
          kind: "project_document",
        }),
        expect.objectContaining({
          from: "document:doc-1",
          to: "entity:symbol:resumeSession",
          kind: "document_entity",
          weight: 3,
        }),
      ]),
    );
  });
});
