import type { Db } from "@squadrail/db";
import {
  normalizeAgentUrlKey,
  normalizeProjectUrlKey,
  type SetupProgressView,
  type TeamBlueprint,
  type TeamBlueprintCatalogView,
  type TeamBlueprintPreviewParameters,
  type TeamBlueprintPreviewProjectDiff,
  type TeamBlueprintPreviewRequest,
  type TeamBlueprintPreviewResult,
  type TeamBlueprintRoleTemplate,
} from "@squadrail/shared";
import { notFound } from "../errors.js";
import { agentService } from "./agents.js";
import { projectService } from "./projects.js";
import { setupProgressService } from "./setup-progress.js";

const DEFAULT_TEAM_BLUEPRINTS: TeamBlueprint[] = [
  {
    key: "small_delivery_team",
    label: "Small Delivery Team",
    description:
      "A compact delivery squad with one tech lead, one engineer, and one reviewer for a single primary workspace.",
    presetKey: "squadrail_default_v1",
    projects: [
      {
        key: "primary_product",
        label: "Primary Product",
        description: "Single delivery project for the company's first production workspace.",
        kind: "product",
        repositoryHint: "Connect one main repository workspace before the first quick request.",
        defaultLeadRoleKey: "tech_lead",
      },
    ],
    roles: [
      {
        key: "tech_lead",
        label: "Tech Lead",
        role: "engineer",
        title: "Tech Lead",
        reportsToKey: null,
        projectBinding: "shared",
        preferredAdapterTypes: ["claude_local"],
        deliveryLane: "planning",
        capabilities: ["scoping", "task routing", "review bar"],
      },
      {
        key: "engineer",
        label: "Engineer",
        role: "engineer",
        title: "Engineer",
        reportsToKey: "tech_lead",
        projectBinding: "shared",
        preferredAdapterTypes: ["codex_local", "claude_local"],
        deliveryLane: "implementation",
        capabilities: ["implementation", "focused testing", "handoff notes"],
      },
      {
        key: "reviewer",
        label: "Reviewer",
        role: "engineer",
        title: "Reviewer",
        reportsToKey: "tech_lead",
        projectBinding: "shared",
        preferredAdapterTypes: ["claude_local", "codex_local"],
        deliveryLane: "review",
        capabilities: ["review", "risk capture", "close evidence"],
      },
    ],
    parameterHints: {
      supportsPm: false,
      supportsQa: false,
      supportsCto: false,
      defaultProjectCount: 1,
      defaultEngineerPairsPerProject: 1,
    },
    readiness: {
      requiredWorkspaceCount: 1,
      knowledgeRequired: true,
      knowledgeSources: ["project_docs", "codebase", "past_issues"],
      approvalRequiredRoleKeys: ["tech_lead"],
      doctorSetupPrerequisites: ["workspace_connected", "execution_engine_selected", "doctor_clean"],
      recommendedFirstQuickRequest:
        "Review the connected repository, confirm the workspace is healthy, and propose the first delivery slice with explicit acceptance criteria.",
    },
  },
  {
    key: "standard_product_squad",
    label: "Standard Product Squad",
    description:
      "A product squad with PM coordination, one lead per project, delivery engineers, and reviewers across two default projects.",
    presetKey: "example_product_squad_v1",
    projects: [
      {
        key: "product_app",
        label: "Product App",
        description: "Customer-facing application or frontend repository.",
        kind: "product",
        repositoryHint: "Connect the primary app workspace and documentation for release-facing issues.",
        defaultLeadRoleKey: "app_tech_lead",
      },
      {
        key: "product_api",
        label: "Product API",
        description: "Backend or service repository paired with the product app.",
        kind: "service",
        repositoryHint: "Connect the backend workspace and seed API docs before intake projection.",
        defaultLeadRoleKey: "backend_tech_lead",
      },
    ],
    roles: [
      {
        key: "pm",
        label: "PM",
        role: "pm",
        title: "PM",
        reportsToKey: null,
        projectBinding: "none",
        preferredAdapterTypes: ["claude_local"],
        deliveryLane: "planning",
        capabilities: ["requirements_structuring", "clarification", "projection"],
      },
      {
        key: "app_tech_lead",
        label: "App Tech Lead",
        role: "engineer",
        title: "Tech Lead",
        reportsToKey: "pm",
        projectBinding: "per_project",
        preferredAdapterTypes: ["claude_local"],
        deliveryLane: "planning",
        capabilities: ["task_breakdown", "handoff", "review_routing"],
      },
      {
        key: "backend_tech_lead",
        label: "Backend Tech Lead",
        role: "engineer",
        title: "Tech Lead",
        reportsToKey: "pm",
        projectBinding: "per_project",
        preferredAdapterTypes: ["claude_local"],
        deliveryLane: "planning",
        capabilities: ["task_breakdown", "integration_scope", "review_routing"],
      },
      {
        key: "engineer",
        label: "Engineer",
        role: "engineer",
        title: "Engineer",
        reportsToKey: "app_tech_lead",
        projectBinding: "per_project",
        preferredAdapterTypes: ["codex_local", "claude_local"],
        deliveryLane: "implementation",
        capabilities: ["implementation", "tests", "evidence_capture"],
      },
      {
        key: "reviewer",
        label: "Reviewer",
        role: "engineer",
        title: "Reviewer",
        reportsToKey: "pm",
        projectBinding: "per_project",
        preferredAdapterTypes: ["claude_local", "codex_local"],
        deliveryLane: "review",
        capabilities: ["review", "risk_identification", "close_readiness"],
      },
    ],
    parameterHints: {
      supportsPm: true,
      supportsQa: false,
      supportsCto: false,
      defaultProjectCount: 2,
      defaultEngineerPairsPerProject: 1,
    },
    readiness: {
      requiredWorkspaceCount: 2,
      knowledgeRequired: true,
      knowledgeSources: ["product_docs", "api_docs", "codebase", "past_issues"],
      approvalRequiredRoleKeys: ["pm", "app_tech_lead", "backend_tech_lead"],
      doctorSetupPrerequisites: [
        "workspace_connected_for_each_project",
        "knowledge_seeded_for_primary_projects",
        "doctor_clean",
      ],
      recommendedFirstQuickRequest:
        "Take one customer-visible request, let PM turn it into an execution-ready issue, and route it through app or backend TL ownership with reviewer evidence.",
    },
  },
  {
    key: "delivery_plus_qa",
    label: "Delivery + QA Team",
    description:
      "A reusable delivery organization with PM, QA, multiple project leads, and reviewer coverage for release-sensitive work.",
    presetKey: "example_large_org_v1",
    projects: [
      {
        key: "app_surface",
        label: "App Surface",
        description: "Primary application repository for user-facing delivery.",
        kind: "product",
        repositoryHint: "Connect the app workspace and release notes knowledge source.",
        defaultLeadRoleKey: "product_tech_lead",
      },
      {
        key: "platform_services",
        label: "Platform Services",
        description: "Backend, worker, or platform service repository.",
        kind: "service",
        repositoryHint: "Connect backend and worker workspaces before enabling QA loops.",
        defaultLeadRoleKey: "platform_tech_lead",
      },
    ],
    roles: [
      {
        key: "cto",
        label: "CTO",
        role: "cto",
        title: "CTO",
        reportsToKey: null,
        projectBinding: "none",
        preferredAdapterTypes: ["claude_local"],
        deliveryLane: "oversight",
        capabilities: ["cross_project_orchestration", "final_review_synthesis", "risk_escalation"],
      },
      {
        key: "pm",
        label: "PM",
        role: "pm",
        title: "PM",
        reportsToKey: "cto",
        projectBinding: "none",
        preferredAdapterTypes: ["claude_local"],
        deliveryLane: "planning",
        capabilities: ["intake_structuring", "clarification", "projection"],
      },
      {
        key: "qa_lead",
        label: "QA Lead",
        role: "qa",
        title: "QA Lead",
        reportsToKey: "cto",
        projectBinding: "shared",
        preferredAdapterTypes: ["claude_local", "codex_local"],
        deliveryLane: "qa",
        capabilities: ["release_safety", "qa_bar", "regression_triage"],
      },
      {
        key: "product_tech_lead",
        label: "Product Tech Lead",
        role: "engineer",
        title: "Tech Lead",
        reportsToKey: "pm",
        projectBinding: "per_project",
        preferredAdapterTypes: ["claude_local"],
        deliveryLane: "planning",
        capabilities: ["task_breakdown", "review_routing", "implementation_scope"],
      },
      {
        key: "platform_tech_lead",
        label: "Platform Tech Lead",
        role: "engineer",
        title: "Tech Lead",
        reportsToKey: "pm",
        projectBinding: "per_project",
        preferredAdapterTypes: ["claude_local"],
        deliveryLane: "planning",
        capabilities: ["cross_service_scope", "review_routing", "integration_risk"],
      },
      {
        key: "engineer",
        label: "Engineer",
        role: "engineer",
        title: "Engineer",
        reportsToKey: "product_tech_lead",
        projectBinding: "per_project",
        preferredAdapterTypes: ["codex_local", "claude_local"],
        deliveryLane: "implementation",
        capabilities: ["implementation", "focused_testing", "handoff_notes"],
      },
      {
        key: "reviewer",
        label: "Reviewer",
        role: "engineer",
        title: "Reviewer",
        reportsToKey: "qa_lead",
        projectBinding: "per_project",
        preferredAdapterTypes: ["claude_local", "codex_local"],
        deliveryLane: "review",
        capabilities: ["review", "qa_handoff", "change_bar"],
      },
    ],
    parameterHints: {
      supportsPm: true,
      supportsQa: true,
      supportsCto: true,
      defaultProjectCount: 2,
      defaultEngineerPairsPerProject: 1,
    },
    readiness: {
      requiredWorkspaceCount: 2,
      knowledgeRequired: true,
      knowledgeSources: ["release_docs", "codebase", "past_issues", "review_outcomes"],
      approvalRequiredRoleKeys: ["cto", "pm", "qa_lead", "product_tech_lead", "platform_tech_lead"],
      doctorSetupPrerequisites: [
        "workspace_connected_for_each_project",
        "knowledge_seeded_for_each_project",
        "review_and_qa_agents_ready",
        "doctor_clean",
      ],
      recommendedFirstQuickRequest:
        "Use a release-sensitive issue that requires PM clarification, TL delegation, reviewer evidence, and QA sign-off before closure.",
    },
  },
];

