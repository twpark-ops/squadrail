#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_ROOT = path.join(os.homedir(), "workspace", "cloud-swiftsight");
const DEFAULT_OUT = path.resolve(process.cwd(), "tmp/swiftsight-org-bundle");
const MANIFEST_NAME = "squadrail.manifest.json";
const COMPANY_COLOR = "#2563eb";
const DEFAULT_ROLE_PACK_PRESET = "example_large_org_v1";
const DEFAULT_CLAUDE_TIMEOUT_SEC = 900;
const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";
const PROTOCOL_HELPER_PATH = process.env.SQUADRAIL_PROTOCOL_HELPER_PATH
  ?? path.join(REPO_ROOT, "scripts", "runtime", "squadrail-protocol.mjs");

const PROJECT_CATALOG = [
  {
    slug: "swiftsight-cloud",
    name: "swiftsight-cloud",
    leadAgentSlug: "swiftsight-cloud-tl",
    description: "Primary cloud control plane owning DB-backed registry persistence, series/report metadata storage, Hasura-facing orchestration, Temporal workflows, and release-safe backend delivery.",
    language: "Go",
    stack: ["ConnectRPC", "Hasura", "Temporal", "RabbitMQ", "PostgreSQL"],
    knowledgePriority: "P0",
    documentationSignal: "high",
    baselineRepoState: "clean",
    defaultIsolationStrategy: "worktree",
    reviewFocus: [
      "API contract changes",
      "workflow orchestration safety",
      "data model migrations",
      "release rollback notes",
    ],
  },
  {
    slug: "swiftsight-agent",
    name: "swiftsight-agent",
    leadAgentSlug: "swiftsight-agent-tl",
    description: "Edge/runtime agent repo covering gRPC coordination, DICOM parsing/upload commands, and on-prem execution flows before cloud persistence takes over.",
    language: "Go",
    stack: ["gRPC", "DICOM", "RabbitMQ", "Command Execution"],
    knowledgePriority: "P0",
    documentationSignal: "high",
    baselineRepoState: "clean",
    defaultIsolationStrategy: "worktree",
    reviewFocus: [
      "DICOM protocol handling",
      "stream stability",
      "device compatibility",
      "command safety",
    ],
  },
  {
    slug: "swiftcl",
    name: "swiftcl",
    leadAgentSlug: "swiftcl-tl",
    description: "Compiler/CLI workspace for HCL workflows, Tree-sitter parsing, and developer tooling.",
    language: "Go",
    stack: ["HCL v2", "Tree-sitter", "LSP", "CLI Tooling"],
    knowledgePriority: "P0",
    documentationSignal: "high",
    baselineRepoState: "clean",
    defaultIsolationStrategy: "worktree",
    reviewFocus: [
      "compiler pipeline correctness",
      "generated workflow fidelity",
      "language tooling regressions",
      "CLI UX stability",
    ],
  },
  {
    slug: "swiftsight-report-server",
    name: "swiftsight-report-server",
    leadAgentSlug: "swiftsight-python-tl",
    description: "Python report generation service with RabbitMQ RPC, S3-backed artifacts, and validation-sensitive output formatting.",
    language: "Python",
    stack: ["Python", "RabbitMQ RPC", "S3", "Report Rendering"],
    knowledgePriority: "P1",
    documentationSignal: "medium",
    baselineRepoState: "clean",
    defaultIsolationStrategy: "worktree",
    reviewFocus: [
      "report correctness",
      "RPC timeout handling",
      "artifact persistence",
      "missing test coverage",
    ],
  },
  {
    slug: "swiftsight-worker",
    name: "swiftsight-worker",
    leadAgentSlug: "swiftsight-python-tl",
    description: "Python processing worker for Temporal-driven imaging pipelines, ML inference, and result materialization.",
    language: "Python",
    stack: ["Python", "Temporal SDK", "PyTorch", "S3", "Worker Pipelines"],
    knowledgePriority: "P1",
    documentationSignal: "medium",
    baselineRepoState: "dirty",
    defaultIsolationStrategy: "clone",
    reviewFocus: [
      "pipeline reproducibility",
      "inference correctness",
      "artifact consistency",
      "dirty-working-tree risk",
    ],
  },
];

