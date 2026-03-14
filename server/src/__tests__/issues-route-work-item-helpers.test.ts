import { describe, expect, it, vi } from "vitest";
import {
  assertActiveCompanyAgentHelper,
  assertInternalWorkItemAssigneeHelper,
  assertInternalWorkItemLeadSupervisorHelper,
  assertInternalWorkItemQaHelper,
  assertInternalWorkItemReviewerHelper,
  buildInternalWorkItemLabelNames,
  buildPmProjectionRootDescription,
  buildTaskAssignmentSenderHelper,
  replaceMarkedSection,
} from "../routes/issues.js";

function createAgentsSvc(rows: Record<string, Record<string, unknown> | null>) {
  return {
    getById: vi.fn(async (id: string) => rows[id] ?? null),
  };
}

describe("issue route work item helpers", () => {
  it("validates active company agents and protocol-capable assignee/reviewer/qa/lead roles", async () => {
    const agentsSvc = createAgentsSvc({
      "eng-1": {
        id: "eng-1",
        companyId: "company-1",
        name: "Engineer One",
        role: "engineer",
        title: null,
        status: "active",
        reportsTo: null,
      },
      "lead-1": {
        id: "lead-1",
        companyId: "company-1",
        name: "Lead One",
        role: "manager",
        title: "Tech Lead",
        status: "active",
        reportsTo: null,
      },
      "review-1": {
        id: "review-1",
        companyId: "company-1",
        name: "Reviewer One",
        role: "qa",
        title: null,
        status: "active",
        reportsTo: null,
      },
      "qa-1": {
        id: "qa-1",
        companyId: "company-1",
        name: "QA One",
        role: "qa",
        title: null,
        status: "active",
        reportsTo: null,
      },
      "pending-1": {
        id: "pending-1",
        companyId: "company-1",
        name: "Pending One",
        role: "engineer",
        status: "pending_approval",
        reportsTo: null,
      },
      "terminated-1": {
        id: "terminated-1",
        companyId: "company-1",
        name: "Terminated One",
        role: "engineer",
        status: "terminated",
        reportsTo: null,
      },
    });

    await expect(assertActiveCompanyAgentHelper({
      agentsSvc,
      companyId: "company-1",
      agentId: "missing",
      label: "Assignee",
    })).rejects.toThrow("Assignee agent not found");

    await expect(assertActiveCompanyAgentHelper({
      agentsSvc,
      companyId: "company-1",
      agentId: "pending-1",
      label: "Reviewer",
    })).rejects.toThrow("Cannot assign reviewer to pending approval agents");

    await expect(assertActiveCompanyAgentHelper({
      agentsSvc,
      companyId: "company-1",
      agentId: "terminated-1",
      label: "QA",
    })).rejects.toThrow("Cannot assign qa to terminated agents");

    await expect(assertInternalWorkItemAssigneeHelper({
      agentsSvc,
      companyId: "company-1",
      assigneeAgentId: "lead-1",
    })).rejects.toThrow("Assignee agent must support engineer protocol role");
    await expect(assertInternalWorkItemAssigneeHelper({
      agentsSvc,
      companyId: "company-1",
      assigneeAgentId: "eng-1",
    })).resolves.toMatchObject({
      protocolRole: "engineer",
    });
    await expect(assertInternalWorkItemReviewerHelper({
      agentsSvc,
      companyId: "company-1",
      reviewerAgentId: "review-1",
    })).resolves.toMatchObject({
      id: "review-1",
    });
    await expect(assertInternalWorkItemQaHelper({
      agentsSvc,
      companyId: "company-1",
      qaAgentId: "qa-1",
    })).resolves.toMatchObject({
      id: "qa-1",
    });
    await expect(assertInternalWorkItemLeadSupervisorHelper({
      agentsSvc,
      companyId: "company-1",
      techLeadAgentId: "lead-1",
    })).resolves.toMatchObject({
      id: "lead-1",
    });
  });

  it("builds task assignment senders for board, cto, pm, and tech lead actors", async () => {
    const agentsSvc = createAgentsSvc({
      "cto-1": {
        id: "cto-1",
        companyId: "company-1",
        name: "CTO One",
        role: "cto",
        title: null,
        status: "active",
        reportsTo: null,
      },
      "pm-1": {
        id: "pm-1",
        companyId: "company-1",
        name: "PM One",
        role: "pm",
        title: null,
        status: "active",
        reportsTo: null,
      },
      "lead-1": {
        id: "lead-1",
        companyId: "company-1",
        name: "Lead One",
        role: "manager",
        title: "Tech Lead",
        status: "active",
        reportsTo: null,
      },
      "eng-1": {
        id: "eng-1",
        companyId: "company-1",
        name: "Engineer One",
        role: "engineer",
        title: null,
        status: "active",
        reportsTo: null,
      },
    });

    await expect(buildTaskAssignmentSenderHelper({
      actor: {
        type: "board",
        source: "local_implicit",
        userId: "user-1",
        isInstanceAdmin: false,
      } as never,
      actorInfo: { actorType: "user", actorId: "user-1" } as never,
      companyId: "company-1",
      agentsSvc,
    })).resolves.toEqual({
      actorType: "user",
      actorId: "user-1",
      role: "human_board",
    });

    await expect(buildTaskAssignmentSenderHelper({
      actor: { type: "agent", agentId: "cto-1" } as never,
      actorInfo: { actorType: "agent", actorId: "cto-1" } as never,
      companyId: "company-1",
      agentsSvc,
    })).resolves.toEqual({
      actorType: "agent",
      actorId: "cto-1",
      role: "cto",
    });

    await expect(buildTaskAssignmentSenderHelper({
      actor: { type: "agent", agentId: "pm-1" } as never,
      actorInfo: { actorType: "agent", actorId: "pm-1" } as never,
      companyId: "company-1",
      agentsSvc,
    })).resolves.toEqual({
      actorType: "agent",
      actorId: "pm-1",
      role: "pm",
    });

    await expect(buildTaskAssignmentSenderHelper({
      actor: { type: "agent", agentId: "lead-1" } as never,
      actorInfo: { actorType: "agent", actorId: "lead-1" } as never,
      companyId: "company-1",
      agentsSvc,
    })).resolves.toEqual({
      actorType: "agent",
      actorId: "lead-1",
      role: "tech_lead",
    });

    await expect(buildTaskAssignmentSenderHelper({
      actor: { type: "agent", agentId: "eng-1" } as never,
      actorInfo: { actorType: "agent", actorId: "eng-1" } as never,
      companyId: "company-1",
      agentsSvc,
    })).rejects.toThrow("Agent cannot create internal work items through protocol assignment");
  });

  it("builds work item labels and replaces PM projection sections deterministically", () => {
    expect(buildInternalWorkItemLabelNames({
      kind: "implementation",
    })).toEqual([
      "team:internal",
      "work:implementation",
      "watch:reviewer",
      "watch:lead",
    ]);
    expect(buildInternalWorkItemLabelNames({
      kind: "qa",
      watchReviewer: false,
      watchLead: false,
    })).toEqual([
      "team:internal",
      "work:qa",
    ]);

    const replaced = replaceMarkedSection({
      description: "before\n\n<!-- squadrail:intake-projection:start -->\nold\n<!-- squadrail:intake-projection:end -->\n",
      content: "new section",
    });
    expect(replaced).toContain("before");
    expect(replaced).toContain("new section");
    expect(replaced).not.toContain("old");
  });

  it("renders PM projection root descriptions with optional sections", () => {
    const description = buildPmProjectionRootDescription({
      requestDescription: "Original request",
      projectName: "Retry API",
      techLeadName: "TL One",
      reviewerName: "Reviewer One",
      qaName: "QA One",
      root: {
        executionSummary: "Implement retry and verify backoff.",
        acceptanceCriteria: ["Retries exponential backoff", "Errors logged"],
        definitionOfDone: ["Code merged", "QA approved"],
        risks: ["Timeout tuning"],
        openQuestions: ["Should we cap retries?"],
        documentationDebt: ["Update runbook"],
      },
    });

    expect(description).toContain("## Intake Structuring Snapshot");
    expect(description).toContain("- Routed to TL: TL One");
    expect(description).toContain("### Risks");
    expect(description).toContain("### Open Questions");
    expect(description).toContain("### Documentation Debt");
    expect(description).toContain("<!-- squadrail:intake-projection:start -->");
  });
});