type PreviewProjectLike = {
  id: string;
  name: string;
  urlKey: string;
  workspaces: Array<{ id: string }>;
};

type PreviewAgentLike = {
  id: string;
  name: string;
  urlKey: string;
  role: string;
  title: string | null;
  metadata: Record<string, unknown> | null;
};

function cloneBlueprint(blueprint: TeamBlueprint): TeamBlueprint {
  return {
    ...blueprint,
    projects: blueprint.projects.map((project) => ({ ...project })),
    roles: blueprint.roles.map((role) => ({
      ...role,
      preferredAdapterTypes: [...role.preferredAdapterTypes],
      capabilities: [...role.capabilities],
    })),
    parameterHints: { ...blueprint.parameterHints },
    readiness: {
      ...blueprint.readiness,
      knowledgeSources: [...blueprint.readiness.knowledgeSources],
      approvalRequiredRoleKeys: [...blueprint.readiness.approvalRequiredRoleKeys],
      doctorSetupPrerequisites: [...blueprint.readiness.doctorSetupPrerequisites],
    },
  };
}

function readMetadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveBlueprint(blueprintKey: TeamBlueprint["key"]) {
  return DEFAULT_TEAM_BLUEPRINTS.find((blueprint) => blueprint.key === blueprintKey) ?? null;
}

