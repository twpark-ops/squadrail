import { describe, expect, it } from "vitest";
import {
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
});
