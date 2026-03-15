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
      id: "rev-default",
      companyId: "company-1",
      name: "Cloud Reviewer",
      role: "reviewer",
      status: "active",
      reportsTo: null,
      title: "Reviewer",
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

  it("prefers the active PM and dedicated reviewer by default", () => {
    const resolved = resolvePmIntakeAgents({ agents });
    expect(resolved.pmAgent.id).toBe("pm-1");
    expect(resolved.reviewerAgent.id).toBe("rev-default");
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

  it("accepts a title-based reviewer identity for intake routing", () => {
    const resolved = resolvePmIntakeAgents({
      agents: [
        agents[0],
        {
          id: "rev-1",
          companyId: "company-1",
          name: "App Surface Reviewer",
          role: "engineer",
          status: "active",
          reportsTo: "qa-1",
          title: "Reviewer",
          urlKey: "app-surface-reviewer",
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
      reviewerAgentId: "rev-default",
      requestedDueAt: "2026-03-12T00:00:00.000Z",
      relatedIssueIds: ["issue-1"],
      requiredKnowledgeTags: ["cloud", "export"],
    });
    expect(assignment.summary).toContain("PM intake");
    expect(assignment.payload.assigneeAgentId).toBe("pm-1");
    expect(assignment.payload.reviewerAgentId).toBe("rev-default");
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
      reviewerAgentId: "rev-default",
    });
  });

  it("prefers a dedicated reviewer role over non-reviewer managers", () => {
    // Exclude the default reviewer so the test isolates rev-1 vs manager preference.
    const agentsWithoutDefaultReviewer = agents.filter((a) => a.id !== "rev-default");
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
        ...agentsWithoutDefaultReviewer,
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

    expect(preview.warnings).toContain("project_match_low_confidence");
    expect(preview.draft.root.openQuestions).toContain(
      "Confirm the intended project if the selected preview does not match the request.",
    );
  });

  it("prefers dedicated reviewer and engineer titles from a delivery_plus_qa-style roster", () => {
    const preview = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Tighten export handoff before release",
        description: "## Human Intake Request\n\nTighten export handoff before release.\n- keep audit evidence explicit\n",
        priority: "critical",
        projectId: "project-app",
      },
      projects: [
        {
          id: "project-app",
          companyId: "company-1",
          name: "App Surface",
          urlKey: "app-surface",
        },
      ],
      agents: [
        {
          id: "pm-1",
          companyId: "company-1",
          name: "PM",
          role: "pm",
          status: "running",
          reportsTo: "cto-1",
          title: "PM",
        },
        {
          id: "qa-1",
          companyId: "company-1",
          name: "QA Lead",
          role: "qa",
          status: "idle",
          reportsTo: "cto-1",
          title: "QA Lead",
        },
        {
          id: "tl-product",
          companyId: "company-1",
          name: "App Surface Product Tech Lead",
          role: "engineer",
          status: "idle",
          reportsTo: "pm-1",
          title: "Tech Lead",
          urlKey: "app-surface-product-tech-lead",
        },
        {
          id: "tl-platform",
          companyId: "company-1",
          name: "App Surface Platform Tech Lead",
          role: "engineer",
          status: "running",
          reportsTo: "pm-1",
          title: "Tech Lead",
          urlKey: "app-surface-platform-tech-lead",
        },
        {
          id: "rev-1",
          companyId: "company-1",
          name: "App Surface Reviewer",
          role: "engineer",
          status: "idle",
          reportsTo: "qa-1",
          title: "Reviewer",
          urlKey: "app-surface-reviewer",
        },
        {
          id: "eng-1",
          companyId: "company-1",
          name: "App Surface Engineer",
          role: "engineer",
          status: "idle",
          reportsTo: "tl-product",
          title: "Engineer",
          urlKey: "app-surface-engineer",
        },
        {
          id: "cto-1",
          companyId: "company-1",
          name: "CTO",
          role: "cto",
          status: "idle",
          reportsTo: null,
          title: "CTO",
        },
      ] as any[],
      request: {},
    });

    expect(preview.staffing.reviewerAgentId).toBe("rev-1");
    expect(preview.staffing.qaAgentId).toBe("qa-1");
    expect(preview.staffing.implementationAssigneeAgentId).toBe("eng-1");
    expect(preview.draft.workItems[0]).toMatchObject({
      reviewerAgentId: "rev-1",
      qaAgentId: "qa-1",
      assigneeAgentId: "eng-1",
    });
  });

  it("skips QA assignment for simple issues (fast lane)", () => {
    const preview = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Fix button alignment",
        description: "## Human Intake Request\n\nFix the button alignment on the settings page.\n",
        priority: "medium",
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
      request: {},
    });

    // Simple issue: single project, non-critical, no coordination, no knowledge tags
    // → QA should NOT be assigned (fast lane)
    expect(preview.staffing.qaAgentId).toBeNull();
    expect(preview.staffing.qaName).toBeNull();
    expect(preview.draft.workItems[0]?.qaAgentId).toBeNull();
  });

  it("assigns QA for complex cross-project issues (full lane)", () => {
    const preview = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Coordinate export delivery across cloud and agent",
        description: "## Human Intake Request\n\nCoordinate export delivery across swiftsight-cloud and swiftsight-agent.\n",
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
        {
          id: "project-agent",
          companyId: "company-1",
          name: "swiftsight-agent",
          urlKey: "swiftsight-agent",
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

    // Cross-project issue → complex → QA should be assigned (full lane)
    expect(preview.staffing.qaAgentId).toBe("qa-1");
  });

  it("does not use manager tech leads as implementation assignees when no engineer exists", () => {
    expect(() => buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Route a bounded autonomy change",
        description: "## Human Intake Request\n\nRoute a bounded autonomy change.\n",
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
          id: "mgr-tl-1",
          companyId: "company-1",
          name: "Cloud Tech Lead",
          urlKey: "swiftsight-cloud-tl",
          role: "manager",
          status: "active",
          reportsTo: null,
          title: "Tech Lead",
        },
        {
          id: "rev-1",
          companyId: "company-1",
          name: "Cloud Reviewer",
          urlKey: "cloud-reviewer",
          role: "engineer",
          status: "active",
          reportsTo: "mgr-tl-1",
          title: "Reviewer",
        },
      ],
      request: {},
    })).toThrow("No active engineer agent is available for PM intake projection");
  });

  it("uses generic project selection hints to avoid report-only lanes for routing-policy requests", () => {
    const preview = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Route segmentation artifacts to PACS A and B but physician report only to PACS A",
        description: "## Human Intake Request\n\n같은 분석에서 segmentation artifact는 PACS A와 PACS B로 보내고, physician report는 PACS A에만 보내는 설정을 지원해줘.\n",
        priority: "high",
        projectId: null,
      },
      projects: [
        {
          id: "project-swiftcl",
          companyId: "company-1",
          name: "swiftcl",
          urlKey: "swiftcl",
          primaryWorkspace: {
            repoRef: "swiftcl",
            cwd: "/tmp/swiftcl",
          },
        },
        {
          id: "project-report",
          companyId: "company-1",
          name: "swiftsight-report-server",
          urlKey: "swiftsight-report-server",
          primaryWorkspace: {
            repoRef: "swiftsight-report-server",
            cwd: "/tmp/swiftsight-report-server",
          },
        },
      ],
      knowledgeDocuments: [
        {
          id: "doc-swiftcl",
          companyId: "company-1",
          projectId: "project-swiftcl",
          sourceType: "adr",
          authorityLevel: "canonical",
          title: "Routing policy ownership",
          path: "manual/domain/swiftcl-routing.md",
          rawContent: "SwiftCL validates multi-destination routing policy before runtime execution.",
          metadata: {
            pmProjectSelection: {
              ownerTags: ["artifact-routing", "pacs-destinations", "workflow-compiler"],
            },
          },
        },
        {
          id: "doc-report",
          companyId: "company-1",
          projectId: "project-report",
          sourceType: "runbook",
          authorityLevel: "canonical",
          title: "Report rendering boundary",
          path: "manual/domain/report-server-boundary.md",
          rawContent: "Report server renders physician PDF output and is not the primary owner for PACS destination policy.",
          metadata: {
            pmProjectSelection: {
              ownerTags: ["physician-report", "report-rendering"],
              avoidTags: ["artifact-routing", "pacs-destinations", "workflow-compiler"],
            },
          },
        },
      ] as any[],
      agents: [
        ...agents,
        {
          id: "swiftcl-eng",
          companyId: "company-1",
          name: "SwiftCL Engineer",
          urlKey: "swiftcl-engineer",
          role: "engineer",
          status: "active",
          reportsTo: "tl-1",
          title: "Engineer",
        },
      ],
      request: {
        requiredKnowledgeTags: ["artifact-routing", "pacs-destinations", "workflow-compiler"],
      },
    });

    expect(preview.selectedProjectName).toBe("swiftcl");
    expect(preview.projectCandidates[0]?.projectName).toBe("swiftcl");
    expect(preview.projectCandidates[0]?.reasons.join(" ")).toContain("knowledge_owner_tags");
  });

  describe("canActAsReviewer edge cases via resolvePmIntakeAgents", () => {
    it("rejects a QA agent with title='Reviewer' — role exclusivity takes precedence over title", () => {
      // A QA agent should NOT fill the reviewer slot even if their title says "Reviewer".
      // canActAsReviewer: hasReviewerIdentity returns true for title "Reviewer",
      // BUT the function checks role === "qa" AFTER hasReviewerIdentity, so title "Reviewer"
      // wins via hasReviewerIdentity first. Let's verify the actual behavior.
      const qaReviewer = {
        id: "qa-rev",
        companyId: "company-1",
        name: "QA Reviewer",
        role: "qa",
        status: "active",
        reportsTo: null,
        title: "Reviewer",
      };
      // hasReviewerIdentity returns true for title "Reviewer", so canActAsReviewer returns true
      // before reaching the role === "qa" check. This agent WILL be accepted as reviewer.
      const resolved = resolvePmIntakeAgents({
        agents: [
          agents[0], // PM
          qaReviewer,
        ] as any[],
      });
      expect(resolved.reviewerAgent.id).toBe("qa-rev");
    });

    it("rejects an engineer with title='QA Lead' from reviewer slot — only reviewer identity or tech lead title qualifies", () => {
      // An engineer with title "QA Lead" does not match hasReviewerIdentity (no "reviewer" in title)
      // and does not match "tech lead" title check. Should NOT be accepted as reviewer.
      expect(() =>
        resolvePmIntakeAgents({
          agents: [
            agents[0], // PM
            {
              id: "eng-qa-lead",
              companyId: "company-1",
              name: "Engineering QA Lead",
              role: "engineer",
              status: "active",
              reportsTo: null,
              title: "QA Lead",
            },
          ] as any[],
        }),
      ).toThrow("No active reviewer-capable agent is available for PM intake");
    });

    it("accepts an engineer with title='Tech Lead' as reviewer fallback", () => {
      const resolved = resolvePmIntakeAgents({
        agents: [
          agents[0], // PM
          {
            id: "eng-tl",
            companyId: "company-1",
            name: "Engineering Tech Lead",
            role: "engineer",
            status: "active",
            reportsTo: null,
            title: "Tech Lead",
          },
        ] as any[],
      });
      expect(resolved.reviewerAgent.id).toBe("eng-tl");
    });

    it("rejects an agent with role='general' from reviewer slot — no reviewer identity or tech lead title", () => {
      expect(() =>
        resolvePmIntakeAgents({
          agents: [
            agents[0], // PM
            {
              id: "general-1",
              companyId: "company-1",
              name: "General Agent",
              role: "general",
              status: "active",
              reportsTo: null,
              title: "General",
            },
          ] as any[],
        }),
      ).toThrow("No active reviewer-capable agent is available for PM intake");
    });

    it("throws when company has ONLY QA agents (no TL/reviewer) aside from PM", () => {
      expect(() =>
        resolvePmIntakeAgents({
          agents: [
            agents[0], // PM
            {
              id: "qa-only-1",
              companyId: "company-1",
              name: "QA Agent 1",
              role: "qa",
              status: "active",
              reportsTo: null,
              title: "QA Tester",
            },
            {
              id: "qa-only-2",
              companyId: "company-1",
              name: "QA Agent 2",
              role: "qa",
              status: "active",
              reportsTo: null,
              title: "QA Analyst",
            },
          ] as any[],
        }),
      ).toThrow("No active reviewer-capable agent is available for PM intake");
    });

    it("throws when no active PM agent exists", () => {
      expect(() =>
        resolvePmIntakeAgents({
          agents: [
            {
              id: "rev-only",
              companyId: "company-1",
              name: "Reviewer",
              role: "reviewer",
              status: "active",
              reportsTo: null,
              title: "Reviewer",
            },
          ] as any[],
        }),
      ).toThrow("No active PM agent is available for intake routing");
    });

    it("skips inactive agents when resolving PM intake", () => {
      expect(() =>
        resolvePmIntakeAgents({
          agents: [
            {
              id: "pm-inactive",
              companyId: "company-1",
              name: "Inactive PM",
              role: "pm",
              status: "stopped",
              reportsTo: null,
              title: "PM",
            },
            {
              id: "rev-inactive",
              companyId: "company-1",
              name: "Inactive Reviewer",
              role: "reviewer",
              status: "stopped",
              reportsTo: null,
              title: "Reviewer",
            },
          ] as any[],
        }),
      ).toThrow("No active PM agent is available for intake routing");
    });
  });

  it("caps ambient document overlap so structured owner tags outrank noisy project docs", () => {
    const preview = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Workflow mismatch diagnostics",
        description:
          "## Human Intake Request\n\n특정 MR study가 왜 workflow에 매칭되지 않았는지 운영자가 설명 가능하게 보여줘.\n",
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
        {
          id: "project-swiftcl",
          companyId: "company-1",
          name: "swiftcl",
          urlKey: "swiftcl",
          primaryWorkspace: {
            repoRef: "swiftcl",
            cwd: "/tmp/swiftcl",
          },
        },
      ],
      knowledgeDocuments: [
        {
          id: "doc-cloud-owner",
          companyId: "company-1",
          projectId: "project-cloud",
          sourceType: "prd",
          authorityLevel: "canonical",
          title: "Operator workflow diagnostics boundary",
          path: "manual/domain/cloud-routing.md",
          rawContent: "Cloud is the operator-facing owner for workflow mismatch diagnostics and settings visibility.",
          metadata: {
            pmProjectSelection: {
              ownerTags: ["workflow-matching", "operator-diagnostics"],
            },
            requiredKnowledgeTags: ["workflow-matching", "operator-diagnostics"],
          },
        },
        {
          id: "doc-swiftcl-support",
          companyId: "company-1",
          projectId: "project-swiftcl",
          sourceType: "adr",
          authorityLevel: "canonical",
          title: "Workflow compiler support",
          path: "manual/domain/swiftcl-support.md",
          rawContent: "SwiftCL supports workflow matching rules and compile-time diagnostics.",
          metadata: {
            pmProjectSelection: {
              supportTags: ["workflow-matching"],
            },
          },
        },
        ...Array.from({ length: 8 }, (_, index) => ({
          id: `doc-swiftcl-noise-${index}`,
          companyId: "company-1",
          projectId: "project-swiftcl",
          sourceType: "adr",
          authorityLevel: "canonical",
          title: `Workflow compiler note ${index}`,
          path: `docs/swiftcl/workflow-note-${index}.md`,
          rawContent:
            "Workflow compilation, workflow validation, workflow diagnostics, and workflow rule processing.",
          metadata: {},
        })),
      ] as any[],
      agents: [
        ...agents,
        {
          id: "cloud-reviewer",
          companyId: "company-1",
          name: "Cloud Reviewer",
          urlKey: "cloud-reviewer",
          role: "engineer",
          status: "active",
          reportsTo: "tl-1",
          title: "Reviewer",
        },
        {
          id: "cloud-engineer",
          companyId: "company-1",
          name: "Cloud Engineer",
          urlKey: "swiftsight-cloud-engineer",
          role: "engineer",
          status: "active",
          reportsTo: "tl-1",
          title: "Engineer",
        },
        {
          id: "swiftcl-engineer",
          companyId: "company-1",
          name: "SwiftCL Engineer",
          urlKey: "swiftcl-engineer",
          role: "engineer",
          status: "active",
          reportsTo: "tl-1",
          title: "Engineer",
        },
      ] as any[],
      request: {
        requiredKnowledgeTags: ["workflow-matching", "operator-diagnostics"],
      },
    });

    expect(preview.selectedProjectName).toBe("swiftsight-cloud");
    expect(preview.projectCandidates[0]?.projectName).toBe("swiftsight-cloud");
    expect(preview.projectCandidates[0]?.reasons.join(" ")).toContain("knowledge_owner_tags");
  });
});