export function resolveTeamBlueprintPreviewParameters(
  blueprint: TeamBlueprint,
  input: TeamBlueprintPreviewRequest | undefined,
): TeamBlueprintPreviewParameters {
  return {
    projectCount: Math.max(1, Math.min(20, input?.projectCount ?? blueprint.parameterHints.defaultProjectCount)),
    engineerPairsPerProject: Math.max(
      1,
      Math.min(10, input?.engineerPairsPerProject ?? blueprint.parameterHints.defaultEngineerPairsPerProject),
    ),
    includePm: input?.includePm ?? blueprint.parameterHints.supportsPm,
    includeQa: input?.includeQa ?? blueprint.parameterHints.supportsQa,
    includeCto: input?.includeCto ?? blueprint.parameterHints.supportsCto,
  };
}

function expandBlueprintProjects(
  blueprint: TeamBlueprint,
  parameters: TeamBlueprintPreviewParameters,
) {
  return Array.from({ length: parameters.projectCount }, (_, index) => {
    const template = blueprint.projects[index % blueprint.projects.length]!;
    const cycle = Math.floor(index / blueprint.projects.length) + 1;
    return {
      slotKey: cycle === 1 ? template.key : `${template.key}_${cycle}`,
      templateKey: template.key,
      label: cycle === 1 ? template.label : `${template.label} ${cycle}`,
      kind: template.kind,
      repositoryHint: template.repositoryHint,
    };
  });
}

