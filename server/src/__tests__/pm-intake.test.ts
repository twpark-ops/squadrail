import { describe, expect, it } from "vitest";
import {
  buildPmIntakeProjectionPreview,
  buildPmIntakeAssignment,
  buildPmIntakeIssueDescription,
  derivePmIntakeIssueTitle,
  resolvePmIntakeAgents,
} from "../services/pm-intake.js";

describe("pm intake helpers", () => {
  const agents = [
    {
      id: "pm-1",
      companyId: "company-1",
      name: "SwiftSight PM",
      role: "pm",
      status: "active",
      reportsTo: null,
      title: "PM",
    },
    {
      id: "qa-1",
      companyId: "company-1",
      name: "QA Lead",
      role: "qa",
      status: "active",
      reportsTo: null,
      title: "QA Lead",
    },
    {
      id: "tl-1",
      companyId: "company-1",
      name: "Cloud TL",
      role: "manager",
      status: "active",
      reportsTo: null,
      title: "Tech Lead",
    },
  ] as any[];

  it("prefers the active PM and QA lead by default", () => {
    const resolved = resolvePmIntakeAgents({ agents });
    expect(resolved.pmAgent.id).toBe("pm-1");
    expect(resolved.reviewerAgent.id).toBe("qa-1");
  });

  it("accepts a dedicated reviewer role for intake routing", () => {
    const resolved = resolvePmIntakeAgents({
      agents: [
        agents[0],
        {
          id: "rev-1",
          companyId: "company-1",
          name: "Dedicated Reviewer",
          role: "reviewer",
          status: "active",
          reportsTo: null,
          title: "Reviewer",
        },
      ] as any[],
    });

    expect(resolved.reviewerAgent.id).toBe("rev-1");
  });

  it("derives a title from the request when one is not supplied", () => {
    expect(derivePmIntakeIssueTitle({
      request: "   Build a bulk export flow for cloud studies.\nNeed audit logs too.",
    })).toBe("Build a bulk export flow for cloud studies.");
  });

  it("builds a structured PM intake description", () => {
    const description = buildPmIntakeIssueDescription({
      request: "Add bulk export for cloud studies",
      projectName: "swiftsight-cloud",
      relatedIssueIdentifiers: ["CLO-12"],
    });
    expect(description).toContain("## Human Intake Request");
    expect(description).toContain("## Structuring Expectations");
    expect(description).toContain("swiftsight-cloud");
    expect(description).toContain("CLO-12");
  });

  it("builds an assignment payload that routes into the PM lane", () => {
    const assignment = buildPmIntakeAssignment({
      title: "Bulk export for cloud studies",
      priority: "high",
      pmAgentId: "pm-1",
      reviewerAgentId: "qa-1",
      requestedDueAt: "2026-03-12T00:00:00.000Z",
      relatedIssueIds: ["issue-1"],
      requiredKnowledgeTags: ["cloud", "export"],
    });
    expect(assignment.summary).toContain("PM intake");
    expect(assignment.payload.assigneeAgentId).toBe("pm-1");
    expect(assignment.payload.reviewerAgentId).toBe("qa-1");
    expect(assignment.payload.acceptanceCriteria).toHaveLength(3);
  });

  it("builds a projection preview with project-aware staffing and one execution work item", () => {
    const preview = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Tighten cloud export handoff",
        description: "## Human Intake Request\n\nTighten the swiftsight-cloud export handoff.\n- keep audit evidence explicit\n",
        priority: "high",
        projectId: null,
      },
      projects: [
        {
          id: "project-cloud",
          companyId: "company-1",
          name: "swiftsight-cloud",
          urlKey: "swiftsight-cloud",
          primaryWorkspace: {
            repoRef: "swiftsight-cloud",
            cwd: "/tmp/swiftsight-cloud",
          },
        },
      ],
      agents: [
        ...agents,
        {
          id: "eng-1",
          companyId: "company-1",
          name: "Cloud Engineer",
          urlKey: "swiftsight-cloud-engineer",
          role: "engineer",
          status: "active",
          reportsTo: "tl-1",
          title: "Engineer",
        },
      ],
      request: {},
    });

    expect(preview.selectedProjectId).toBe("project-cloud");
    expect(preview.staffing.techLeadAgentId).toBe("tl-1");
    expect(preview.staffing.implementationAssigneeAgentId).toBe("eng-1");
    expect(preview.draft.workItems).toHaveLength(1);
    expect(preview.draft.workItems[0]).toMatchObject({
      projectId: "project-cloud",
      assigneeAgentId: "eng-1",
      reviewerAgentId: "qa-1",
    });
  });

  it("prefers a dedicated reviewer role over non-reviewer managers", () => {
    const preview = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Tighten cloud export handoff",
        description: "## Human Intake Request\n\nTighten the swiftsight-cloud export handoff.\n",
        priority: "high",
        projectId: null,
      },
      projects: [
        {
          id: "project-cloud",
          companyId: "company-1",
          name: "swiftsight-cloud",
          urlKey: "swiftsight-cloud",
        },
      ],
      agents: [
        ...agents,
        {
          id: "mgr-1",
          companyId: "company-1",
          name: "Delivery Manager",
          urlKey: "swiftsight-manager",
          role: "manager",
          status: "active",
          reportsTo: null,
          title: "Manager",
        },
        {
          id: "rev-1",
          companyId: "company-1",
          name: "Dedicated Reviewer",
          urlKey: "swiftsight-reviewer",
          role: "reviewer",
          status: "active",
          reportsTo: null,
          title: "Reviewer",
        },
        {
          id: "eng-1",
          companyId: "company-1",
          name: "Cloud Engineer",
          urlKey: "swiftsight-cloud-engineer",
          role: "engineer",
          status: "active",
          reportsTo: "tl-1",
          title: "Engineer",
        },
      ],
      request: {
        qaAgentId: null,
      },
    });

    expect(preview.staffing.reviewerAgentId).toBe("rev-1");
    expect(preview.draft.workItems[0]?.reviewerAgentId).toBe("rev-1");
  });

  it("keeps child work items in coordination-only previews so preview/apply stay symmetric", () => {
    const preview = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Coordinate export delivery",
        description: "## Human Intake Request\n\nCoordinate export delivery across swiftsight-cloud.\n",
        priority: "high",
        projectId: null,
      },
      projects: [
        {
          id: "project-cloud",
          companyId: "company-1",
          name: "swiftsight-cloud",
          urlKey: "swiftsight-cloud",
        },
      ],
      agents: [
        ...agents,
        {
          id: "eng-1",
          companyId: "company-1",
          name: "Cloud Engineer",
          urlKey: "swiftsight-cloud-engineer",
          role: "engineer",
          status: "active",
          reportsTo: "tl-1",
          title: "Engineer",
        },
      ],
      request: {
        coordinationOnly: true,
      },
    });

    expect(preview.draft.coordinationOnly).toBe(true);
    expect(preview.draft.workItems).toHaveLength(1);
    expect(preview.draft.reason).toContain("without reassigning the root lane");
  });

  it("marks low-confidence project matches when the request text does not align with any project", () => {
    const preview = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "General intake",
        description: "## Human Intake Request\n\nPlease help with an ambiguous delivery request.\n",
        priority: "medium",
        projectId: null,
      },
      projects: [
        {
          id: "project-cloud",
          companyId: "company-1",
          name: "swiftsight-cloud",
        },
      ],
      agents,
      request: {},
    });

    expect(preview.warnings).toContain("project_match_low_confidence");
    expect(preview.draft.root.openQuestions).toContain(
      "Confirm the intended project if the selected preview does not match the request.",
    );
  });
});
