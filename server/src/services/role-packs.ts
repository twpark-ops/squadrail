import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import { rolePackFiles, rolePackRevisions, rolePackSets } from "@squadrail/db";
import type {
  CreateRolePackDraft,
  RolePackFile,
  RolePackFileName,
  RolePackPresetDescriptor,
  RolePackPresetKey,
  RolePackRevision,
  RolePackRevisionWithFiles,
  RolePackSimulationInput,
  RolePackSimulationRequest,
  RolePackSimulationResult,
  RolePackSimulationSuggestion,
  RolePackRoleKey,
  RolePackSet,
  RolePackWithLatestRevision,
  SeedRolePackResult,
} from "@squadrail/shared";
import { unprocessable } from "../errors.js";

type RolePackSetRow = typeof rolePackSets.$inferSelect;
type RolePackRevisionRow = typeof rolePackRevisions.$inferSelect;
type RolePackFileRow = typeof rolePackFiles.$inferSelect;

const DEFAULT_ROLE_PACK_SCOPE_TYPE = "company";
const DEFAULT_ROLE_PACK_SCOPE_ID = "";
const DEFAULT_ROLE_PACK_PRESET_KEY = "squadrail_default_v1";
const BASE_DELIVERY_ROLE_KEYS: RolePackRoleKey[] = ["tech_lead", "engineer", "reviewer"];
const PRESET_ROLE_KEYS: Record<RolePackPresetKey, RolePackRoleKey[]> = {
  squadrail_default_v1: BASE_DELIVERY_ROLE_KEYS,
  example_product_squad_v1: BASE_DELIVERY_ROLE_KEYS,
  example_large_org_v1: ["cto", "pm", "qa", "tech_lead", "engineer", "reviewer", "human_board"],
};
const ROLE_PACK_RUNTIME_FILE_ORDER: RolePackFileName[] = [
  "ROLE.md",
  "AGENTS.md",
  "HEARTBEAT.md",
  "REVIEW.md",
  "STYLE.md",
  "TOOLS.md",
];

const ROLE_PACK_PRESETS: Record<RolePackPresetKey, RolePackPresetDescriptor> = {
  squadrail_default_v1: {
    key: "squadrail_default_v1",
    label: "Squadrail Default",
    description: "General-purpose delivery squad for protocol-first planning, implementation, and review.",
    recommended: true,
    starterTaskTitle: "Review squad setup and prepare the first delivery plan",
    starterTaskDescription: [
      "Review the seeded Tech Lead, Engineer, and Reviewer role packs for this company.",
      "Confirm the selected execution engine and working directory are ready for real implementation work.",
      "Write the first implementation plan with explicit acceptance criteria, reviewer ownership, and blockers.",
    ].join("\n\n"),
  },
  example_product_squad_v1: {
    key: "example_product_squad_v1",
    label: "Example Product Squad",
    description: "Product squad preset tuned for backend, app, infra, and release-safe delivery work.",
    recommended: false,
    starterTaskTitle: "Audit product squad readiness and define the first delivery slice",
    starterTaskDescription: [
      "Review the seeded Tech Lead, Engineer, and Reviewer role packs for this company.",
      "Inspect the imported product repo and identify the highest-confidence first delivery slice across app, backend, and infra boundaries.",
      "Write an implementation plan with acceptance criteria, reviewer ownership, rollout notes, and blocker escalation rules.",
    ].join("\n\n"),
  },
  example_large_org_v1: {
    key: "example_large_org_v1",
    label: "Example Large Org Bootstrap",
    description: "Organization preset for CTO, PM, QA, Tech Leads, Engineers, and board-driven delivery governance.",
    recommended: false,
    starterTaskTitle: "Bootstrap the large org and define the first cross-project review sweep",
    starterTaskDescription: [
      "Seed organization role packs for CTO, PM, QA, Tech Leads, Engineers, Reviewers, and the Human Board.",
      "Connect the repositories as projects with explicit leads, workspaces, and retrieval policies.",
      "Run the first cross-project review issue through CTO orchestration, project TL delegation, QA validation, and board closure.",
    ].join("\n\n"),
  },
};