function scoreProjectMatch(
  slot: ReturnType<typeof expandBlueprintProjects>[number],
  project: PreviewProjectLike,
  index: number,
) {
  const slotKey = normalizeProjectUrlKey(slot.templateKey);
  const slotLabel = normalizeProjectUrlKey(slot.label);
  const projectName = normalizeProjectUrlKey(project.name);
  let score = 0;
  if (slotKey && project.urlKey === slotKey) score += 4;
  if (slotLabel && projectName === slotLabel) score += 3;
  if (slot.templateKey === "primary_product" && index === 0) score += 1;
  return score;
}

function buildProjectDiff(
  slots: ReturnType<typeof expandBlueprintProjects>,
  currentProjects: PreviewProjectLike[],
): TeamBlueprintPreviewProjectDiff[] {
  const unusedProjects = new Map(currentProjects.map((project) => [project.id, project]));

  return slots.map((slot, index) => {
    let bestMatch: PreviewProjectLike | null = null;
    let bestScore = 0;
    for (const project of unusedProjects.values()) {
      const score = scoreProjectMatch(slot, project, index);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = project;
      }
    }

    if (bestMatch) {
      unusedProjects.delete(bestMatch.id);
      return {
        slotKey: slot.slotKey,
        templateKey: slot.templateKey,
        label: slot.label,
        kind: slot.kind,
        status: "adopt_existing",
        existingProjectId: bestMatch.id,
        existingProjectName: bestMatch.name,
        workspaceCount: bestMatch.workspaces.length,
        repositoryHint: slot.repositoryHint,
      };
    }

    return {
      slotKey: slot.slotKey,
      templateKey: slot.templateKey,
      label: slot.label,
      kind: slot.kind,
      status: "create_new",
      existingProjectId: null,
      existingProjectName: null,
      workspaceCount: 0,
      repositoryHint: slot.repositoryHint,
    };
  });
}

