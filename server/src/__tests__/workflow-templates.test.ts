import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetupUpdate } = vi.hoisted(() => ({
  mockSetupUpdate: vi.fn(),
}));

vi.mock("../services/setup-progress.js", () => ({
  setupProgressService: () => ({
    update: mockSetupUpdate,
  }),
}));

import { workflowTemplateService } from "../services/workflow-templates.js";

function createDb(readState: () => { metadata: Record<string, unknown> | null; updatedAt: Date | null }) {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              const current = readState();
              return Promise.resolve(current.updatedAt
                ? [{ metadata: current.metadata, updatedAt: current.updatedAt }]
                : []);
            },
          };
        },
      };
    },
  } as any;
}

describe("workflow template service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges default templates with normalized company templates", async () => {
    const db = createDb(() => ({
      metadata: {
        workflowTemplates: [
          {
            id: "company-close-template",
            actionType: "CLOSE_TASK",
            label: "Release close",
            description: "Human-reviewed close",
            summary: "Board closed {issueIdentifier}",
            fields: {
              closureSummary: "Human-reviewed close",
            },
          },
          {
            id: "",
            actionType: "CLOSE_TASK",
            label: "invalid",
          },
        ],
      },
      updatedAt: new Date("2026-03-13T00:00:00.000Z"),
    }));

    const view = await workflowTemplateService(db).getView("company-1");

    expect(view.companyTemplates).toEqual([
      {
        id: "company-close-template",
        actionType: "CLOSE_TASK",
        label: "Release close",
        description: "Human-reviewed close",
        summary: "Board closed {issueIdentifier}",
        fields: {
          closureSummary: "Human-reviewed close",
        },
        scope: "company",
      },
    ]);
    expect(view.templates.some((template) => template.id === "default-close-task")).toBe(true);
    expect(view.templates.some((template) => template.id === "company-close-template")).toBe(true);
    expect(view.updatedAt).toEqual(new Date("2026-03-13T00:00:00.000Z"));
  });

  it("persists company templates through setup progress metadata", async () => {
    let metadata: Record<string, unknown> | null = null;
    let updatedAt: Date | null = null;
    mockSetupUpdate.mockImplementation(async (_companyId: string, patch: { metadata: Record<string, unknown> }) => {
      metadata = patch.metadata;
      updatedAt = new Date("2026-03-13T01:00:00.000Z");
    });

    const db = createDb(() => ({ metadata, updatedAt }));
    const service = workflowTemplateService(db);
    const view = await service.updateConfig("company-1", {
      templates: [
        {
          id: "company-assign-template",
          actionType: "ASSIGN_TASK",
          label: "Company assignment",
          description: null,
          summary: "Board assigned {issueIdentifier}",
          fields: {
            goal: "Ship the next slice",
          },
        },
      ],
    });

    expect(mockSetupUpdate).toHaveBeenCalledWith("company-1", {
      metadata: {
        workflowTemplates: [
          {
            id: "company-assign-template",
            actionType: "ASSIGN_TASK",
            label: "Company assignment",
            description: null,
            summary: "Board assigned {issueIdentifier}",
            fields: {
              goal: "Ship the next slice",
            },
          },
        ],
      },
    });
    expect(view.companyTemplates).toEqual([
      {
        id: "company-assign-template",
        actionType: "ASSIGN_TASK",
        label: "Company assignment",
        description: null,
        summary: "Board assigned {issueIdentifier}",
        fields: {
          goal: "Ship the next slice",
        },
        scope: "company",
      },
    ]);
  });
});