function toRolePackSet(row: RolePackSetRow): RolePackSet {
  return {
    id: row.id,
    companyId: row.companyId,
    scopeType: row.scopeType as RolePackSet["scopeType"],
    scopeId: row.scopeId || null,
    roleKey: row.roleKey as RolePackRoleKey,
    status: row.status as RolePackSet["status"],
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRolePackRevision(row: RolePackRevisionRow): RolePackRevision {
  return {
    id: row.id,
    rolePackSetId: row.rolePackSetId,
    version: row.version,
    status: row.status as RolePackRevision["status"],
    message: row.message,
    createdByUserId: row.createdByUserId,
    createdByAgentId: row.createdByAgentId,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
  };
}

function toRolePackFile(row: RolePackFileRow): RolePackFile {
  return {
    id: row.id,
    revisionId: row.revisionId,
    filename: row.filename as RolePackFileName,
    content: row.content,
    checksumSha256: row.checksumSha256,
    createdAt: row.createdAt,
  };
}

function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function filesMatchByChecksum(left: RolePackFileRow[], right: RolePackFileRow[]) {
  if (left.length !== right.length) return false;
  const leftMap = new Map(left.map((file) => [file.filename, file.checksumSha256] as const));
  const rightMap = new Map(right.map((file) => [file.filename, file.checksumSha256] as const));
  for (const [filename, checksum] of leftMap) {
    if (rightMap.get(filename) !== checksum) return false;
  }
  return true;
}

function buildBaseRolePackFiles(roleKey: RolePackRoleKey): Array<{ filename: RolePackFileName; content: string }> {
  const sharedFiles: Record<RolePackFileName, string> = {
    "HEARTBEAT.md": [
      "# Heartbeat Contract",
      "",
      "- Treat every wake as a workflow event, not casual chat.",
      "- Check the protocol message type, workflow state, latest brief, and retrieval evidence first.",
      "- Report blockers explicitly. Do not invent approvals or close tasks unilaterally.",
      "- Keep updates short, factual, and tied to artifacts.",
    ].join("\n"),
    "STYLE.md": [
      "# Engineering Style",
      "",
      "- Prefer minimal, reversible changes.",
      "- Preserve existing patterns unless the task explicitly requires redesign.",
      "- Add tests for behavior changes and edge cases.",
      "- Use precise evidence when reporting status: changed files, tests, risks, and follow-up items.",
    ].join("\n"),
    "TOOLS.md": [
      "# Tooling Rules",
      "",
      "- Use Claude Code or Codex for implementation work.",
      "- Prefer repository-local context before retrieval results.",
      "- Use retrieval evidence to confirm decisions, not to replace direct code inspection.",
      "- Escalate when tool output conflicts with canonical docs or code.",
    ].join("\n"),
    "REVIEW.md": [
      "# Review Rules",
      "",
      "- Approval requires acceptance criteria coverage, risk assessment, and evidence.",
      "- Request changes with concrete findings and expected follow-up actions.",
      "- Keep review comments scoped to the current issue unless a broader policy conflict is detected.",
    ].join("\n"),
    "ROLE.md": "",
    "AGENTS.md": "",
  };

  const roleSpecific: Record<RolePackRoleKey, { role: string; focus: string[]; rules: string[] }> = {
    tech_lead: {
      role: "Tech Lead",
      focus: [
        "Break work into clear execution units.",
        "Assign tasks with explicit acceptance criteria and reviewer ownership.",
        "Control workflow transitions and close tasks only when closure summary, verification summary, and rollback plan are complete.",
      ],
      rules: [
        "Do not implement unless explicitly acting as an engineer for a specific task.",
        "Do not approve without review evidence.",
      ],
    },
    cto: {
      role: "CTO",
      focus: [
        "Own cross-project orchestration and final technical judgment for company-level work.",
        "Decompose board requests into project-level review or delivery issues with clear TL ownership.",
        "Consolidate TL and QA outputs into a final technical recommendation for the board.",
      ],
      rules: [
        "Do not bypass project leads for project-scoped execution unless the issue is company-critical.",
        "Do not close cross-project work without explicit per-project evidence.",
      ],
    },
    engineer: {
      role: "Engineer",
      focus: [
        "Implement the assigned task within the accepted plan and constraints.",
        "Use retrieval evidence to understand neighboring code, tests, and risks.",
        "Submit work with implementation summary, diff summary, changed files, test results, review checklist, and explicit residual risks.",
      ],
      rules: [
        "Do not approve your own implementation.",
        "Do not change scope without clarification or reassignment.",
      ],
    },
    reviewer: {
      role: "Reviewer",
      focus: [
        "Evaluate correctness, regressions, evidence quality, and policy alignment.",
        "Prefer actionable change requests tied to files, required evidence, and acceptance criteria.",
        "Approve only with explicit approval checklist, verified evidence, and residual risks.",
        "Escalate to human decision only when requirements or policy conflict materially.",
      ],
      rules: [
        "Do not silently rewrite scope.",
        "Do not approve when required evidence is missing.",
      ],
    },
    qa: {
      role: "QA",
      focus: [
        "Validate regressions, coverage gaps, integration risk, and evidence quality across project outputs.",
        "Act as an independent verification lane after project-level implementation or review is complete.",
        "Escalate when test evidence, reproduction detail, or release safety is incomplete.",
      ],
      rules: [
        "Do not approve solely on implementation claims without test or artifact evidence.",
        "Do not silently downgrade severity when regression risk is unclear.",
      ],
    },
    human_board: {
      role: "Human Board",
      focus: [
        "Approve or redirect work that requires explicit human governance.",
        "Preserve accountability and record rationale for final overrides or approvals.",
      ],
      rules: [
        "Do not change protocol state without a reason tied to evidence or policy.",
      ],
    },
    pm: {
      role: "Product Manager",
      focus: [
        "Clarify requirements, scope boundaries, acceptance criteria, and documentation gaps.",
        "Convert product intent into issue-ready requirements that TLs can execute against.",
      ],
      rules: [
        "Do not approve implementation without technical review.",
        "Do not change scope silently after implementation starts.",
      ],
    },
  };

  const selected = roleSpecific[roleKey];
  sharedFiles["ROLE.md"] = [
    `# ${selected.role}`,
    "",
    "## Responsibilities",
    ...selected.focus.map((line) => `- ${line}`),
    "",
    "## Hard Rules",
    ...selected.rules.map((line) => `- ${line}`),
  ].join("\n");
  sharedFiles["AGENTS.md"] = [
    `# ${selected.role} Operating Guide`,
    "",
    "You work inside a structured squad workflow.",
    "Start from the protocol event, current workflow state, assigned role, and the latest brief.",
    "Prefer deterministic execution over open-ended conversation.",
    "",
    "## Always Do",
    "- Restate the task objective in concrete terms before acting.",
    "- Use retrieval evidence when planning, implementing, or reviewing.",
    "- Keep status messages concise and evidence-backed.",
    "",
    "## Never Do",
    "- Invent approvals, merges, or status transitions.",
    "- Hide uncertainty. Ask for clarification or escalate blockers when needed.",
  ].join("\n");

  return Object.entries(sharedFiles).map(([filename, content]) => ({
    filename: filename as RolePackFileName,
    content,
  }));
}

function applyPresetOverrides(
  presetKey: RolePackPresetKey,
  roleKey: RolePackRoleKey,
  files: Array<{ filename: RolePackFileName; content: string }>,
) {
  if (presetKey === "squadrail_default_v1") {
    return files;
  }

  const fileMap = new Map(files.map((file) => [file.filename, file.content] as const));
  const append = (filename: RolePackFileName, extra: string) => {
    const current = fileMap.get(filename) ?? "";
    fileMap.set(filename, `${current.trim()}\n\n${extra.trim()}\n`);
  };

  if (presetKey === "example_product_squad_v1" || presetKey === "example_large_org_v1") {
    append("AGENTS.md", [
      "## Example Product Squad Delivery Context",
      "- Operate like a real product squad spanning app, backend, infra, and release readiness.",
      "- Ground every proposal in imported code, documents, and the current task brief.",
      "- Keep handoffs explicit: changed files, tests, rollout notes, and unresolved product risk.",
    ].join("\n"));
    append("HEARTBEAT.md", [
      "## Example Product Squad Workflow",
      "- Retrieve app/backend/shared-module context before proposing plans.",
      "- Escalate blockers when API contracts, data model migrations, or rollout safety are unclear.",
      "- Keep issue briefs concise enough for repeated execution loops.",
    ].join("\n"));
    append("STYLE.md", [
      "## SwiftSight Quality Bar",
      "- Prefer incremental slices that can be reviewed and rolled back safely.",
      "- Mention affected surfaces explicitly: mobile, web, backend, jobs, infra, analytics.",
      "- Include migration or rollout notes whenever persistent state changes.",
    ].join("\n"));
    append("REVIEW.md", [
      "## SwiftSight Review Checklist",
      "- Verify acceptance criteria against product behavior, not only code correctness.",
      "- Check API/schema compatibility, observability impact, and rollback safety.",
      "- Request changes when test evidence or rollout notes are incomplete.",
    ].join("\n"));

    if (roleKey === "tech_lead") {
      append("ROLE.md", [
        "## Example Product Squad Tech Lead Addendum",
        "- Decompose work by product surface and dependency boundary.",
        "- Require explicit file targets, acceptance criteria, and reviewer assignments.",
        "- Gate completion on implementation evidence plus closure summary, verification summary, and rollback plan.",
      ].join("\n"));
    } else if (roleKey === "engineer") {
      append("ROLE.md", [
        "## Example Product Squad Engineer Addendum",
        "- Start from affected modules, existing tests, and nearby integration points.",
        "- Report implementation summary, diff summary, changed files, executed tests, review checklist, and residual risk in every review submission.",
        "- Raise clarification before changing API contracts, migrations, or rollout behavior.",
      ].join("\n"));
    } else if (roleKey === "reviewer") {
      append("ROLE.md", [
        "## Example Product Squad Reviewer Addendum",
        "- Review for regressions across product surfaces, not just touched files.",
        "- Require review summary, required evidence, approval checklist, and residual risk when closing the review loop.",
        "- Escalate if the requested change conflicts with product requirements or release policy.",
      ].join("\n"));
    } else if (roleKey === "cto") {
      append("ROLE.md", [
        "## Example Large Org CTO Addendum",
        "- Route company-wide requests into per-project review or delivery slices with named TL owners.",
        "- Keep final recommendations cross-project and evidence-based.",
        "- Require QA validation before closing organization-wide review or release issues.",
      ].join("\n"));
    } else if (roleKey === "qa") {
      append("ROLE.md", [
        "## Example Large Org QA Addendum",
        "- Focus on regression risk, test evidence, reproducibility, and release safety.",
        "- Flag cross-project integration gaps when project-level review is locally correct but system-level risk remains.",
      ].join("\n"));
    } else if (roleKey === "pm") {
      append("ROLE.md", [
        "## Example Large Org PM Addendum",
        "- Translate product intent into acceptance criteria and documentation tasks before implementation begins.",
        "- Track documentation debt for Python-heavy repos with weak canonical guidance.",
      ].join("\n"));
    }
  }

  return Array.from(fileMap.entries()).map(([filename, content]) => ({ filename, content }));
}

export function buildDefaultRolePackFiles(
  roleKey: RolePackRoleKey,
  presetKey: RolePackPresetKey = DEFAULT_ROLE_PACK_PRESET_KEY,
): Array<{ filename: RolePackFileName; content: string }> {
  return applyPresetOverrides(presetKey, roleKey, buildBaseRolePackFiles(roleKey));
}

export function listRolePackPresets(): RolePackPresetDescriptor[] {
  return Object.values(ROLE_PACK_PRESETS);
}

function assembleRolePackViews(input: {
  sets: RolePackSetRow[];
  revisions: RolePackRevisionRow[];
  files: RolePackFileRow[];
}): RolePackWithLatestRevision[] {
  const latestRevisionBySetId = new Map<string, RolePackRevisionRow>();
  for (const revision of input.revisions) {
    const current = latestRevisionBySetId.get(revision.rolePackSetId);
    if (!current || revision.version > current.version) {
      latestRevisionBySetId.set(revision.rolePackSetId, revision);
    }
  }

  const filesByRevisionId = new Map<string, RolePackFile[]>();
  for (const file of input.files) {
    const current = filesByRevisionId.get(file.revisionId) ?? [];
    current.push(toRolePackFile(file));
    filesByRevisionId.set(file.revisionId, current);
  }

  return input.sets.map((row) => {
    const latestRevisionRow = latestRevisionBySetId.get(row.id) ?? null;
    const latestRevision = latestRevisionRow ? toRolePackRevision(latestRevisionRow) : null;
    const latestFiles = latestRevision ? (filesByRevisionId.get(latestRevision.id) ?? []) : [];
    return {
      ...toRolePackSet(row),
      latestRevision,
      latestFiles,
    };
  });
}

function assembleRevisionViews(input: {
  revisions: RolePackRevisionRow[];
  files: RolePackFileRow[];
}): RolePackRevisionWithFiles[] {
  const filesByRevisionId = new Map<string, RolePackFile[]>();
  for (const file of input.files) {
    const current = filesByRevisionId.get(file.revisionId) ?? [];
    current.push(toRolePackFile(file));
    filesByRevisionId.set(file.revisionId, current);
  }

  return input.revisions.map((revision) => ({
    ...toRolePackRevision(revision),
    files: (filesByRevisionId.get(revision.id) ?? []).sort((left, right) => left.filename.localeCompare(right.filename)),
  }));
}

function normalizeSimulationFiles(input: {
  latestFiles: RolePackFile[];
  draftFiles?: RolePackSimulationRequest["draftFiles"];
}) {
  const latestByFilename = new Map(input.latestFiles.map((file) => [file.filename, file.content] as const));
  const draftByFilename = new Map((input.draftFiles ?? []).map((file) => [file.filename, file.content] as const));

  return ROLE_PACK_RUNTIME_FILE_ORDER.map((filename) => ({
    filename,
    content: draftByFilename.get(filename) ?? latestByFilename.get(filename) ?? "",
  }));
}

function listMarkdownBulletItems(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^-\s+/.test(line))
    .map((line) => line.replace(/^-\s+/, "").trim());
}

function buildSimulationChecklist(roleKey: RolePackRoleKey, scenario: RolePackSimulationInput) {
  const shared = [
    `Confirm the protocol event ${scenario.messageType} while the task is in ${scenario.workflowState}.`,
    "Read the latest task brief and retrieval summary before choosing an action.",
    "Keep the next update evidence-backed and scoped to the current issue.",
  ];

  if (scenario.acceptanceCriteria.length > 0) {
    shared.push(`Cover ${scenario.acceptanceCriteria.length} acceptance criteria item(s) in the next handoff.`);
  }
  if (scenario.changedFiles.length > 0) {
    shared.push(`Use the changed-file set as the first code inspection boundary (${scenario.changedFiles.length} file(s)).`);
  }
  if (scenario.reviewFindings.length > 0) {
    shared.push(`Address ${scenario.reviewFindings.length} review finding(s) explicitly before closing the loop.`);
  }

    switch (roleKey) {
    case "cto":
      return [
        ...shared,
        "Delegate company-wide work to the correct project lead before driving review or closure.",
        "Synthesize TL and QA evidence into a final board-facing recommendation.",
      ];
    case "tech_lead":
      return [
        ...shared,
        "Validate ownership, acceptance criteria, and reviewer assignment before changing workflow state.",
        "Close the task only when review evidence, closure summary, verification summary, rollback plan, and final artifacts are complete.",
      ];
    case "engineer":
      return [
        ...shared,
        "Implement only within the assigned scope or ask for clarification before changing scope.",
        "Prepare implementation summary, diff summary, changed files, test results, review checklist, and residual risks for the next review submission.",
      ];
    case "reviewer":
      return [
        ...shared,
        "Evaluate correctness, regressions, and policy alignment before approving.",
        "Request changes with review summary, required evidence, and concrete file-level findings.",
        "Approve with approval checklist, verified evidence, and explicit residual risks.",
      ];
    case "qa":
      return [
        ...shared,
        "Check regression coverage, reproduction clarity, and integration risk before signaling completion.",
        "Escalate when evidence is missing even if local code changes look reasonable.",
      ];
    default:
      return shared;
  }
}

function buildSimulationSuggestions(roleKey: RolePackRoleKey, scenario: RolePackSimulationInput): RolePackSimulationSuggestion[] {
  if (roleKey === "cto") {
    if (scenario.workflowState === "backlog" || scenario.workflowState === "planning") {
      return [
        {
          messageType: "ASSIGN_TASK",
          reason: "CTO should route cross-project work into owned execution lanes before action starts.",
          summaryTemplate: `Delegate ${scenario.issueTitle} to the correct project lead with review expectations`,
        },
        {
          messageType: "NOTE",
          reason: "Use a note to frame cross-project constraints or synthesis before delegation.",
          summaryTemplate: `Record company-wide technical framing for ${scenario.issueTitle}`,
        },
      ];
    }
  }

  if (roleKey === "tech_lead") {
    if (scenario.workflowState === "backlog") {
      return [
        {
          messageType: "ASSIGN_TASK",
          reason: "The task has not been staffed yet; convert backlog scope into an owned execution unit.",
          summaryTemplate: `Assign ${scenario.issueTitle} with explicit acceptance criteria and reviewer ownership`,
        },
      ];
    }
    if (scenario.workflowState === "blocked") {
      return [
        {
          messageType: "REASSIGN_TASK",
          reason: "Blocked delivery often needs ownership or reviewer adjustment.",
          summaryTemplate: `Reassign ${scenario.issueTitle} with blocker carry-forward context`,
        },
        {
          messageType: "NOTE",
          reason: "Use a board or lead note to clarify constraints without changing state.",
          summaryTemplate: `Clarify blocker context and unblock next action for ${scenario.issueTitle}`,
        },
      ];
    }
    if (scenario.workflowState === "approved") {
      return [
        {
          messageType: "CLOSE_TASK",
          reason: "The task is approved and should move to explicit closure with final artifacts.",
          summaryTemplate: `Close ${scenario.issueTitle} with final verification artifacts`,
        },
      ];
    }
  }

  if (roleKey === "engineer") {
    if (scenario.workflowState === "assigned") {
      return [
        {
          messageType: "ACK_ASSIGNMENT",
          reason: "Acknowledge ownership before planning or implementation starts.",
          summaryTemplate: `Acknowledge ${scenario.issueTitle} assignment and confirm understanding`,
        },
        {
          messageType: "PROPOSE_PLAN",
          reason: "Convert the assignment into a concrete implementation plan before coding.",
          summaryTemplate: `Propose implementation plan for ${scenario.issueTitle}`,
        },
      ];
    }
    if (scenario.workflowState === "planning" || scenario.workflowState === "changes_requested") {
      return [
        {
          messageType: "START_IMPLEMENTATION",
          reason: "The next deterministic step is to enter implementation with a clear mode.",
          summaryTemplate: `Start implementation for ${scenario.issueTitle}`,
        },
      ];
    }
    if (scenario.workflowState === "implementing") {
      return [
        {
          messageType: "REPORT_PROGRESS",
          reason: "Use a progress update when implementation is active but not yet review-ready.",
          summaryTemplate: `Report implementation progress for ${scenario.issueTitle}`,
        },
        {
          messageType: "SUBMIT_FOR_REVIEW",
          reason: "When evidence is ready, hand the task off with files, tests, and residual risks.",
          summaryTemplate: `Submit ${scenario.issueTitle} for review with evidence`,
        },
      ];
    }
  }

  if (roleKey === "reviewer") {
    if (scenario.workflowState === "submitted_for_review") {
      return [
        {
          messageType: "START_REVIEW",
          reason: "Open a review cycle before approving or requesting changes.",
          summaryTemplate: `Start review for ${scenario.issueTitle}`,
        },
      ];
    }
    if (scenario.workflowState === "under_review") {
      return [
        {
          messageType: "REQUEST_CHANGES",
          reason: "Use a structured change request when evidence or correctness is incomplete.",
          summaryTemplate: `Request changes for ${scenario.issueTitle} with concrete findings`,
        },
        {
          messageType: "APPROVE_IMPLEMENTATION",
          reason: "Approve only when acceptance criteria and evidence are complete.",
          summaryTemplate: `Approve implementation for ${scenario.issueTitle}`,
        },
      ];
    }
  }

  if (roleKey === "qa") {
    if (scenario.workflowState === "under_review" || scenario.workflowState === "approved") {
      return [
        {
          messageType: "REQUEST_CHANGES",
          reason: "Use QA-driven change requests when regression evidence or release safety is incomplete.",
          summaryTemplate: `Request QA changes for ${scenario.issueTitle} with evidence gaps`,
        },
        {
          messageType: "NOTE",
          reason: "Use a note to capture QA validation scope, coverage gaps, or release risks.",
          summaryTemplate: `Record QA validation summary for ${scenario.issueTitle}`,
        },
      ];
    }
  }

  return [
    {
      messageType: "NOTE",
      reason: "Use a note when no deterministic state transition is appropriate yet.",
      summaryTemplate: `Record context for ${scenario.issueTitle}`,
    },
  ];
}

function buildSimulationRuntimePrompt(input: {
  roleKey: RolePackRoleKey;
  scenario: RolePackSimulationInput;
  files: Array<{ filename: RolePackFileName; content: string }>;
  checklist: string[];
}) {
  const scenarioLines = [
    `Workflow state: ${input.scenario.workflowState}`,
    `Trigger message: ${input.scenario.messageType}`,
    `Issue title: ${input.scenario.issueTitle}`,
    `Issue summary: ${input.scenario.issueSummary}`,
    input.scenario.taskBrief ? `Task brief: ${input.scenario.taskBrief}` : null,
    input.scenario.retrievalSummary ? `Retrieval summary: ${input.scenario.retrievalSummary}` : null,
    input.scenario.blockerCode ? `Blocker code: ${input.scenario.blockerCode}` : null,
    input.scenario.acceptanceCriteria.length > 0
      ? `Acceptance criteria:\n${input.scenario.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`
      : null,
    input.scenario.changedFiles.length > 0
      ? `Changed files:\n${input.scenario.changedFiles.map((item) => `- ${item}`).join("\n")}`
      : null,
    input.scenario.reviewFindings.length > 0
      ? `Review findings:\n${input.scenario.reviewFindings.map((item) => `- ${item}`).join("\n")}`
      : null,
  ].filter(Boolean);

  return [
    `# ${input.roleKey} runtime simulation`,
    "",
    "## Scenario",
    ...scenarioLines,
    "",
    "## Checklist",
    ...input.checklist.map((item) => `- ${item}`),
    "",
    ...input.files.flatMap((file) => [
      `## ${file.filename}`,
      file.content.trim() || "_empty_",
      "",
    ]),
  ].join("\n");
}

export function rolePackService(db: Db) {
  async function listRolePacks(input: {
    companyId: string;
    scopeType?: RolePackSet["scopeType"];
    scopeId?: string | null;
    roleKey?: RolePackRoleKey;
  }): Promise<RolePackWithLatestRevision[]> {
    const conditions = [eq(rolePackSets.companyId, input.companyId)];
    if (input.scopeType) conditions.push(eq(rolePackSets.scopeType, input.scopeType));
    if (input.scopeId !== undefined) conditions.push(eq(rolePackSets.scopeId, input.scopeId ?? DEFAULT_ROLE_PACK_SCOPE_ID));
    if (input.roleKey) conditions.push(eq(rolePackSets.roleKey, input.roleKey));

    const sets = await db
      .select()
      .from(rolePackSets)
      .where(and(...conditions))
      .orderBy(rolePackSets.scopeType, rolePackSets.roleKey);
    if (sets.length === 0) return [];

    const setIds = sets.map((row) => row.id);
    const revisions = await db
      .select()
      .from(rolePackRevisions)
      .where(inArray(rolePackRevisions.rolePackSetId, setIds))
      .orderBy(desc(rolePackRevisions.version), desc(rolePackRevisions.createdAt));
    const latestRevisionIds = Array.from(
      new Set(
        revisions
          .map((revision) => revision.rolePackSetId)
          .map((setId) => revisions.find((revision) => revision.rolePackSetId === setId)?.id)
          .filter((revisionId): revisionId is string => Boolean(revisionId)),
      ),
    );
    const files = latestRevisionIds.length === 0
      ? []
      : await db
          .select()
          .from(rolePackFiles)
          .where(inArray(rolePackFiles.revisionId, latestRevisionIds));

    return assembleRolePackViews({ sets, revisions, files });
  }

  async function seedDefaults(input: {
    companyId: string;
    force?: boolean;
    presetKey?: RolePackPresetKey;
    actor: {
      userId?: string | null;
      agentId?: string | null;
    };
  }): Promise<SeedRolePackResult> {
    const presetKey = input.presetKey ?? DEFAULT_ROLE_PACK_PRESET_KEY;
    const existing = await listRolePacks({
      companyId: input.companyId,
      scopeType: DEFAULT_ROLE_PACK_SCOPE_TYPE,
      scopeId: null,
    });
    const existingByRole = new Map(existing.map((entry) => [entry.roleKey, entry]));

    const created: RolePackWithLatestRevision[] = [];
    const skipped: RolePackWithLatestRevision[] = [];

    await db.transaction(async (tx) => {
      for (const roleKey of PRESET_ROLE_KEYS[presetKey]) {
        const current = existingByRole.get(roleKey);
        if (current && input.force !== true) {
          skipped.push(current);
          continue;
        }

        let setId = current?.id ?? null;
        if (!setId) {
          const [insertedSet] = await tx
            .insert(rolePackSets)
            .values({
              companyId: input.companyId,
              scopeType: DEFAULT_ROLE_PACK_SCOPE_TYPE,
              scopeId: DEFAULT_ROLE_PACK_SCOPE_ID,
              roleKey,
              status: "published",
              metadata: {
                presetKey,
              },
            })
            .returning();
          setId = insertedSet!.id;
        } else {
          await tx
            .update(rolePackSets)
            .set({
              status: "published",
              metadata: {
                ...(current?.metadata ?? {}),
                presetKey,
              },
              updatedAt: new Date(),
            })
            .where(eq(rolePackSets.id, setId));
        }

        const existingRevision = current?.latestRevision ?? null;
        const nextVersion = (existingRevision?.version ?? 0) + 1;
        const [revision] = await tx
          .insert(rolePackRevisions)
          .values({
            rolePackSetId: setId,
            version: nextVersion,
            status: "published",
            message: existingRevision ? "Refreshed default Squadrail role pack." : "Seeded default Squadrail role pack.",
            createdByUserId: input.actor.userId ?? null,
            createdByAgentId: input.actor.agentId ?? null,
            publishedAt: new Date(),
          })
          .returning();

        const files = buildDefaultRolePackFiles(roleKey, presetKey);
        await tx
          .insert(rolePackFiles)
          .values(
            files.map((file) => ({
              revisionId: revision!.id,
              filename: file.filename,
              content: file.content,
              checksumSha256: hashContent(file.content),
            })),
          );
      }
    });

    const refreshed = await listRolePacks({
      companyId: input.companyId,
      scopeType: DEFAULT_ROLE_PACK_SCOPE_TYPE,
      scopeId: null,
    });
    const refreshedByRole = new Map(refreshed.map((entry) => [entry.roleKey, entry]));
    for (const roleKey of PRESET_ROLE_KEYS[presetKey]) {
      const latest = refreshedByRole.get(roleKey);
      if (!latest) continue;
      if (input.force === true || !existingByRole.has(roleKey)) {
        created.push(latest);
      }
    }

    return {
      presetKey,
      created,
      existing: skipped,
    };
  }

  async function createDraftRevision(input: {
    companyId: string;
    rolePackSetId: string;
    actor: {
      userId?: string | null;
      agentId?: string | null;
    };
    draft: CreateRolePackDraft;
  }) {
    const rolePackSet = await db
      .select()
      .from(rolePackSets)
      .where(and(eq(rolePackSets.companyId, input.companyId), eq(rolePackSets.id, input.rolePackSetId)))
      .then((rows) => rows[0] ?? null);
    if (!rolePackSet) return null;

    const latestRevision = await db
      .select()
      .from(rolePackRevisions)
      .where(eq(rolePackRevisions.rolePackSetId, input.rolePackSetId))
      .orderBy(desc(rolePackRevisions.version))
      .then((rows) => rows[0] ?? null);
    const nextVersion = (latestRevision?.version ?? 0) + 1;

    const [revision] = await db
      .insert(rolePackRevisions)
      .values({
        rolePackSetId: input.rolePackSetId,
        version: nextVersion,
        status: input.draft.status ?? "draft",
        message: input.draft.message ?? null,
        createdByUserId: input.actor.userId ?? null,
        createdByAgentId: input.actor.agentId ?? null,
        publishedAt: input.draft.status === "published" ? new Date() : null,
      })
      .returning();

    await db
      .insert(rolePackFiles)
      .values(
        input.draft.files.map((file) => ({
          revisionId: revision!.id,
          filename: file.filename,
          content: file.content,
          checksumSha256: hashContent(file.content),
        })),
      );

    if ((input.draft.status ?? "draft") === "published") {
      await db
        .update(rolePackSets)
        .set({
          status: "published",
          updatedAt: new Date(),
        })
        .where(eq(rolePackSets.id, input.rolePackSetId));
    }

    const [refreshed] = await listRolePacks({
      companyId: input.companyId,
    }).then((rows) => rows.filter((row) => row.id === input.rolePackSetId));
    return refreshed ?? null;
  }

  async function getRolePack(input: {
    companyId: string;
    rolePackSetId: string;
  }) {
    const [found] = await listRolePacks({
      companyId: input.companyId,
    }).then((rows) => rows.filter((row) => row.id === input.rolePackSetId));
    return found ?? null;
  }

  async function listRevisions(input: {
    companyId: string;
    rolePackSetId: string;
  }): Promise<RolePackRevisionWithFiles[] | null> {
    const rolePackSet = await db
      .select({ id: rolePackSets.id })
      .from(rolePackSets)
      .where(and(eq(rolePackSets.companyId, input.companyId), eq(rolePackSets.id, input.rolePackSetId)))
      .then((rows) => rows[0] ?? null);
    if (!rolePackSet) return null;

    const revisions = await db
      .select()
      .from(rolePackRevisions)
      .where(eq(rolePackRevisions.rolePackSetId, input.rolePackSetId))
      .orderBy(desc(rolePackRevisions.version), desc(rolePackRevisions.createdAt));
    if (revisions.length === 0) return [];

    const files = await db
      .select()
      .from(rolePackFiles)
      .where(inArray(rolePackFiles.revisionId, revisions.map((revision) => revision.id)));

    return assembleRevisionViews({ revisions, files });
  }

  async function restoreRevision(input: {
    companyId: string;
    rolePackSetId: string;
    revisionId: string;
    actor: {
      userId?: string | null;
      agentId?: string | null;
    };
    restore: {
      message: string;
      status?: "draft" | "published";
    };
  }) {
    const rolePackSet = await db
      .select()
      .from(rolePackSets)
      .where(and(eq(rolePackSets.companyId, input.companyId), eq(rolePackSets.id, input.rolePackSetId)))
      .then((rows) => rows[0] ?? null);
    if (!rolePackSet) return null;

    const revisions = await db
      .select()
      .from(rolePackRevisions)
      .where(eq(rolePackRevisions.rolePackSetId, input.rolePackSetId))
      .orderBy(desc(rolePackRevisions.version), desc(rolePackRevisions.createdAt));
    const targetRevision = revisions.find((revision) => revision.id === input.revisionId) ?? null;
    if (!targetRevision) return null;

    const files = await db
      .select()
      .from(rolePackFiles)
      .where(inArray(rolePackFiles.revisionId, revisions.map((revision) => revision.id)));
    const filesByRevisionId = new Map<string, RolePackFileRow[]>();
    for (const file of files) {
      const current = filesByRevisionId.get(file.revisionId) ?? [];
      current.push(file);
      filesByRevisionId.set(file.revisionId, current);
    }

    const latestRevision = revisions[0] ?? null;
    const targetFiles = filesByRevisionId.get(input.revisionId) ?? [];
    const latestFiles = latestRevision ? (filesByRevisionId.get(latestRevision.id) ?? []) : [];

    if (targetFiles.length === 0) {
      throw unprocessable("Cannot restore a revision without role pack files");
    }
    if (latestRevision && latestRevision.id === targetRevision.id) {
      throw unprocessable("Selected revision is already the latest revision");
    }
    if (latestRevision && filesMatchByChecksum(targetFiles, latestFiles)) {
      throw unprocessable("Selected revision already matches the latest role pack content");
    }

    const nextVersion = (latestRevision?.version ?? 0) + 1;
    const status = input.restore.status ?? "draft";
    const [revision] = await db
      .insert(rolePackRevisions)
      .values({
        rolePackSetId: input.rolePackSetId,
        version: nextVersion,
        status,
        message: input.restore.message,
        createdByUserId: input.actor.userId ?? null,
        createdByAgentId: input.actor.agentId ?? null,
        publishedAt: status === "published" ? new Date() : null,
      })
      .returning();

    await db
      .insert(rolePackFiles)
      .values(
        targetFiles.map((file) => ({
          revisionId: revision!.id,
          filename: file.filename,
          content: file.content,
          checksumSha256: file.checksumSha256 || hashContent(file.content),
        })),
      );

    if (status === "published") {
      await db
        .update(rolePackSets)
        .set({
          status: "published",
          updatedAt: new Date(),
        })
        .where(eq(rolePackSets.id, input.rolePackSetId));
    }

    const [refreshed] = await listRolePacks({
      companyId: input.companyId,
    }).then((rows) => rows.filter((row) => row.id === input.rolePackSetId));
    return refreshed ?? null;
  }

  async function simulateRolePack(input: {
    companyId: string;
    rolePackSetId: string;
    simulation: RolePackSimulationRequest;
  }): Promise<RolePackSimulationResult | null> {
    const rolePack = await getRolePack({
      companyId: input.companyId,
      rolePackSetId: input.rolePackSetId,
    });
    if (!rolePack) return null;

    const compiledFiles = normalizeSimulationFiles({
      latestFiles: rolePack.latestFiles,
      draftFiles: input.simulation.draftFiles,
    });
    const checklist = buildSimulationChecklist(rolePack.roleKey, {
      ...input.simulation.scenario,
      taskBrief: input.simulation.scenario.taskBrief ?? null,
      retrievalSummary: input.simulation.scenario.retrievalSummary ?? null,
      blockerCode: input.simulation.scenario.blockerCode ?? null,
    });
    const guardrails = Array.from(
      new Set(
        compiledFiles.flatMap((file) =>
          listMarkdownBulletItems(file.content).filter((line) => /do not|never|must not|cannot/i.test(line))
        ),
      ),
    );
    return {
      companyId: input.companyId,
      rolePackSetId: rolePack.id,
      roleKey: rolePack.roleKey,
      revisionId: rolePack.latestRevision?.id ?? null,
      revisionVersion: rolePack.latestRevision?.version ?? null,
      scenario: {
        ...input.simulation.scenario,
        taskBrief: input.simulation.scenario.taskBrief ?? null,
        retrievalSummary: input.simulation.scenario.retrievalSummary ?? null,
        blockerCode: input.simulation.scenario.blockerCode ?? null,
      },
      compiledFiles,
      runtimePrompt: buildSimulationRuntimePrompt({
        roleKey: rolePack.roleKey,
        scenario: {
          ...input.simulation.scenario,
          taskBrief: input.simulation.scenario.taskBrief ?? null,
          retrievalSummary: input.simulation.scenario.retrievalSummary ?? null,
          blockerCode: input.simulation.scenario.blockerCode ?? null,
        },
        files: compiledFiles,
        checklist,
      }),
      checklist,
      guardrails,
      suggestedMessages: buildSimulationSuggestions(rolePack.roleKey, {
        ...input.simulation.scenario,
        taskBrief: input.simulation.scenario.taskBrief ?? null,
        retrievalSummary: input.simulation.scenario.retrievalSummary ?? null,
        blockerCode: input.simulation.scenario.blockerCode ?? null,
      }),
    };
  }

  return {
    listPresets: listRolePackPresets,
    listRolePacks,
    seedDefaults,
    createDraftRevision,
    getRolePack,
    listRevisions,
    restoreRevision,
    simulateRolePack,
  };
}