function buildEffectiveBlueprint(
  blueprint: TeamBlueprint,
  parameters: TeamBlueprintPreviewParameters,
) {
  const effectiveBlueprint = cloneBlueprint(blueprint);
  const removedRoles = new Set(
    effectiveBlueprint.roles
      .filter((role) => !shouldIncludeRoleTemplate(role, parameters))
      .map((role) => role.key),
  );
  const roleGraphWarnings: string[] = [];
  const rewiredRoles: string[] = [];

  effectiveBlueprint.roles = effectiveBlueprint.roles
    .filter((role) => !removedRoles.has(role.key))
    .map((role) => {
      if (role.reportsToKey && removedRoles.has(role.reportsToKey)) {
        rewiredRoles.push(role.label);
        return {
          ...role,
          reportsToKey: null,
        };
      }
      return role;
    });

  if (removedRoles.size > 0) {
    roleGraphWarnings.push(
      `Preview disabled optional roles: ${Array.from(removedRoles).join(", ")}.`,
    );
  }
  if (rewiredRoles.length > 0) {
    roleGraphWarnings.push(
      `Preview rewired manager links for ${rewiredRoles.join(", ")} because a parent optional role is disabled.`,
    );
  }

  const effectiveRoleKeys = new Set(effectiveBlueprint.roles.map((role) => role.key));
  effectiveBlueprint.readiness.approvalRequiredRoleKeys =
    effectiveBlueprint.readiness.approvalRequiredRoleKeys.filter((roleKey) => effectiveRoleKeys.has(roleKey));

  return {
    blueprint: effectiveBlueprint,
    roleGraphWarnings,
  };
}

function shouldIncludeRoleTemplate(
  template: TeamBlueprintRoleTemplate,
  parameters: TeamBlueprintPreviewParameters,
) {
  if (template.role === "pm" && !parameters.includePm) return false;
  if (template.role === "qa" && !parameters.includeQa) return false;
  if (template.role === "cto" && !parameters.includeCto) return false;
  return true;
}

function requiredRoleCount(
  template: TeamBlueprintRoleTemplate,
  parameters: TeamBlueprintPreviewParameters,
) {
  if (template.key === "engineer") {
    return parameters.projectCount * parameters.engineerPairsPerProject;
  }
  if (template.key === "reviewer" && template.projectBinding === "per_project") {
    return parameters.projectCount;
  }
  return 1;
}

function scoreAgentMatch(template: TeamBlueprintRoleTemplate, agent: PreviewAgentLike) {
  const titleKey = normalizeAgentUrlKey(template.title ?? template.label ?? template.key);
  const agentTitleKey = normalizeAgentUrlKey(agent.title);
  const nameKey = normalizeAgentUrlKey(agent.name);
  const lane = readMetadataString(agent.metadata, "deliveryLane");
  let score = 0;
  if (agent.role === template.role) score += 2;
  if (titleKey && agentTitleKey === titleKey) score += 4;
  if (titleKey && nameKey?.includes(titleKey)) score += 2;
  if (nameKey?.includes(template.key)) score += 1;
  if (template.deliveryLane && lane === template.deliveryLane) score += 1;
  return score;
}

function buildRoleDiff(
  blueprint: TeamBlueprint,
  currentAgents: PreviewAgentLike[],
  parameters: TeamBlueprintPreviewParameters,
) {
  const templates = blueprint.roles.filter((template) => shouldIncludeRoleTemplate(template, parameters));
  const unusedAgents = new Map(currentAgents.map((agent) => [agent.id, agent]));

  return templates.map((template) => {
    const requiredCount = requiredRoleCount(template, parameters);
    const matches: PreviewAgentLike[] = [];

    for (let slotIndex = 0; slotIndex < requiredCount; slotIndex += 1) {
      let bestMatch: PreviewAgentLike | null = null;
      let bestScore = 0;
      for (const agent of unusedAgents.values()) {
        const score = scoreAgentMatch(template, agent);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = agent;
        }
      }
      if (!bestMatch) continue;
      unusedAgents.delete(bestMatch.id);
      matches.push(bestMatch);
    }

    const existingCount = matches.length;
    const missingCount = Math.max(0, requiredCount - existingCount);
    const status = missingCount === 0 ? "ready" : existingCount > 0 ? "partial" : "missing";
    const notes: string[] = [];
    if (template.projectBinding === "per_project" && requiredCount > 1) {
      notes.push(`Scales across ${parameters.projectCount} project slot(s).`);
    }
    if (template.key === "engineer" && parameters.engineerPairsPerProject > 1) {
      notes.push(`Preview assumes ${parameters.engineerPairsPerProject} engineer pair(s) per project.`);
    }
    if (missingCount > 0) {
      notes.push(`Create ${missingCount} additional ${template.label.toLowerCase()} slot(s).`);
    } else {
      notes.push("Existing company agents already cover this role requirement.");
    }

    return {
      templateKey: template.key,
      label: template.label,
      role: template.role,
      status,
      requiredCount,
      existingCount,
      missingCount,
      matchingAgentNames: matches.map((agent) => agent.name),
      notes,
    } satisfies TeamBlueprintPreviewResult["roleDiff"][number];
  });
}

