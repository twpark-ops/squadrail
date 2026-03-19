import { describe, expect, it } from "vitest";
import { ROLE_PACK_FILE_NAMES } from "@squadrail/shared";
import {
  buildCustomRolePackFiles,
  buildCustomRolePackIdentity,
  buildCustomRolePackMetadata,
  buildDefaultRolePackFiles,
  buildSimulationChecklist,
  buildSimulationRuntimePrompt,
  buildSimulationSuggestions,
  listRolePackPresets,
  normalizeSimulationFiles,
} from "../services/role-packs.js";

describe("role pack defaults", () => {
  it("creates the full file set for tech lead", () => {
    const files = buildDefaultRolePackFiles("tech_lead");
    expect(files.map((file) => file.filename).sort()).toEqual([...ROLE_PACK_FILE_NAMES].sort());

    const agents = files.find((file) => file.filename === "AGENTS.md");
    const role = files.find((file) => file.filename === "ROLE.md");

    expect(agents?.content).toContain("structured squad workflow");
    expect(role?.content).toContain("Tech Lead");
    expect(role?.content).toContain("Assign tasks");
  });

  it("creates reviewer-specific review guidance", () => {
    const files = buildDefaultRolePackFiles("reviewer");
    const review = files.find((file) => file.filename === "REVIEW.md");
    const role = files.find((file) => file.filename === "ROLE.md");

    expect(review?.content).toContain("Approval requires acceptance criteria coverage");
    expect(role?.content).toContain("Reviewer");
    expect(role?.content).toContain("Escalate to human decision");
    expect(role?.content).toContain("approval checklist");
    expect(role?.content).toContain("required evidence");
  });

  it("adds product squad-specific guidance when the preset requests product delivery mode", () => {
    const files = buildDefaultRolePackFiles("engineer", "example_product_squad_v1");
    const agents = files.find((file) => file.filename === "AGENTS.md");
    const role = files.find((file) => file.filename === "ROLE.md");

    expect(agents?.content).toContain("Example Product Squad Delivery Context");
    expect(role?.content).toContain("Example Product Squad Engineer Addendum");
    expect(role?.content).toContain("Report implementation summary, evidence, diff summary, changed files, executed tests, review checklist, residual risk, and a diff or commit artifact");
    expect(role?.content).toContain("focused validation command");
  });

  it("teaches the default engineer pack the full review handoff contract", () => {
    const files = buildDefaultRolePackFiles("engineer");
    const role = files.find((file) => file.filename === "ROLE.md");

    expect(role?.content).toContain("implementation summary");
    expect(role?.content).toContain("evidence");
    expect(role?.content).toContain("diff summary");
    expect(role?.content).toContain("review checklist");
    expect(role?.content).toContain("residual risks");
  });

  it("teaches the tech lead pack the closure contract", () => {
    const files = buildDefaultRolePackFiles("tech_lead");
    const role = files.find((file) => file.filename === "ROLE.md");

    expect(role?.content).toContain("closure summary");
    expect(role?.content).toContain("verification summary");
    expect(role?.content).toContain("rollback plan");
    expect(role?.content).toContain("reuse those exact IDs");
  });

  it("creates CTO and QA role packs for the large org preset", () => {
    const ctoFiles = buildDefaultRolePackFiles("cto", "example_large_org_v1");
    const qaFiles = buildDefaultRolePackFiles("qa", "example_large_org_v1");
    const techLeadFiles = buildDefaultRolePackFiles("tech_lead", "example_large_org_v1");
    const reviewerFiles = buildDefaultRolePackFiles("reviewer", "example_large_org_v1");

    expect(ctoFiles.find((file) => file.filename === "ROLE.md")?.content).toContain("Example Large Org CTO Addendum");
    expect(ctoFiles.find((file) => file.filename === "AGENTS.md")?.content).toContain("Example Product Squad Delivery Context");
    expect(qaFiles.find((file) => file.filename === "ROLE.md")?.content).toContain("Example Large Org QA Addendum");
    expect(qaFiles.find((file) => file.filename === "ROLE.md")?.content).toContain("Respect focused validation scope");
    expect(qaFiles.find((file) => file.filename === "REVIEW.md")?.content).toContain("Approval requires acceptance criteria coverage");
    expect(qaFiles.find((file) => file.filename === "ROLE.md")?.content).toContain("When qa_pending arrives, open START_REVIEW first");
    expect(techLeadFiles.find((file) => file.filename === "ROLE.md")?.content).toContain("When the workflow reaches approved through a closure follow-up wake");
    expect(reviewerFiles.find((file) => file.filename === "ROLE.md")?.content).toContain("When submitted_for_review arrives, start the review cycle first");
  });

  it("teaches the PM pack to use projection preview/apply helpers before repository inspection", () => {
    const pmFiles = buildDefaultRolePackFiles("pm", "example_large_org_v1");
    const role = pmFiles.find((file) => file.filename === "ROLE.md");

    expect(role?.content).toContain("project-intake preview/apply helper flow");
    expect(role?.content).toContain("list-projects");
    expect(role?.content).toContain("preview-intake-projection");
    expect(role?.content).toContain("apply-intake-projection");
  });

  it("creates custom role packs by inheriting the base role contract", () => {
    const files = buildCustomRolePackFiles({
      roleName: "Release Captain",
      baseRoleKey: "tech_lead",
      description: "Own release orchestration and rollback decisions",
    });

    expect(files.map((file) => file.filename).sort()).toEqual([...ROLE_PACK_FILE_NAMES].sort());
    expect(files.find((file) => file.filename === "ROLE.md")?.content).toContain("# Release Captain");
    expect(files.find((file) => file.filename === "ROLE.md")?.content).toContain("Derived from base role: Tech Lead");
    expect(files.find((file) => file.filename === "ROLE.md")?.content).toContain("## Inherited Base Pack");
    expect(files.find((file) => file.filename === "AGENTS.md")?.content).toContain("Release Captain");
    expect(files.find((file) => file.filename === "AGENTS.md")?.content).toContain("Own release orchestration and rollback decisions");
  });

  it("normalizes custom role identity for slugged company-scoped roles", () => {
    expect(
      buildCustomRolePackIdentity({
        roleName: " Release Captain ",
        roleSlug: null,
        publish: false,
      }),
    ).toEqual({
      roleName: "Release Captain",
      roleSlug: "release-captain",
      scopeId: "custom:release-captain",
      status: "draft",
    });
  });

  it("builds custom role metadata with inherited base role details", () => {
    expect(
      buildCustomRolePackMetadata({
        roleName: "Release Captain",
        roleSlug: "release-captain",
        description: "Own release orchestration",
        baseRoleKey: "tech_lead",
      }),
    ).toEqual({
      customRoleName: "Release Captain",
      customRoleSlug: "release-captain",
      customRoleDescription: "Own release orchestration",
      baseRoleKey: "tech_lead",
    });
  });

  it("lists presets and preserves runtime file ordering when draft files override published content", () => {
    expect(listRolePackPresets().map((preset) => preset.key)).toEqual([
      "squadrail_default_v1",
      "example_product_squad_v1",
      "example_large_org_v1",
    ]);

    const normalized = normalizeSimulationFiles({
      latestFiles: [
        { id: "1", revisionId: "rev-1", filename: "ROLE.md", content: "# Published", checksumSha256: "a", createdAt: new Date() },
        { id: "2", revisionId: "rev-1", filename: "TOOLS.md", content: "Published tools", checksumSha256: "b", createdAt: new Date() },
      ],
      draftFiles: [
        { filename: "ROLE.md", content: "# Draft" },
        { filename: "STYLE.md", content: "Draft style" },
      ],
    });

    expect(normalized.map((file) => file.filename)).toEqual([
      "ROLE.md",
      "AGENTS.md",
      "HEARTBEAT.md",
      "REVIEW.md",
      "STYLE.md",
      "TOOLS.md",
    ]);
    expect(normalized.find((file) => file.filename === "ROLE.md")?.content).toBe("# Draft");
    expect(normalized.find((file) => file.filename === "STYLE.md")?.content).toBe("Draft style");
    expect(normalized.find((file) => file.filename === "TOOLS.md")?.content).toBe("Published tools");
  });

  it("builds role-specific simulation checklists and suggestions across CTO, TL, reviewer, and QA paths", () => {
    const baseScenario = {
      workflowState: "under_review",
      messageType: "REQUEST_CHANGES",
      issueTitle: "Stabilize runtime dispatch",
      issueSummary: "Fix watchdog drift",
      acceptanceCriteria: ["Heartbeat finishes reliably"],
      changedFiles: ["server/src/services/heartbeat.ts"],
      reviewFindings: ["Missing watchdog coverage"],
      taskBrief: "Keep retries bounded.",
      retrievalSummary: "Recent failures cluster around process loss.",
      blockerCode: "watchdog_timeout",
    };

    expect(buildSimulationChecklist("cto", { ...baseScenario, workflowState: "planning" })).toEqual(
      expect.arrayContaining([
        "Delegate company-wide work to the correct project lead before driving review or closure.",
        "Synthesize TL and QA evidence into a final board-facing recommendation.",
      ]),
    );
    expect(buildSimulationChecklist("qa", baseScenario)).toEqual(
      expect.arrayContaining([
        "Check regression coverage, reproduction clarity, and integration risk before signaling completion.",
        "Escalate when evidence is missing even if local code changes look reasonable.",
      ]),
    );

    expect(buildSimulationSuggestions("tech_lead", { ...baseScenario, workflowState: "backlog" })).toEqual([
      expect.objectContaining({ messageType: "ASSIGN_TASK" }),
    ]);
    expect(buildSimulationSuggestions("tech_lead", { ...baseScenario, workflowState: "blocked" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageType: "REASSIGN_TASK" }),
        expect.objectContaining({ messageType: "NOTE" }),
      ]),
    );
    expect(buildSimulationSuggestions("reviewer", { ...baseScenario, workflowState: "under_review" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageType: "REQUEST_CHANGES" }),
        expect.objectContaining({ messageType: "APPROVE_IMPLEMENTATION" }),
      ]),
    );
    expect(buildSimulationSuggestions("qa", { ...baseScenario, workflowState: "qa_pending" })).toEqual([
      expect.objectContaining({ messageType: "START_REVIEW" }),
    ]);
    expect(buildSimulationSuggestions("qa", { ...baseScenario, workflowState: "under_qa_review" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageType: "REQUEST_CHANGES" }),
        expect.objectContaining({ messageType: "APPROVE_IMPLEMENTATION" }),
      ]),
    );
  });

  it("renders runtime prompts with protocol transport rules and compiled markdown files", () => {
    const runtimePrompt = buildSimulationRuntimePrompt({
      roleKey: "engineer",
      roleLabel: "Release Captain",
      scenario: {
        workflowState: "implementing",
        messageType: "REPORT_PROGRESS",
        issueTitle: "Harden burn-in flow",
        issueSummary: "Fix runtime regressions",
        acceptanceCriteria: ["Focused vitest passes"],
        changedFiles: ["server/src/services/issue-retrieval.ts"],
        reviewFindings: [],
        taskBrief: "Stop after focused validation.",
        retrievalSummary: "Prior regressions came from finalization drift.",
        blockerCode: null,
      },
      checklist: ["Keep the next update evidence-backed and scoped to the current issue."],
      files: [
        { filename: "ROLE.md", content: "# Engineer" },
        { filename: "AGENTS.md", content: "Use the helper." },
      ],
    });

    expect(runtimePrompt).toContain("# Release Captain runtime simulation");
    expect(runtimePrompt).toContain("Protocol transport rule");
    expect(runtimePrompt).toContain("SQUADRAIL_PROTOCOL_HELPER_PATH");
    expect(runtimePrompt).toContain("## ROLE.md");
    expect(runtimePrompt).toContain("## AGENTS.md");
  });
});