function parseArgs(argv) {
  const args = [...argv];
  const out = { root: DEFAULT_ROOT, out: DEFAULT_OUT, companyName: "cloud-swiftsight" };
  while (args.length > 0) {
    const token = args.shift();
    if (token === "--root") out.root = path.resolve(args.shift() ?? DEFAULT_ROOT);
    else if (token === "--out") out.out = path.resolve(args.shift() ?? DEFAULT_OUT);
    else if (token === "--company-name") out.companyName = args.shift() ?? out.companyName;
    else if (token === "--help" || token === "-h") out.help = true;
  }
  return out;
}

function normalizeRepoState(result) {
  if (result === "clean" || result === "dirty" || result === "missing") return result;
  return "unknown";
}

function detectRepoState(repoPath) {
  try {
    const result = spawnSync("git", ["-C", repoPath, "status", "--porcelain"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (result.error) return "unknown";
    if (result.status !== 0) return "missing";
    return result.stdout.trim().length > 0 ? "dirty" : "clean";
  } catch {
    return "unknown";
  }
}

function pickIsolationStrategy(project, repoState) {
  if (repoState === "dirty") return "clone";
  return project.defaultIsolationStrategy;
}

function resolveRepoState(project, repoState) {
  if (repoState === "clean" || repoState === "dirty") return repoState;
  return project.baselineRepoState;
}

function describeIsolationStrategy(strategy, repoState) {
  if (strategy === "clone") {
    return repoState === "dirty"
      ? "clone is enforced because the source repo is dirty and must not receive shared implementation mutations."
      : "clone is enforced to keep implementation work detached from the shared review workspace.";
  }
  return "worktree is allowed because the shared source repo is clean enough for isolated implementation branches.";
}

function resolveBriefScope(agent) {
  if (agent.title === "Tech Lead") return "tech_lead";
  return agent.role;
}

function buildExecutionLoop(agent) {
  if (agent.title === "Tech Lead" || agent.role === "cto" || agent.role === "pm" || agent.role === "qa") {
    return [
      "Restate the issue goal, ownership boundary, and acceptance criteria before assigning work or changing state.",
      "Ground decisions in the latest brief, retrieval evidence, and nearby code or docs from the target repository.",
      "Route implementation to the correct project engineer lane only after reviewer ownership, validation expectations, and rollback concerns are explicit.",
    ];
  }

  return [
    "Inspect the latest brief, retrieval evidence, and nearby tests before planning or editing code.",
    "Use the shared workspace for analysis only; switch to the isolated implementation workspace before modifying files.",
    "Close each work cycle with changed files, commands run, test results, residual risk, and follow-up notes.",
  ];
}

function buildEscalationRules(agent) {
  const shared = [
    "Escalate when retrieval evidence is weak, stale, or missing for a repo-critical decision.",
    "Escalate when acceptance criteria, reviewer ownership, or release boundaries are ambiguous.",
  ];
  if (agent.title === "Tech Lead" || agent.role === "cto") {
    return [
      ...shared,
      "Escalate cross-repo schema, API, workflow, or rollout changes to CTO and QA before implementation starts.",
    ];
  }
  if (agent.role === "pm") {
    return [
      ...shared,
      "Escalate when product intent, scope, or documentation ownership conflicts with implementation pressure.",
    ];
  }
  if (agent.role === "qa") {
    return [
      ...shared,
      "Escalate when evidence is incomplete, reproduction is unstable, or system-level regression risk is under-described.",
    ];
  }
  return [
    ...shared,
    "Escalate before changing API contracts, migrations, infrastructure behavior, or rollout-sensitive configuration.",
  ];
}

function buildHandoffChecklist(agent) {
  if (agent.title === "Tech Lead" || agent.role === "cto" || agent.role === "pm") {
    return [
      "Named owner, reviewer, and target repository or project",
      "Acceptance criteria, explicit risks, and rollback or rollout notes when stateful behavior changes",
      "What evidence was used from RAG, docs, tests, or prior issues",
    ];
  }
  if (agent.role === "qa") {
    return [
      "Reproduction steps, commands or suites run, and pass or fail summary",
      "System-level regression notes and missing evidence called out explicitly",
      "Recommended next state transition with justification",
    ];
  }
  return [
    "Changed files and why each file changed",
    "Commands run, tests executed, and exact validation outcome",
    "Residual risk, follow-up items, and anything intentionally deferred",
  ];
}

function buildManagerApiQuickReference(agent) {
  if (!(agent.title === "Tech Lead" || agent.role === "cto" || agent.role === "pm" || agent.role === "qa")) {
    return [];
  }

  return [
    "## Manager API Quick Reference",
    "- `GET /api/companies/{companyId}/agents` returns a plain JSON array, not `{ agents: [...] }`.",
    "- To list candidates, filter the root array by role/title/urlKey. Example jq: `.[] | { id, name, role, title, urlKey, status }`.",
    "- In this org, individual contributors use `role: \"engineer\"` with `title: \"Engineer\"`. Project leads also use `role: \"engineer\"` but `title: \"Tech Lead\"`.",
    "- Safe IC staffing filter example: `.[] | select(.role == \"engineer\" and .title != \"Tech Lead\" and (.status == \"idle\" or .status == \"running\")) | { id, name, title, urlKey, status }`.",
    "- Project TLs still use protocol sender role `tech_lead` for `REASSIGN_TASK` and `CLOSE_TASK`, even though the agent record shows `role: \"engineer\"` with `title: \"Tech Lead\"`.",
    "- When a Project TL is already the active implementation owner, use sender role `engineer` for `ACK_ASSIGNMENT`, `START_IMPLEMENTATION`, `REPORT_PROGRESS`, and `SUBMIT_FOR_REVIEW`.",
    "- In `claude_local`, `curl` and `wget` may be blocked by context-mode. Prefer `node --input-type=module -e` with `fetch(...)` for Squadrail API calls.",
    `- Preferred control-plane helper on this machine: \`node ${PROTOCOL_HELPER_PATH}\`. It already uses \`SQUADRAIL_API_URL\`, \`SQUADRAIL_API_KEY\`, \`SQUADRAIL_AGENT_ID\`, \`SQUADRAIL_RUN_ID\`, and \`SQUADRAIL_TASK_ID\`.`,
    `- Prefer helper commands over ad-hoc curl/tool search: \`resolve-agent <slug>\`, \`get-brief --scope <role>\`, \`reassign-task\`, \`start-review\`, \`request-changes\`, \`request-human-decision\`, \`approve-implementation\`, \`close-task\`.`,
    `- Example staffing command: \`node ${PROTOCOL_HELPER_PATH} reassign-task --issue $SQUADRAIL_TASK_ID --sender-role ${resolveBriefScope(agent)} --assignee-id <engineer-uuid> --assignee-role engineer --reviewer-id <reviewer-uuid> --summary "Route implementation" --reason "Staffing the execution lane"\`.`,
    `- Example brief read: \`node ${PROTOCOL_HELPER_PATH} get-brief --issue $SQUADRAIL_TASK_ID --scope ${resolveBriefScope(agent)}\`.`,
    "- If the issue description already provides the target agent slug and UUID, reuse that directly instead of listing agents again.",
    "- When routing work, prefer `REASSIGN_TASK` if the issue is already assigned and you need to transfer ownership.",
    "- Keep the reviewer explicit in every staffing decision and preserve QA ownership when the board asks for QA review.",
    "- Route through the project TL lane before implementation when the issue starts at PM or CTO scope.",
    "- On a fresh assignment wake, route or clarify first. Do not inspect repository files before the first protocol action is recorded.",
    "- Do not PATCH issue ownership directly from the repo workspace. Move ownership only through protocol messages, or keep the current TL as primary engineer and implement directly.",
  ];
}

function agentMarkdown(input) {
  const briefScope = resolveBriefScope(input);
  return `---
kind: agent
name: ${JSON.stringify(input.name)}
role: ${JSON.stringify(input.role)}
title: ${JSON.stringify(input.title)}
reportsToSlug: ${input.reportsToSlug ? JSON.stringify(input.reportsToSlug) : "null"}
---

# ${input.title}

You operate inside the SwiftSight organization bootstrap for Squadrail.

## Reporting Line
- Report to: ${input.reportsToSlug ?? "board / none"}
- Primary project: ${input.projectSlug ?? "cross-project"}
- Discipline: ${input.discipline ?? "cross-functional"}
- Execution engine: ${input.adapterType}
- Delivery lane: ${input.deliveryLane ?? "general"}

## Responsibilities
${input.responsibilities.map((line) => `- ${line}`).join("\n")}

## Technical Focus
${input.focusAreas.map((line) => `- ${line}`).join("\n")}

## Execution Loop
${buildExecutionLoop(input).map((line) => `- ${line}`).join("\n")}

## Escalation Gates
${buildEscalationRules(input).map((line) => `- ${line}`).join("\n")}

## Required Handoff Shape
${buildHandoffChecklist(input).map((line) => `- ${line}`).join("\n")}

${buildManagerApiQuickReference(input).join("\n")}

## Operating Rules
- Use structured protocol messages, not casual chat.
- Fetch the latest role brief before acting:
  - \`GET /api/issues/{issueId}/protocol/briefs?latest=true&scope=${briefScope}\`
  - If a \`retrievalRunId\` is present, inspect supporting evidence with \`GET /api/knowledge/retrieval-runs/{retrievalRunId}/hits\`
- Use the latest brief and retrieval evidence before acting.
- Respect workspace policy. Shared workspaces are for analysis/review; isolated workspaces are for implementation.
- Never edit code in a shared workspace.
- During review, treat submitted diff/test artifacts and implementation workspace binding as the source of truth. The shared workspace may still reflect base HEAD and not the isolated implementation branch.
- Include changed files, tests, risks, and follow-up items whenever work changes state.
`;
}

function sharedWorkspace(root, project, repoState) {
  return {
    name: "shared",
    cwd: path.join(root, project.slug),
    repoUrl: null,
    repoRef: "HEAD",
    metadata: {
      purpose: "shared-analysis-review",
      projectSlug: project.slug,
      language: project.language,
      stack: project.stack,
      repoState,
      documentationSignal: project.documentationSignal,
      knowledgePriority: project.knowledgePriority,
    },
    executionPolicy: {
      mode: "shared",
      applyFor: ["analysis", "review"],
      writable: false,
    },
    isPrimary: true,
  };
}

function implementationWorkspace(root, project, repoState) {
  const strategy = pickIsolationStrategy(project, repoState);
  const isolatedDirName = strategy === "clone" ? ".squadrail-clones" : ".squadrail-worktrees";
  return {
    name: "implementation",
    cwd: path.join(root, project.slug),
    repoUrl: null,
    repoRef: "HEAD",
    metadata: {
      purpose: "isolated-implementation-template",
      projectSlug: project.slug,
      language: project.language,
      stack: project.stack,
      repoState,
      isolationNote: describeIsolationStrategy(strategy, repoState),
      cleanupPolicy: "manual-prune",
    },
    executionPolicy: {
      mode: "isolated",
      applyFor: ["implementation"],
      isolationStrategy: strategy,
      isolatedRoot: path.join(root, isolatedDirName, project.slug),
      branchTemplate: "squadrail/{projectId}/{agentId}/{issueId}",
      writable: true,
    },
    isPrimary: false,
  };
}

function buildProjects(root) {
  return PROJECT_CATALOG.map((project) => {
    const repoState = resolveRepoState(
      project,
      normalizeRepoState(detectRepoState(path.join(root, project.slug))),
    );
    return {
      slug: project.slug,
      name: project.name,
      description: project.description,
      status: "backlog",
      leadAgentSlug: project.leadAgentSlug,
      targetDate: null,
      color: null,
      archivedAt: null,
      workspaces: [
        sharedWorkspace(root, project, repoState),
        implementationWorkspace(root, project, repoState),
      ],
      repoState,
    };
  });
}

function topLevelAgents() {
  return [
    {
      slug: "swiftsight-cto",
      name: "SwiftSight CTO",
      role: "cto",
      title: "CTO",
      reportsToSlug: null,
      adapterType: "claude_local",
      projectSlug: null,
      discipline: "cross-project architecture",
      capabilities: "cross-project orchestration, technical strategy, final review synthesis",
      responsibilities: [
        "Own cross-project orchestration and final technical synthesis.",
        "Route company-wide work into TL-owned sub-issues and consolidate outcomes.",
        "Approve company-level technical direction after TL and QA evidence lands.",
      ],
      focusAreas: [
        "program-level architecture",
        "cross-repo dependency management",
        "release sequencing",
        "technical risk prioritization",
      ],
    },
    {
      slug: "swiftsight-pm",
      name: "SwiftSight PM",
      role: "pm",
      title: "PM",
      reportsToSlug: "swiftsight-cto",
      adapterType: "claude_local",
      projectSlug: null,
      discipline: "product requirements",
      capabilities: "requirements clarification, documentation debt tracking, acceptance criteria",
      responsibilities: [
        "Clarify requirements, scope boundaries, and acceptance criteria.",
        "Track documentation debt, especially in Python-heavy repos.",
        "Convert cross-project requests into issue-ready requirements for TLs.",
      ],
      focusAreas: [
        "PRD to issue decomposition",
        "documentation freshness",
        "cross-project dependency notes",
        "release communication",
      ],
    },
    {
      slug: "swiftsight-qa-lead",
      name: "SwiftSight QA Lead",
      role: "qa",
      title: "QA Lead",
      reportsToSlug: "swiftsight-cto",
      adapterType: "claude_local",
      projectSlug: null,
      discipline: "validation governance",
      capabilities: "regression triage, release safety, evidence quality",
      responsibilities: [
        "Own cross-project validation and regression triage.",
        "Escalate missing test evidence, reproducibility gaps, and release blockers.",
        "Normalize severity and evidence quality across project outputs.",
      ],
      focusAreas: [
        "integration risk",
        "test evidence quality",
        "release readiness",
        "regression prioritization",
      ],
    },
    {
      slug: "swiftsight-qa-engineer",
      name: "SwiftSight QA Engineer",
      role: "qa",
      title: "QA Engineer",
      reportsToSlug: "swiftsight-qa-lead",
      adapterType: "codex_local",
      projectSlug: null,
      discipline: "verification execution",
      capabilities: "test reproduction, validation scripts, evidence capture",
      responsibilities: [
        "Execute validation tasks and collect reproduction evidence.",
        "Run targeted verification across project boundaries as requested by QA Lead.",
      ],
      focusAreas: [
        "reproducible test steps",
        "evidence packaging",
        "integration checks",
      ],
    },
    {
      slug: "swiftsight-cloud-tl",
      name: "SwiftSight Cloud TL",
      role: "engineer",
      title: "Tech Lead",
      reportsToSlug: "swiftsight-cto",
      adapterType: "claude_local",
      projectSlug: "swiftsight-cloud",
      discipline: "go cloud",
      capabilities: "ConnectRPC, Hasura, Temporal, PostgreSQL, RabbitMQ",
      responsibilities: [
        "Own swiftsight-cloud task decomposition, design review, and release-safe implementation guidance.",
        "Coordinate API, workflow, and schema changes with QA and CTO when risk crosses repo boundaries.",
      ],
      focusAreas: [
        "ConnectRPC contracts",
        "workflow orchestration",
        "schema migrations",
        "rollback planning",
      ],
    },
    {
      slug: "swiftsight-agent-tl",
      name: "SwiftSight Agent TL",
      role: "engineer",
      title: "Tech Lead",
      reportsToSlug: "swiftsight-cto",
      adapterType: "claude_local",
      projectSlug: "swiftsight-agent",
      discipline: "go edge agent",
      capabilities: "gRPC, DICOM, command execution, RabbitMQ",
      responsibilities: [
        "Own swiftsight-agent task decomposition and review.",
        "Protect DICOM protocol compatibility and operational safety for agent-side changes.",
      ],
      focusAreas: [
        "DICOM parsing",
        "gRPC streams",
        "command safety",
        "edge compatibility",
      ],
    },
    {
      slug: "swiftcl-tl",
      name: "SwiftCL TL",
      role: "engineer",
      title: "Tech Lead",
      reportsToSlug: "swiftsight-cto",
      adapterType: "claude_local",
      projectSlug: "swiftcl",
      discipline: "go compiler tooling",
      capabilities: "HCL v2, Tree-sitter, LSP, compiler pipeline",
      responsibilities: [
        "Own swiftcl decomposition, compiler correctness review, and tooling delivery.",
        "Protect workflow generation fidelity and language-tooling stability.",
      ],
      focusAreas: [
        "parser correctness",
        "compiler stages",
        "CLI ergonomics",
        "language tooling regressions",
      ],
    },
    {
      slug: "swiftsight-python-tl",
      name: "SwiftSight Python TL",
      role: "engineer",
      title: "Tech Lead",
      reportsToSlug: "swiftsight-cto",
      adapterType: "claude_local",
      projectSlug: null,
      discipline: "python platform",
      capabilities: "Python, RabbitMQ, Temporal SDK, testing, ML-adjacent services",
      responsibilities: [
        "Own Python project delivery for swiftsight-report-server and swiftsight-worker.",
        "Drive documentation recovery, test expectations, and implementation risk triage for Python repos.",
      ],
      focusAreas: [
        "worker pipelines",
        "report generation",
        "test strategy",
        "release-safe Python changes",
      ],
    },
  ];
}

function projectEngineerReportsTo(project) {
  const reportsToSlug =
    project.slug === "swiftsight-report-server" || project.slug === "swiftsight-worker"
      ? "swiftsight-python-tl"
      : `${project.slug}-tl`;
  return reportsToSlug;
}

function projectEngineers(project) {
  const reportsToSlug = projectEngineerReportsTo(project);
  return [
    {
      slug: `${project.slug}-codex-engineer`,
      name: `${project.slug} Codex Engineer`,
      role: "engineer",
      title: "Engineer",
      reportsToSlug,
      adapterType: "codex_local",
      projectSlug: project.slug,
      discipline: `${project.language.toLowerCase()} implementation`,
      deliveryLane: "implementation",
      capabilities: `${project.language} implementation, ${project.stack.join(", ")}`,
      responsibilities: [
        `Implement assigned ${project.slug} work with explicit evidence, changed files, and test notes.`,
        "Own isolated-workspace edits, focused validation runs, and review-ready delivery artifacts.",
        "Escalate to the paired Claude engineer or TL when retrieval is weak, scope is unclear, or the patch needs broader design synthesis.",
      ],
      focusAreas: [
        ...project.stack,
        ...project.reviewFocus,
        "isolated workspace execution",
        "test/build verification",
      ],
    },
    {
      slug: `${project.slug}-claude-engineer`,
      name: `${project.slug} Claude Engineer`,
      role: "engineer",
      title: "Engineer",
      reportsToSlug,
      adapterType: "claude_local",
      projectSlug: project.slug,
      discipline: `${project.language.toLowerCase()} analysis`,
      deliveryLane: "analysis",
      capabilities: `${project.language} analysis, design decomposition, ${project.stack.join(", ")}`,
      responsibilities: [
        `Own planning, retrieval-grounded analysis, and implementation design for ${project.slug}.`,
        "Prepare file targets, acceptance criteria, and rollout notes before deep implementation begins.",
        "Support the paired Codex engineer with design clarification, edge-case review, and evidence synthesis.",
      ],
      focusAreas: [
        ...project.stack,
        ...project.reviewFocus,
        "brief synthesis",
        "design decomposition",
        "evidence packaging",
      ],
    },
  ];
}

function buildAgents() {
  const defs = [...topLevelAgents()];
  for (const project of PROJECT_CATALOG) {
    defs.push(...projectEngineers(project));
  }

  const buildAdapterConfig = (adapterType) => {
    if (adapterType === "claude_local") {
      return {
        dangerouslySkipPermissions: true,
        timeoutSec: DEFAULT_CLAUDE_TIMEOUT_SEC,
      };
    }
    if (adapterType === "codex_local") {
      return {
        model: DEFAULT_CODEX_MODEL,
        dangerouslyBypassApprovalsAndSandbox: true,
      };
    }
    return {};
  };

  return defs.map((agent) => ({
    slug: agent.slug,
    name: agent.name,
    path: `agents/${agent.slug}/AGENTS.md`,
    role: agent.role,
    title: agent.title,
    icon: null,
    capabilities: agent.capabilities,
    reportsToSlug: agent.reportsToSlug,
    adapterType: agent.adapterType,
    adapterConfig: buildAdapterConfig(agent.adapterType),
    runtimeConfig: {},
    permissions: {},
    budgetMonthlyCents: 0,
    metadata: {
      projectSlug: agent.projectSlug,
      discipline: agent.discipline,
      executionEngine: agent.adapterType,
      briefScope: resolveBriefScope(agent),
      deliveryLane: agent.deliveryLane ?? null,
    },
    markdown: agentMarkdown(agent),
  }));
}

function renderBundleReadme(input) {
  return [
    "# SwiftSight Org Bundle",
    "",
    `Generated for \`${input.companyName}\` on \`${input.generatedAt}\`.`,
    "",
    "## Import",
    "",
    "```bash",
    "pnpm squadrail company import \\",
    `  --from ${input.bundleDir} \\`,
    "  --target new \\",
    `  --new-company-name ${input.companyName}`,
    "```",
    "",
    "## After Import",
    "",
    `1. Seed the \`${DEFAULT_ROLE_PACK_PRESET}\` role pack preset for the new company.`,
    "2. Verify Claude Code and Codex environment readiness in the Doctor panel.",
    "3. Run workspace imports for all five projects before assigning the first cross-project review issue.",
    "4. Keep same-repo implementation inside isolated workspaces only.",
    "5. Use the paired engineer model: Claude engineer for analysis/design, Codex engineer for code changes and verification unless the TL intentionally overrides it.",
    "",
    "## Repo Policy Snapshot",
    "",
    ...input.projects.map((project) => {
      const shared = project.workspaces.find((workspace) => workspace.name === "shared");
      const implementation = project.workspaces.find((workspace) => workspace.name === "implementation");
      const repoState = shared?.metadata?.repoState ?? "unknown";
      const isolation = implementation?.executionPolicy?.isolationStrategy ?? "worktree";
      return `- \`${project.slug}\`: repoState=\`${repoState}\`, implementation=\`${isolation}\``;
    }),
  ].join("\n");
}

function renderOperatingModel(projects) {
  return [
    "# Operating Model",
    "",
    "## Routing",
    "",
    "- Company-wide review or architecture request -> CTO",
    "- Project-scoped implementation -> project TL",
    "- Validation and regression escalation -> QA Lead",
    "- Requirements clarification and documentation debt -> PM",
    "",
    "## Workspace Rules",
    "",
    "- Shared workspaces are for analysis and review.",
    "- Isolated workspaces are required for implementation.",
    "- Same-repo concurrent implementation is allowed only through isolated workspaces.",
    "",
    "## Engineer Pairing",
    "",
    "- Each project has a Claude engineer and a Codex engineer.",
    "- Claude engineer owns analysis, design synthesis, and retrieval-grounded planning.",
    "- Codex engineer owns isolated implementation, command execution, and review-ready artifacts.",
    "- Tech Leads may override the default split only when the issue explicitly requires it.",
    "",
    "## Project Summary",
    "",
    ...projects.flatMap((project) => {
      const shared = project.workspaces.find((workspace) => workspace.name === "shared");
      const implementation = project.workspaces.find((workspace) => workspace.name === "implementation");
      return [
        `### ${project.slug}`,
        `- Lead: ${project.leadAgentSlug}`,
        `- Shared path: ${shared?.cwd ?? "n/a"}`,
        `- Implementation strategy: ${implementation?.executionPolicy?.isolationStrategy ?? "worktree"}`,
        `- Review focus: ${(shared?.metadata?.stack ?? []).join(", ") || "n/a"}`,
      ];
    }),
  ].join("\n");
}

function renderRagPlan(projects) {
  return [
    "# RAG Index Plan",
    "",
    "## P0 Import Order",
    "",
    "1. swiftsight-cloud",
    "2. swiftsight-agent",
    "3. swiftcl",
    "4. swiftsight-report-server",
    "5. swiftsight-worker",
    "",
    "## Agent Consumption Model",
    "",
    "- Claude engineers read broad architectural and documentation context first.",
    "- Codex engineers consume narrowed implementation context and validation evidence.",
    "- Tech Leads and QA watch degraded brief quality before allowing implementation to continue.",
    "",
    "## Focus",
    "",
    ...projects.map((project) => {
      const shared = project.workspaces.find((workspace) => workspace.name === "shared");
      const stack = Array.isArray(shared?.metadata?.stack) ? shared.metadata.stack : [];
      const repoState = shared?.metadata?.repoState ?? "unknown";
      return `- \`${project.slug}\`: priority=${shared?.metadata?.knowledgePriority ?? "P1"}, repoState=${repoState}, focus=${stack.join(", ")}`;
    }),
    "",
    "## Special Notes",
    "",
    "- swiftsight-worker should start from read-heavy ingestion and isolated clone-based implementation.",
    "- swiftsight-report-server should get QA attention early because test density is weak.",
  ].join("\n");
}

function renderCompanyMarkdown(input) {
  return [
    "---",
    "kind: company",
    `name: ${JSON.stringify(input.companyName)}`,
    "---",
    "",
    `# ${input.companyName}`,
    "",
    "SwiftSight organization bootstrap bundle for Squadrail.",
    "",
    "## Included Projects",
    ...input.projects.map((project) => `- ${project.slug}`),
    "",
    "## Included Roles",
    "- CTO",
    "- PM",
    "- QA Lead / QA Engineer",
    "- Project Tech Leads",
    "- Two engineers per project (Claude + Codex)",
  ].join("\n");
}

async function writeBundleFiles(input) {
  await fs.mkdir(input.out, { recursive: true });

  await fs.writeFile(
    path.join(input.out, MANIFEST_NAME),
    JSON.stringify(input.manifest, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(input.out, "COMPANY.md"),
    renderCompanyMarkdown(input),
    "utf8",
  );
  await fs.writeFile(
    path.join(input.out, "README.md"),
    renderBundleReadme({
      companyName: input.companyName,
      generatedAt: input.generatedAt,
      bundleDir: input.out,
      projects: input.projects,
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(input.out, "OPERATING_MODEL.md"),
    renderOperatingModel(input.projects),
    "utf8",
  );
  await fs.writeFile(
    path.join(input.out, "RAG_INDEX_PLAN.md"),
    renderRagPlan(input.projects),
    "utf8",
  );

  for (const agent of input.agents) {
    const filePath = path.join(input.out, agent.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, agent.markdown, "utf8");
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("Usage: node scripts/bootstrap/generate-swiftsight-org-bundle.mjs [--root <path>] [--out <path>] [--company-name <name>]");
    process.exit(0);
  }

  const generatedAt = new Date().toISOString();
  const projects = buildProjects(opts.root);
  const agents = buildAgents();
  const manifest = {
    schemaVersion: 1,
    generatedAt,
    source: null,
    includes: {
      company: true,
      projects: true,
      agents: true,
    },
    company: {
      path: "COMPANY.md",
      name: opts.companyName,
      description: "SwiftSight organization bootstrap bundle for Squadrail.",
      brandColor: COMPANY_COLOR,
      requireBoardApprovalForNewAgents: true,
    },
    projects: projects.map(({ repoState: _repoState, ...project }) => project),
    agents: agents.map(({ markdown: _markdown, ...agent }) => agent),
    requiredSecrets: [],
  };

  await writeBundleFiles({
    out: opts.out,
    companyName: opts.companyName,
    generatedAt,
    manifest,
    projects,
    agents,
  });

  console.log(JSON.stringify({
    ok: true,
    out: opts.out,
    manifest: path.join(opts.out, MANIFEST_NAME),
    projects: projects.length,
    agents: agents.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