function buildReadinessChecks(input: {
  blueprint: TeamBlueprint;
  projectDiff: TeamBlueprintPreviewProjectDiff[];
  currentAgentCount: number;
  setupProgress: SetupProgressView;
  roleGraphWarnings: string[];
}) {
  const workspaceReadyProjectCount = input.projectDiff.filter((project) => project.workspaceCount > 0).length;
  const checks: TeamBlueprintPreviewResult["readinessChecks"] = [
    {
      key: "workspace_count",
      label: "Workspace coverage",
      status: workspaceReadyProjectCount >= input.blueprint.readiness.requiredWorkspaceCount
        ? "ready"
        : workspaceReadyProjectCount > 0 ? "warning" : "missing",
      detail:
        `${workspaceReadyProjectCount}/${input.blueprint.readiness.requiredWorkspaceCount} required project slot(s) already have at least one workspace.`,
    },
    {
      key: "engine_ready",
      label: "Execution engine",
      status: input.setupProgress.steps.engineReady ? "ready" : "missing",
      detail: input.setupProgress.steps.engineReady
        ? `Selected engine: ${input.setupProgress.selectedEngine ?? "configured"}.`
        : "Choose an execution engine before applying a team blueprint.",
    },
    {
      key: "knowledge_seeded",
      label: "Knowledge readiness",
      status: !input.blueprint.readiness.knowledgeRequired
        ? "ready"
        : input.setupProgress.steps.knowledgeSeeded ? "ready" : input.setupProgress.steps.workspaceConnected ? "warning" : "missing",
      detail: !input.blueprint.readiness.knowledgeRequired
        ? "This blueprint can start without knowledge seeding."
        : input.setupProgress.steps.knowledgeSeeded
          ? "Knowledge setup is already seeded for quick request routing."
          : `Seed knowledge sources (${input.blueprint.readiness.knowledgeSources.join(", ")}) before heavy intake routing.`,
    },
    {
      key: "selected_workspace",
      label: "Primary workspace selection",
      status: input.setupProgress.selectedWorkspaceId ? "ready" : "warning",
      detail: input.setupProgress.selectedWorkspaceId
        ? "A primary workspace is selected for doctor and retrieval flows."
        : "Select a primary workspace so quick requests and doctor checks have a default target.",
    },
    {
      key: "team_seed",
      label: "Current team readiness",
      status: input.setupProgress.steps.squadReady ? "ready" : input.currentAgentCount > 0 ? "warning" : "missing",
      detail: input.setupProgress.steps.squadReady
        ? "Company already has a seeded team shape."
        : input.currentAgentCount > 0
          ? "Some agents exist already, but the company is not marked squad-ready."
          : "No existing team structure is seeded yet.",
    },
  ];

  if (input.projectDiff.some((project) => project.status === "create_new")) {
    checks.push({
      key: "project_creation",
      label: "Project creation impact",
      status: "warning",
      detail: "Preview includes new project slots. Apply should be reviewed before creating them in bulk.",
    });
  }

  if (input.roleGraphWarnings.length > 0) {
    checks.push({
      key: "role_graph",
      label: "Role graph adjustments",
      status: "warning",
      detail: input.roleGraphWarnings.join(" "),
    });
  }

  return checks;
}

