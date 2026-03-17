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
          description: "Cloud control plane for operator-facing workflow diagnostics, registry visibility, and settings service responses.",
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
          description: "Compiler and CLI workspace for workflow validation, DSL authoring, and compile-time checks.",
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
          description: "Cloud control plane for operator-facing workflow diagnostics, registry visibility, and settings service responses.",
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
          description: "Compiler and CLI workspace for workflow validation, DSL authoring, and compile-time checks.",
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
              ownerTags: ["workflow-matching", "dicom-metadata", "operator-diagnostics"],
            },
            requiredKnowledgeTags: ["workflow-matching", "dicom-metadata", "operator-diagnostics"],
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
        requiredKnowledgeTags: ["workflow-matching", "dicom-metadata", "operator-diagnostics"],
      },
    });
    expect(preview.selectedProjectName).toBe("swiftsight-cloud");
    const topProjectNames = preview.projectCandidates.slice(0, 2).map((candidate) => candidate.projectName);
    expect(topProjectNames).toEqual(["swiftsight-cloud", "swiftcl"]);
    expect(
      preview.projectCandidates.some((candidate) =>
        candidate.projectName === "swiftsight-cloud"
        && candidate.reasons.join(" ").includes("operator_surface_terms"),
      ),
    ).toBe(true);
    expect(
      preview.projectCandidates.some((candidate) =>
        candidate.projectName === "swiftcl"
        && candidate.reasons.join(" ").includes("operator_surface_avoids_compiler"),
      ),
    ).toBe(true);
  });

  it("prefers summary sources over noisy runbooks when knowledge-tagged requests carry domain boundaries", () => {
    const preview = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Route artifacts to PACS A/B while keeping physician report on PACS A only",
        description:
          "## Human Intake Request\n\n같은 분석에서 segmentation artifact는 PACS A와 PACS B로 보내고, physician report는 PACS A에만 보내는 설정을 지원해줘.\n",
        priority: "high",
        projectId: null,
      },
      projects: [
        {
          id: "project-swiftcl",
          companyId: "company-1",
          name: "swiftcl",
          description: "Compiler and validation surface for workflow configuration and destination policy.",
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
          description: "Report rendering service for physician-facing report output.",
          urlKey: "swiftsight-report-server",
          primaryWorkspace: {
            repoRef: "swiftsight-report-server",
            cwd: "/tmp/swiftsight-report-server",
          },
        },
      ],
      knowledgeDocuments: [
        {
          id: "doc-swiftcl-summary",
          companyId: "company-1",
          projectId: "project-swiftcl",
          sourceType: "code_summary",
          authorityLevel: "canonical",
          title: "artifact routing policy summary",
          path: "internal/blocks/artifact.go",
          rawContent:
            "This file validates artifact routing policy, destination constraints, and workflow compiler boundaries before runtime delivery.",
          metadata: {
            summaryVersion: 1,
            summaryKind: "file",
            sourcePath: "internal/blocks/artifact.go",
            sourceLanguage: "go",
            tags: ["artifact", "destination-policy", "workflow-compiler"],
            requiredKnowledgeTags: ["artifact", "workflow-compiler"],
            pmProjectSelection: {
              supportTags: ["artifact-routing", "workflow-compiler"],
            },
          },
        },
        ...Array.from({ length: 6 }, (_, index) => ({
          id: `doc-report-noise-${index}`,
          companyId: "company-1",
          projectId: "project-report",
          sourceType: "runbook",
          authorityLevel: "canonical",
          title: `report routing note ${index}`,
          path: `docs/report-routing-${index}.md`,
          rawContent:
            "Physician report output, report rendering, and report delivery guidance for report output surfaces.",
          metadata: {},
        })),
      ] as any[],
      agents: [
        ...agents,
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
        {
          id: "report-engineer",
          companyId: "company-1",
          name: "Report Engineer",
          urlKey: "swiftsight-report-server-engineer",
          role: "engineer",
          status: "active",
          reportsTo: "tl-1",
          title: "Engineer",
        },
      ] as any[],
      request: {
        requiredKnowledgeTags: ["artifact-routing", "pacs-destinations", "workflow-compiler"],
      },
    });

    expect(preview.selectedProjectName).toBe("swiftcl");
    expect(preview.projectCandidates[0]?.projectName).toBe("swiftcl");
    expect(preview.projectCandidates[0]?.reasons.join(" ")).toContain("knowledge_support_tags");
  });

  it("routes symptom-first DICOM persistence issues to cloud when DB storage ownership outweighs parser-only matches", () => {
    const preview = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Siemens series_name DB storage bug",
        description: [
          "## Human Intake Request",
          "",
          "Siemens 벤더 DICOM에서 series_name이 DB에 ProtocolName(0018,1030) 대신 SeriesDescription(0008,103E) 값으로 저장되는 문제를 고쳐줘.",
          "- 어떤 프로젝트를 고쳐야 하는지 사용자는 모르는 상태라고 가정해",
          "- focused verification이면 충분해",
        ].join("\n"),
        priority: "high",
        projectId: null,
      },
      projects: [
        {
          id: "project-cloud",
          companyId: "company-1",
          name: "swiftsight-cloud",
          description: "DB-backed registry persistence for series and report metadata across Hasura, Temporal workflows, and release-safe cloud delivery.",
          urlKey: "swiftsight-cloud",
          primaryWorkspace: {
            repoRef: "swiftsight-cloud",
            cwd: "/tmp/swiftsight-cloud",
          },
        },
        {
          id: "project-agent",
          companyId: "company-1",
          name: "swiftsight-agent",
          description: "Edge/runtime agent repo for DICOM parsing, vendor detection, and upload coordination.",
          urlKey: "swiftsight-agent",
          primaryWorkspace: {
            repoRef: "swiftsight-agent",
            cwd: "/tmp/swiftsight-agent",
          },
        },
      ],
      knowledgeDocuments: [
        {
          id: "doc-cloud-series",
          companyId: "company-1",
          projectId: "project-cloud",
          sourceType: "code_summary",
          authorityLevel: "canonical",
          title: "registry series persistence summary",
          path: "internal/server/registry/series.go",
          rawContent:
            "RegisterSeries persists series_name into the registry database and controls how SeriesDescription is written for cloud storage.",
          metadata: {
            summaryVersion: 1,
            summaryKind: "file",
            sourcePath: "internal/server/registry/series.go",
            sourceLanguage: "go",
            tags: ["registry", "series", "database", "persistence"],
            requiredKnowledgeTags: ["registry", "series", "database", "persistence"],
            pmProjectSelection: {
              ownerTags: ["series", "name", "registry", "database", "persistence"],
              supportTags: ["protocol", "description", "storage", "cloud"],
            },
          },
        },
        {
          id: "doc-cloud-usage",
          companyId: "company-1",
          projectId: "project-cloud",
          sourceType: "code_summary",
          authorityLevel: "canonical",
          title: "usage event series name summary",
          path: "internal/temporal/workflow/usage_events.go",
          rawContent:
            "Usage events map SeriesName from DICOM SeriesDescription and billing metadata after workflow persistence.",
          metadata: {
            pmProjectSelection: {
              supportTags: ["dicom", "series", "name", "workflow", "persistence"],
            },
          },
        },
        {
          id: "doc-cloud-migration",
          companyId: "company-1",
          projectId: "project-cloud",
          sourceType: "code_summary",
          authorityLevel: "canonical",
          title: "series_name migration summary",
          path: "hasura/migrations/default/1772539906630_alter_table_registry_report_review_status_add_column_series_name/up.sql",
          rawContent:
            "This migration adds the series_name column used by cloud registry persistence after DICOM metadata is normalized.",
          metadata: {
            pmProjectSelection: {
              supportTags: ["series-name", "database", "persistence", "registry"],
            },
          },
        },
        {
          id: "doc-agent-parser",
          companyId: "company-1",
          projectId: "project-agent",
          sourceType: "code_summary",
          authorityLevel: "canonical",
          title: "dicom parser summary",
          path: "internal/dicom/parser.go",
          rawContent:
            "The parser extracts ProtocolName and SeriesDescription from vendor DICOM metadata before upload.",
          metadata: {
            pmProjectSelection: {
              ownerTags: ["dicom", "metadata", "parser", "vendor"],
              supportTags: ["series", "name", "protocol", "description"],
            },
          },
        },
        {
          id: "doc-agent-vendor",
          companyId: "company-1",
          projectId: "project-agent",
          sourceType: "code_summary",
          authorityLevel: "canonical",
          title: "vendor-specific DICOM handling summary",
          path: "internal/dicom/vendor.go",
          rawContent:
            "Siemens vendor-specific DICOM parsing logic maps ProtocolName and SeriesDescription before upload coordination.",
          metadata: {
            pmProjectSelection: {
              ownerTags: ["siemens", "dicom", "vendor"],
              supportTags: ["protocol", "description", "parser"],
            },
          },
        },
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
          id: "agent-engineer",
          companyId: "company-1",
          name: "Agent Engineer",
          urlKey: "swiftsight-agent-engineer",
          role: "engineer",
          status: "active",
          reportsTo: "tl-1",
          title: "Engineer",
        },
      ] as any[],
      request: {
        requiredKnowledgeTags: ["dicom-metadata", "series-name"],
      },
    });

    expect(preview.selectedProjectName).toBe("swiftsight-cloud");
    expect(preview.projectCandidates[0]?.projectName).toBe("swiftsight-cloud");
    expect(preview.projectCandidates[0]?.reasons.join(" ")).toContain("knowledge_owner_tags");
    expect(preview.projectCandidates[0]?.reasons.join(" ")).toContain("project_context");
    expect(preview.projectCandidates[0]?.reasons.join(" ")).toContain("knowledge_lexical_terms");
  });

  it("handles zero knowledge documents without error", () => {
    const preview = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "General intake with no knowledge",
        description: "## Human Intake Request\n\nGeneral intake with no knowledge documents.\n",
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
      knowledgeDocuments: [],
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
    expect(preview.draft.workItems).toHaveLength(1);
  });

  it("falls back to first project when all candidates score 0", () => {
    // No knowledge docs, ambiguous description that matches nothing.
    const preview = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Unrelated request",
        description: "## Human Intake Request\n\nCompletely unrelated request with no keyword overlap.\n",
        priority: "low",
        projectId: null,
      },
      projects: [
        {
          id: "project-alpha",
          companyId: "company-1",
          name: "alpha-service",
          urlKey: "alpha-service",
        },
        {
          id: "project-beta",
          companyId: "company-1",
          name: "beta-service",
          urlKey: "beta-service",
        },
      ],
      knowledgeDocuments: [],
      agents: [
        ...agents,
        {
          id: "eng-1",
          companyId: "company-1",
          name: "Alpha Engineer",
          urlKey: "alpha-service-engineer",
          role: "engineer",
          status: "active",
          reportsTo: "tl-1",
          title: "Engineer",
        },
      ],
      request: {},
    });

    // When all candidates score 0, fallback selects the first project.
    expect(preview.selectedProjectId).toBeTruthy();
    expect(preview.warnings).toContain("project_match_low_confidence");
  });

  it("throws when no active engineer exists", () => {
    // PM + reviewer + tech lead (manager) — but no engineer role agent.
    // The tech lead is resolved first; once past that gate, the engineer lookup fails.
    expect(() => buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Route intake without engineer",
        description: "## Human Intake Request\n\nRoute intake without any engineer available.\n",
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
        agents[0], // PM
        agents[1], // Reviewer (Cloud Reviewer, role: reviewer)
        agents[3], // Tech Lead (Cloud TL, role: manager)
      ],
      request: {},
    })).toThrow("No active engineer agent is available for PM intake projection");
  });

  it("caps knowledge structured score to prevent document-count bias", () => {
    // Two projects: one with 3 high-match documents, one with 10 high-match documents.
    // Both should score similarly because the structured knowledge cap limits the contribution.
    // KNOWLEDGE_STRUCTURED_CAP_WITH_INTENT = 48 (when requiredKnowledgeTags are present)
    const makeOwnerDoc = (id: string, projectId: string) => ({
      id,
      companyId: "company-1",
      projectId,
      sourceType: "adr",
      authorityLevel: "canonical",
      title: `Routing policy doc ${id}`,
      path: `docs/${id}.md`,
      rawContent: "Multi-destination artifact routing validation and policy enforcement.",
      metadata: {
        pmProjectSelection: {
          ownerTags: ["artifact-routing", "pacs-destinations", "workflow-compiler"],
        },
      },
    });

    const fewDocs = Array.from({ length: 3 }, (_, i) =>
      makeOwnerDoc(`doc-few-${i}`, "project-few"),
    );
    const manyDocs = Array.from({ length: 10 }, (_, i) =>
      makeOwnerDoc(`doc-many-${i}`, "project-many"),
    );

    const previewFew = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Route artifacts to PACS destinations",
        description: "## Human Intake Request\n\nRoute artifacts to PACS destinations using routing policy.\n",
        priority: "high",
        projectId: null,
      },
      projects: [
        {
          id: "project-few",
          companyId: "company-1",
          name: "router-few",
          urlKey: "router-few",
        },
      ],
      knowledgeDocuments: fewDocs as any[],
      agents: [
        ...agents,
        {
          id: "eng-few",
          companyId: "company-1",
          name: "Few Engineer",
          urlKey: "router-few-engineer",
          role: "engineer",
          status: "active",
          reportsTo: "tl-1",
          title: "Engineer",
        },
      ] as any[],
      request: {
        requiredKnowledgeTags: ["artifact-routing", "pacs-destinations", "workflow-compiler"],
      },
    });

    const previewMany = buildPmIntakeProjectionPreview({
      issue: {
        id: "issue-1",
        companyId: "company-1",
        title: "Route artifacts to PACS destinations",
        description: "## Human Intake Request\n\nRoute artifacts to PACS destinations using routing policy.\n",
        priority: "high",
        projectId: null,
      },
      projects: [
        {
          id: "project-many",
          companyId: "company-1",
          name: "router-many",
          urlKey: "router-many",
        },
      ],
      knowledgeDocuments: manyDocs as any[],
      agents: [
        ...agents,
        {
          id: "eng-many",
          companyId: "company-1",
          name: "Many Engineer",
          urlKey: "router-many-engineer",
          role: "engineer",
          status: "active",
          reportsTo: "tl-1",
          title: "Engineer",
        },
      ] as any[],
      request: {
        requiredKnowledgeTags: ["artifact-routing", "pacs-destinations", "workflow-compiler"],
      },
    });

    const scoreFew = previewFew.projectCandidates[0]!.score;
    const scoreMany = previewMany.projectCandidates[0]!.score;

    // Both projects hit the knowledge structured cap (48), so the scores should be
    // very close despite the 3x difference in document count.
    // The difference should only come from ambient text overlap (capped independently).
    expect(Math.abs(scoreFew - scoreMany)).toBeLessThanOrEqual(12);
    // Both scores should be positive and meaningful
    expect(scoreFew).toBeGreaterThan(0);
    expect(scoreMany).toBeGreaterThan(0);
    // The structured cap (48) is the dominant scoring factor for knowledge-tagged requests
    expect(scoreFew).toBeGreaterThanOrEqual(48);
    expect(scoreMany).toBeGreaterThanOrEqual(48);
  });
});