export function buildTeamBlueprintPreview(input: {
  companyId: string;
  blueprint: TeamBlueprint;
  currentProjects: PreviewProjectLike[];
  currentAgents: PreviewAgentLike[];
  setupProgress: SetupProgressView;
  request?: TeamBlueprintPreviewRequest;
}): TeamBlueprintPreviewResult {
  const baseBlueprint = cloneBlueprint(input.blueprint);
  const parameters = resolveTeamBlueprintPreviewParameters(baseBlueprint, input.request);
  const { blueprint, roleGraphWarnings } = buildEffectiveBlueprint(baseBlueprint, parameters);
  const projectDiff = buildProjectDiff(expandBlueprintProjects(blueprint, parameters), input.currentProjects);
  const roleDiff = buildRoleDiff(blueprint, input.currentAgents, parameters);
  const readinessChecks = buildReadinessChecks({
    blueprint,
    projectDiff,
    currentAgentCount: input.currentAgents.length,
    setupProgress: input.setupProgress,
    roleGraphWarnings,
  });
  const currentWorkspaceCount = input.currentProjects.reduce((count, project) => count + project.workspaces.length, 0);
  const adoptedProjectCount = projectDiff.filter((project) => project.status === "adopt_existing").length;
  const createProjectCount = projectDiff.filter((project) => project.status === "create_new").length;
  const matchedRoleCount = roleDiff.reduce((count, role) => count + role.existingCount, 0);
  const missingRoleCount = roleDiff.reduce((count, role) => count + role.missingCount, 0);
  const warnings: string[] = [];

  if (input.currentProjects.length > adoptedProjectCount) {
    warnings.push("Existing projects beyond the preview match set are left untouched in v1 preview.");
  }
  if (input.currentAgents.length > matchedRoleCount) {
    warnings.push("Existing agents beyond the preview match set are left untouched in v1 preview.");
  }
  for (const check of readinessChecks) {
    if (check.status !== "ready") warnings.push(check.detail);
  }

  return {
    companyId: input.companyId,
    blueprint,
    parameters,
    summary: {
      currentProjectCount: input.currentProjects.length,
      currentWorkspaceCount,
      currentAgentCount: input.currentAgents.length,
      adoptedProjectCount,
      createProjectCount,
      matchedRoleCount,
      missingRoleCount,
    },
    projectDiff,
    roleDiff,
    readinessChecks,
    warnings: Array.from(new Set(warnings)),
  };
}

export function listTeamBlueprints(): TeamBlueprint[] {
  return DEFAULT_TEAM_BLUEPRINTS.map((blueprint) => cloneBlueprint(blueprint));
}

export function teamBlueprintService(db?: Db) {
  return {
    getCatalog(companyId: string): TeamBlueprintCatalogView {
      return {
        companyId,
        blueprints: listTeamBlueprints(),
      };
    },
    async preview(
      companyId: string,
      blueprintKey: TeamBlueprint["key"],
      request?: TeamBlueprintPreviewRequest,
    ) {
      if (!db) throw new Error("teamBlueprintService.preview requires a database handle");
      const blueprint = resolveBlueprint(blueprintKey);
      if (!blueprint) throw notFound("Team blueprint not found");

      const [projects, agents, setupProgress] = await Promise.all([
        projectService(db).list(companyId),
        agentService(db).list(companyId),
        setupProgressService(db).getView(companyId),
      ]);

      return buildTeamBlueprintPreview({
        companyId,
        blueprint,
        currentProjects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          urlKey: project.urlKey,
          workspaces: project.workspaces.map((workspace) => ({ id: workspace.id })),
        })),
        currentAgents: agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          urlKey: agent.urlKey,
          role: agent.role,
          title: agent.title ?? null,
          metadata:
            typeof agent.metadata === "object" && agent.metadata !== null && !Array.isArray(agent.metadata)
              ? agent.metadata as Record<string, unknown>
              : null,
        })),
        setupProgress,
        request,
      });
    },
  };
}
