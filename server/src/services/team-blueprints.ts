import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { companyTeamBlueprints, type Db } from "@squadrail/db";
import {
  buildDefaultTeamBlueprintPreviewRequest,
  companySavedTeamBlueprintSchema,
  normalizeAgentUrlKey,
  normalizeProjectUrlKey,
  portableTeamBlueprintDefinitionSchema,
  resolveTeamBlueprintParameterEditors,
  savedTeamBlueprintSourceMetadataSchema,
  type SetupProgressView,
  type CompanySavedTeamBlueprint,
  type PortableTeamBlueprintDefinition,
  type TeamBlueprintApplyRequest,
  type TeamBlueprintApplyResult,
  type TeamBlueprint,
  type TeamBlueprintCatalogView,
  type TeamBlueprintExportBundle,
  type TeamBlueprintExportResult,
  type TeamBlueprintImportCollisionStrategy,
  type TeamBlueprintImportPreviewRequest,
  type TeamBlueprintImportPreviewResult,
  type TeamBlueprintImportRequest,
  type TeamBlueprintImportResult,
  type TeamBlueprintMigrationHelper,
  type TeamBlueprintPreviewParameters,
  type TeamBlueprintPreviewProjectDiff,
  type TeamBlueprintPreviewRequest,
  type TeamBlueprintPreviewResult,
  type TeamBlueprintRoleTemplate,
  teamBlueprintPreviewRequestSchema,
} from "@squadrail/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { agentService } from "./agents.js";
import { projectService } from "./projects.js";
import { rolePackService } from "./role-packs.js";
import { setupProgressService } from "./setup-progress.js";
import { canonicalTemplateForCompanyName } from "./swiftsight-org-canonical.js";

const DEFAULT_IMPORT_COLLISION_STRATEGY: TeamBlueprintImportCollisionStrategy = "rename";
type SavedBlueprintRow = typeof companyTeamBlueprints.$inferSelect;

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
      editors: {
        projectCount: {
          label: "Project slots",
          description: "How many primary project lanes this compact team should cover.",
          min: 1,
          max: 4,
          step: 1,
        },
        engineerPairsPerProject: {
          label: "Engineer pair(s) per project",
          description: "How many implementation engineer slots to provision for each project lane.",
          min: 1,
          max: 3,
          step: 1,
        },
        includePm: {
          label: "Include PM lane",
          description: "This compact blueprint does not provision a dedicated PM lane.",
          editable: false,
        },
        includeQa: {
          label: "Include QA lane",
          description: "This compact blueprint does not provision a dedicated QA lane.",
          editable: false,
        },
        includeCto: {
          label: "Include CTO oversight",
          description: "This compact blueprint does not provision a dedicated CTO oversight lane.",
          editable: false,
        },
      },
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
    portability: {
      companyAgnostic: true,
      workspaceModel: "single_workspace",
      knowledgeModel: "required",
      migrationHelperKeys: [],
      notes: [
        "Portable default for a single delivery workspace.",
        "No company-specific migration helper is required before preview or apply.",
      ],
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
      editors: {
        projectCount: {
          label: "Project slots",
          description: "How many app/service project lanes this squad should preview or apply.",
          min: 1,
          max: 6,
          step: 1,
        },
        engineerPairsPerProject: {
          label: "Engineer pair(s) per project",
          description: "How many implementation engineer slots each project lane should receive.",
          min: 1,
          max: 4,
          step: 1,
        },
        includePm: {
          label: "Include PM lane",
          description: "Keep the PM planning and clarification lane in the squad.",
          editable: true,
        },
        includeQa: {
          label: "Include QA lane",
          description: "This blueprint does not include a dedicated QA lane.",
          editable: false,
        },
        includeCto: {
          label: "Include CTO oversight",
          description: "This blueprint does not include CTO oversight by default.",
          editable: false,
        },
      },
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
    portability: {
      companyAgnostic: true,
      workspaceModel: "per_project",
      knowledgeModel: "required",
      migrationHelperKeys: [],
      notes: [
        "Portable across product companies with app/service split delivery lanes.",
        "Preview/apply should remain generic even when a migration helper exists for a legacy org.",
      ],
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
      editors: {
        projectCount: {
          label: "Project slots",
          description: "How many coordinated delivery lanes this org should cover.",
          min: 1,
          max: 8,
          step: 1,
        },
        engineerPairsPerProject: {
          label: "Engineer pair(s) per project",
          description: "How many implementation engineer slots each project lane should receive.",
          min: 1,
          max: 4,
          step: 1,
        },
        includePm: {
          label: "Include PM lane",
          description: "Keep PM intake structuring and clarification ownership in the org.",
          editable: true,
        },
        includeQa: {
          label: "Include QA lane",
          description: "Keep QA sign-off and regression coverage in the org.",
          editable: true,
        },
        includeCto: {
          label: "Include CTO oversight",
          description: "Keep CTO-level cross-project orchestration in the org.",
          editable: true,
        },
      },
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
    portability: {
      companyAgnostic: true,
      workspaceModel: "per_project",
      knowledgeModel: "required",
      migrationHelperKeys: ["swiftsight_canonical_absorption"],
      notes: [
        "Portable default for multi-project delivery organizations with PM and QA coverage.",
        "Legacy canonical migration helpers are optional and should not override the generic preview/apply path.",
      ],
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
  reportsTo: string | null;
  metadata: Record<string, unknown> | null;
};

type ExpandedBlueprintProjectSlot = {
  slotKey: string;
  templateKey: string;
  label: string;
  description: string | null;
  kind: TeamBlueprint["projects"][number]["kind"];
  repositoryHint: string | null;
  defaultLeadRoleKey: string | null;
};

type ExpandedRoleSlot = {
  slotKey: string;
  templateKey: string;
  label: string;
  role: TeamBlueprintRoleTemplate["role"];
  title: string | null;
  reportsToKey: string | null;
  projectBinding: TeamBlueprintRoleTemplate["projectBinding"];
  preferredAdapterTypes: TeamBlueprintRoleTemplate["preferredAdapterTypes"];
  deliveryLane: string | null;
  capabilities: string[];
  projectSlotKey: string | null;
};

type MatchedRoleSlot = {
  slot: ExpandedRoleSlot;
  existingAgent: PreviewAgentLike | null;
};

const MIN_STRONG_AGENT_MATCH_SCORE = 7;

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
    portability: {
      ...blueprint.portability,
      migrationHelperKeys: [...blueprint.portability.migrationHelperKeys],
      notes: [...blueprint.portability.notes],
    },
  };
}

function clonePortableTeamBlueprintDefinition(
  definition: PortableTeamBlueprintDefinition,
): PortableTeamBlueprintDefinition {
  return {
    slug: definition.slug,
    label: definition.label,
    description: definition.description,
    sourceBlueprintKey: definition.sourceBlueprintKey,
    presetKey: definition.presetKey,
    projects: definition.projects.map((project) => ({ ...project })),
    roles: definition.roles.map((role) => ({
      ...role,
      preferredAdapterTypes: [...role.preferredAdapterTypes],
      capabilities: [...role.capabilities],
    })),
    parameterHints: { ...definition.parameterHints },
    readiness: {
      ...definition.readiness,
      knowledgeSources: [...definition.readiness.knowledgeSources],
      approvalRequiredRoleKeys: [...definition.readiness.approvalRequiredRoleKeys],
      doctorSetupPrerequisites: [...definition.readiness.doctorSetupPrerequisites],
    },
    portability: {
      ...definition.portability,
      migrationHelperKeys: [...definition.portability.migrationHelperKeys],
      notes: [...definition.portability.notes],
    },
  };
}

export function buildPortableTeamBlueprintDefinition(
  blueprint: TeamBlueprint,
): PortableTeamBlueprintDefinition {
  const cloned = cloneBlueprint(blueprint);
  return {
    slug: cloned.key,
    label: cloned.label,
    description: cloned.description,
    sourceBlueprintKey: cloned.key,
    presetKey: cloned.presetKey,
    projects: cloned.projects,
    roles: cloned.roles,
    parameterHints: cloned.parameterHints,
    readiness: cloned.readiness,
    portability: cloned.portability,
  };
}

function resolvePortableBlueprintSourceKey(definition: PortableTeamBlueprintDefinition): TeamBlueprint["key"] {
  if (!definition.sourceBlueprintKey) {
    throw unprocessable("Saved blueprint is missing the source blueprint key required for preview.");
  }
  return definition.sourceBlueprintKey;
}

export function materializePortableTeamBlueprint(
  definition: PortableTeamBlueprintDefinition,
): TeamBlueprint {
  return {
    key: resolvePortableBlueprintSourceKey(definition),
    label: definition.label,
    description: definition.description,
    presetKey: definition.presetKey,
    projects: definition.projects.map((project) => ({ ...project })),
    roles: definition.roles.map((role) => ({
      ...role,
      preferredAdapterTypes: [...role.preferredAdapterTypes],
      capabilities: [...role.capabilities],
    })),
    parameterHints: { ...definition.parameterHints },
    readiness: {
      ...definition.readiness,
      knowledgeSources: [...definition.readiness.knowledgeSources],
      approvalRequiredRoleKeys: [...definition.readiness.approvalRequiredRoleKeys],
      doctorSetupPrerequisites: [...definition.readiness.doctorSetupPrerequisites],
    },
    portability: {
      ...definition.portability,
      migrationHelperKeys: [...definition.portability.migrationHelperKeys],
      notes: [...definition.portability.notes],
    },
  };
}

function buildDefaultPreviewRequestForBlueprint(
  blueprint: TeamBlueprint,
): TeamBlueprintPreviewRequest {
  return buildDefaultTeamBlueprintPreviewRequest(blueprint);
}

function normalizeBlueprintSlug(input: string | null | undefined, fallback: string) {
  return normalizeProjectUrlKey(input) ?? normalizeProjectUrlKey(fallback) ?? "team-blueprint";
}

function uniqueBlueprintSlug(baseSlug: string, usedSlugs: Set<string>) {
  if (!usedSlugs.has(baseSlug)) {
    usedSlugs.add(baseSlug);
    return baseSlug;
  }
  let index = 2;
  while (true) {
    const candidate = `${baseSlug}-${index}`;
    if (!usedSlugs.has(candidate)) {
      usedSlugs.add(candidate);
      return candidate;
    }
    index += 1;
  }
}

export function buildTeamBlueprintExportBundle(input: {
  companyId: string;
  companyName: string | null;
  blueprint: TeamBlueprint;
}): TeamBlueprintExportBundle {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      companyId: input.companyId,
      companyName: input.companyName,
      blueprintKey: input.blueprint.key,
      blueprintLabel: input.blueprint.label,
    },
    definition: buildPortableTeamBlueprintDefinition(input.blueprint),
    defaultPreviewRequest: buildDefaultPreviewRequestForBlueprint(input.blueprint),
  };
}

export function resolveImportedPortableTeamBlueprintDefinition(input: {
  bundle: TeamBlueprintExportBundle;
  existingSavedBlueprints: CompanySavedTeamBlueprint[];
  slug?: string | null;
  label?: string | null;
  collisionStrategy?: TeamBlueprintImportCollisionStrategy | null;
}) {
  const collisionStrategy = input.collisionStrategy ?? DEFAULT_IMPORT_COLLISION_STRATEGY;
  const sourceDefinition = clonePortableTeamBlueprintDefinition(input.bundle.definition);
  const requestedSlug = normalizeBlueprintSlug(input.slug ?? sourceDefinition.slug, sourceDefinition.label);
  const requestedLabel = input.label?.trim() || sourceDefinition.label;
  const existingSavedBlueprint =
    input.existingSavedBlueprints.find((entry) => entry.definition.slug === requestedSlug) ?? null;

  let slug = requestedSlug;
  let saveAction: "create" | "replace" = "create";
  let existingSavedBlueprintId: string | null = null;

  if (existingSavedBlueprint) {
    if (collisionStrategy === "replace") {
      saveAction = "replace";
      existingSavedBlueprintId = existingSavedBlueprint.id;
    } else {
      slug = uniqueBlueprintSlug(
        requestedSlug,
        new Set(input.existingSavedBlueprints.map((entry) => entry.definition.slug)),
      );
    }
  }

  return {
    definition: {
      ...sourceDefinition,
      slug,
      label: requestedLabel,
    } satisfies PortableTeamBlueprintDefinition,
    collisionStrategy,
    saveAction,
    existingSavedBlueprintId,
  };
}

export function buildTeamBlueprintImportPreviewHash(
  preview: Omit<TeamBlueprintImportPreviewResult, "previewHash">,
) {
  return createHash("sha256").update(stableSerialize(preview)).digest("hex");
}

function readMetadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type TeamBlueprintProjectSlot = ExpandedBlueprintProjectSlot;

export function resolveTeamBlueprint(blueprintKey: TeamBlueprint["key"]) {
  return DEFAULT_TEAM_BLUEPRINTS.find((blueprint) => blueprint.key === blueprintKey) ?? null;
}

export function resolveTeamBlueprintPreviewParameters(
  blueprint: TeamBlueprint,
  input: TeamBlueprintPreviewRequest | undefined,
  defaultRequest?: TeamBlueprintPreviewRequest,
): TeamBlueprintPreviewParameters {
  const editors = resolveTeamBlueprintParameterEditors(blueprint.parameterHints);
  const defaultProjectCount = defaultRequest?.projectCount ?? blueprint.parameterHints.defaultProjectCount;
  const defaultEngineerPairsPerProject =
    defaultRequest?.engineerPairsPerProject ?? blueprint.parameterHints.defaultEngineerPairsPerProject;
  const defaultIncludePm =
    blueprint.parameterHints.supportsPm
      ? (defaultRequest?.includePm ?? blueprint.parameterHints.supportsPm)
      : false;
  const defaultIncludeQa =
    blueprint.parameterHints.supportsQa
      ? (defaultRequest?.includeQa ?? blueprint.parameterHints.supportsQa)
      : false;
  const defaultIncludeCto =
    blueprint.parameterHints.supportsCto
      ? (defaultRequest?.includeCto ?? blueprint.parameterHints.supportsCto)
      : false;
  return {
    projectCount: Math.max(
      editors.projectCount.min,
      Math.min(
        editors.projectCount.max,
        input?.projectCount ?? defaultProjectCount,
      ),
    ),
    engineerPairsPerProject: Math.max(
      editors.engineerPairsPerProject.min,
      Math.min(
        editors.engineerPairsPerProject.max,
        input?.engineerPairsPerProject ?? defaultEngineerPairsPerProject,
      ),
    ),
    includePm: !blueprint.parameterHints.supportsPm
      ? false
      : editors.includePm.editable
        ? input?.includePm ?? defaultIncludePm
        : defaultIncludePm,
    includeQa: !blueprint.parameterHints.supportsQa
      ? false
      : editors.includeQa.editable
        ? input?.includeQa ?? defaultIncludeQa
        : defaultIncludeQa,
    includeCto: !blueprint.parameterHints.supportsCto
      ? false
      : editors.includeCto.editable
        ? input?.includeCto ?? defaultIncludeCto
        : defaultIncludeCto,
  };
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
}

export function buildTeamBlueprintPreviewHash(preview: Omit<TeamBlueprintPreviewResult, "previewHash">) {
  return createHash("sha256").update(stableSerialize(preview)).digest("hex");
}

export function expandTeamBlueprintProjects(
  blueprint: TeamBlueprint,
  parameters: TeamBlueprintPreviewParameters,
): ExpandedBlueprintProjectSlot[] {
  return Array.from({ length: parameters.projectCount }, (_, index) => {
    const template = blueprint.projects[index % blueprint.projects.length]!;
    const cycle = Math.floor(index / blueprint.projects.length) + 1;
    return {
      slotKey: cycle === 1 ? template.key : `${template.key}_${cycle}`,
      templateKey: template.key,
      label: cycle === 1 ? template.label : `${template.label} ${cycle}`,
      description: template.description,
      kind: template.kind,
      repositoryHint: template.repositoryHint,
      defaultLeadRoleKey: template.defaultLeadRoleKey,
    };
  });
}

function scoreProjectMatch(
  slot: ReturnType<typeof expandTeamBlueprintProjects>[number],
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
  slots: ReturnType<typeof expandTeamBlueprintProjects>,
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

function resolveProjectSlotsForRoleTemplate(
  template: TeamBlueprintRoleTemplate,
  projectSlots: ExpandedBlueprintProjectSlot[],
) {
  if (template.projectBinding !== "per_project") return [] as ExpandedBlueprintProjectSlot[];
  const explicitlyBoundSlots = projectSlots.filter((projectSlot) => projectSlot.defaultLeadRoleKey === template.key);
  return explicitlyBoundSlots.length > 0 ? explicitlyBoundSlots : projectSlots;
}

function expandRoleSlots(
  blueprint: TeamBlueprint,
  parameters: TeamBlueprintPreviewParameters,
  projectSlots: ExpandedBlueprintProjectSlot[],
): ExpandedRoleSlot[] {
  const slots: ExpandedRoleSlot[] = [];

  for (const template of blueprint.roles) {
    if (template.projectBinding === "per_project") {
      const boundProjectSlots = resolveProjectSlotsForRoleTemplate(template, projectSlots);
      const slotCount = template.key === "engineer" ? parameters.engineerPairsPerProject : 1;
      for (const projectSlot of boundProjectSlots) {
        for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
          const suffix = slotCount > 1 ? ` ${slotIndex + 1}` : "";
          const slotKey = template.key === "engineer"
            ? `${template.key}:${projectSlot.slotKey}:${slotIndex + 1}`
            : `${template.key}:${projectSlot.slotKey}`;
          const label = `${projectSlot.label} ${template.label}${suffix}`;
          slots.push({
            slotKey,
            templateKey: template.key,
            label,
            role: template.role,
            title: template.title,
            reportsToKey: template.reportsToKey,
            projectBinding: template.projectBinding,
            preferredAdapterTypes: template.preferredAdapterTypes,
            deliveryLane: template.deliveryLane,
            capabilities: template.capabilities,
            projectSlotKey: projectSlot.slotKey,
          });
        }
      }
      continue;
    }

    slots.push({
      slotKey: template.key,
      templateKey: template.key,
      label: template.label,
      role: template.role,
      title: template.title,
      reportsToKey: template.reportsToKey,
      projectBinding: template.projectBinding,
      preferredAdapterTypes: template.preferredAdapterTypes,
      deliveryLane: template.deliveryLane,
      capabilities: template.capabilities,
      projectSlotKey: null,
    });
  }

  return slots;
}

function scoreAgentMatch(template: Pick<ExpandedRoleSlot, "templateKey" | "label" | "title" | "role" | "deliveryLane">, agent: PreviewAgentLike) {
  const labelKey = normalizeAgentUrlKey(template.label);
  const titleKey = normalizeAgentUrlKey(template.title ?? template.label ?? template.templateKey);
  const agentTitleKey = normalizeAgentUrlKey(agent.title);
  const nameKey = normalizeAgentUrlKey(agent.name);
  const lane = readMetadataString(agent.metadata, "deliveryLane");
  let score = 0;
  if (agent.role === template.role) score += 2;
  if (labelKey && nameKey === labelKey) score += 8;
  if (labelKey && nameKey?.includes(labelKey)) score += 5;
  if (labelKey && agentTitleKey === labelKey) score += 2;
  if (titleKey && agentTitleKey === titleKey) score += 3;
  if (titleKey && nameKey?.includes(titleKey)) score += 1;
  if (nameKey?.includes(template.templateKey)) score += 1;
  if (template.deliveryLane && lane === template.deliveryLane) score += 1;
  return score;
}

function buildRoleSlotMatches(
  blueprint: TeamBlueprint,
  currentAgents: PreviewAgentLike[],
  parameters: TeamBlueprintPreviewParameters,
  projectSlots: ExpandedBlueprintProjectSlot[],
) {
  const templates = expandRoleSlots(blueprint, parameters, projectSlots);
  const unusedAgents = new Map(currentAgents.map((agent) => [agent.id, agent]));

  return templates.map((slot) => {
    let bestMatch: PreviewAgentLike | null = null;
    let bestScore = 0;
    for (const agent of unusedAgents.values()) {
      const score = scoreAgentMatch(slot, agent);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = agent;
      }
    }
    if (bestMatch && bestScore >= MIN_STRONG_AGENT_MATCH_SCORE) {
      unusedAgents.delete(bestMatch.id);
    } else {
      bestMatch = null;
    }
    return {
      slot,
      existingAgent: bestMatch,
    } satisfies MatchedRoleSlot;
  });
}

function buildRoleDiff(
  blueprint: TeamBlueprint,
  currentAgents: PreviewAgentLike[],
  parameters: TeamBlueprintPreviewParameters,
  projectSlots: ExpandedBlueprintProjectSlot[],
) {
  const matches = buildRoleSlotMatches(blueprint, currentAgents, parameters, projectSlots);
  const matchesByTemplate = new Map<string, MatchedRoleSlot[]>();
  for (const match of matches) {
    const existing = matchesByTemplate.get(match.slot.templateKey);
    if (existing) {
      existing.push(match);
    } else {
      matchesByTemplate.set(match.slot.templateKey, [match]);
    }
  }

  return blueprint.roles.map((template) => {
    const templateMatches = matchesByTemplate.get(template.key) ?? [];
    const existingAgents = templateMatches.flatMap((match) => (match.existingAgent ? [match.existingAgent] : []));
    const requiredCount = templateMatches.length;
    const existingCount = existingAgents.length;
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
      matchingAgentNames: existingAgents.map((agent) => agent.name),
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
  defaultRequest?: TeamBlueprintPreviewRequest;
}): TeamBlueprintPreviewResult {
  const baseBlueprint = cloneBlueprint(input.blueprint);
  const parameters = resolveTeamBlueprintPreviewParameters(baseBlueprint, input.request, input.defaultRequest);
  const { blueprint, roleGraphWarnings } = buildEffectiveBlueprint(baseBlueprint, parameters);
    const projectSlots = expandTeamBlueprintProjects(blueprint, parameters);
  const projectDiff = buildProjectDiff(projectSlots, input.currentProjects);
  const roleDiff = buildRoleDiff(blueprint, input.currentAgents, parameters, projectSlots);
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
  const previewBase = {
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
  return {
    ...previewBase,
    previewHash: buildTeamBlueprintPreviewHash(previewBase),
  };
}

function toPreviewProjects(
  projects: Awaited<ReturnType<ReturnType<typeof projectService>["list"]>>,
): PreviewProjectLike[] {
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    urlKey: project.urlKey,
    workspaces: project.workspaces.map((workspace) => ({ id: workspace.id })),
  }));
}

function toPreviewAgents(
  agents: Awaited<ReturnType<ReturnType<typeof agentService>["list"]>>,
): PreviewAgentLike[] {
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    urlKey: agent.urlKey,
    role: agent.role,
    title: agent.title ?? null,
    reportsTo: agent.reportsTo ?? null,
    metadata:
      typeof agent.metadata === "object" && agent.metadata !== null && !Array.isArray(agent.metadata)
        ? agent.metadata as Record<string, unknown>
        : null,
  }));
}

function buildAgentMetadataForBlueprint(input: {
  existingMetadata: Record<string, unknown> | null | undefined;
  blueprintKey: TeamBlueprint["key"];
  roleTemplateKey: string;
  projectSlotKey: string | null;
  deliveryLane: string | null;
}) {
  const metadata = input.existingMetadata ? { ...input.existingMetadata } : {};
  metadata.teamBlueprintKey = input.blueprintKey;
  metadata.teamBlueprintRoleKey = input.roleTemplateKey;
  metadata.teamBlueprintProjectSlotKey = input.projectSlotKey;
  if (input.deliveryLane) {
    metadata.deliveryLane = input.deliveryLane;
  }
  return metadata;
}

function resolveManagerAgentId(
  slot: ExpandedRoleSlot,
  matches: MatchedRoleSlot[],
  agentIdBySlotKey: Map<string, string>,
  projectSlotByKey: Map<string, ExpandedBlueprintProjectSlot>,
  roleTemplateByKey: Map<string, TeamBlueprintRoleTemplate>,
) {
  if (!slot.reportsToKey) return null;
  const managerTemplate = roleTemplateByKey.get(slot.reportsToKey) ?? null;
  const managerMatches = matches.filter((match) => match.slot.templateKey === slot.reportsToKey);
  if (managerMatches.length === 0) return null;
  if (slot.projectSlotKey && managerTemplate?.projectBinding === "per_project") {
    const sameProjectManager = managerMatches.find((match) => match.slot.projectSlotKey === slot.projectSlotKey);
    if (sameProjectManager) {
      return agentIdBySlotKey.get(sameProjectManager.slot.slotKey) ?? null;
    }

    const projectLeadRoleKey = projectSlotByKey.get(slot.projectSlotKey)?.defaultLeadRoleKey ?? null;
    if (projectLeadRoleKey) {
      const projectLeadMatch = matches.find((match) =>
        match.slot.projectSlotKey === slot.projectSlotKey && match.slot.templateKey === projectLeadRoleKey
      );
      if (projectLeadMatch) {
        return agentIdBySlotKey.get(projectLeadMatch.slot.slotKey) ?? null;
      }
    }
  }
  const managerSlot = managerMatches[0]!;
  return agentIdBySlotKey.get(managerSlot.slot.slotKey) ?? null;
}

async function loadPreviewState(
  db: Db,
  companyId: string,
  blueprintKey: TeamBlueprint["key"],
  request?: TeamBlueprintPreviewRequest,
) {
  const blueprint = resolveTeamBlueprint(blueprintKey);
  if (!blueprint) throw notFound("Team blueprint not found");

  return loadPreviewStateForBlueprint(db, companyId, blueprint, request);
}

async function loadPreviewStateForBlueprint(
  db: Db,
  companyId: string,
  blueprint: TeamBlueprint,
  request?: TeamBlueprintPreviewRequest,
  defaultRequest?: TeamBlueprintPreviewRequest,
) {
  const previewRequest = teamBlueprintPreviewRequestSchema.parse({
    projectCount: request?.projectCount,
    engineerPairsPerProject: request?.engineerPairsPerProject,
    includePm: request?.includePm,
    includeQa: request?.includeQa,
    includeCto: request?.includeCto,
  });
  const previewDefaultRequest = teamBlueprintPreviewRequestSchema.parse({
    projectCount: defaultRequest?.projectCount,
    engineerPairsPerProject: defaultRequest?.engineerPairsPerProject,
    includePm: defaultRequest?.includePm,
    includeQa: defaultRequest?.includeQa,
    includeCto: defaultRequest?.includeCto,
  });

  const [projects, agents, setupProgress] = await Promise.all([
    projectService(db).list(companyId),
    agentService(db).list(companyId),
    setupProgressService(db).getView(companyId),
  ]);
  const currentProjects = toPreviewProjects(projects);
  const currentAgents = toPreviewAgents(agents);
  const preview = buildTeamBlueprintPreview({
    companyId,
    blueprint,
    currentProjects,
    currentAgents,
    setupProgress,
    request: previewRequest,
    defaultRequest: previewDefaultRequest,
  });
  const projectSlots = expandTeamBlueprintProjects(preview.blueprint, preview.parameters);
  const roleSlotMatches = buildRoleSlotMatches(preview.blueprint, currentAgents, preview.parameters, projectSlots);

  return {
    blueprint,
    liveProjects: projects,
    liveAgents: agents,
    setupProgress,
    preview,
    projectSlots,
    roleSlotMatches,
  };
}

function serializeSavedBlueprintRow(row: SavedBlueprintRow): CompanySavedTeamBlueprint {
  return companySavedTeamBlueprintSchema.parse({
    id: row.id,
    companyId: row.companyId,
    definition: portableTeamBlueprintDefinitionSchema.parse(row.definition),
    defaultPreviewRequest: teamBlueprintPreviewRequestSchema.parse(row.defaultPreviewRequest),
    sourceMetadata: savedTeamBlueprintSourceMetadataSchema.parse(row.sourceMetadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

async function listSavedBlueprints(db: Db, companyId: string): Promise<CompanySavedTeamBlueprint[]> {
  const rows = await db
    .select()
    .from(companyTeamBlueprints)
    .where(eq(companyTeamBlueprints.companyId, companyId))
    .orderBy(asc(companyTeamBlueprints.label), asc(companyTeamBlueprints.slug));
  return rows.map((row) => serializeSavedBlueprintRow(row));
}

async function getSavedBlueprintById(
  db: Db,
  companyId: string,
  savedBlueprintId: string,
): Promise<CompanySavedTeamBlueprint> {
  const rows = await db
    .select()
    .from(companyTeamBlueprints)
    .where(and(
      eq(companyTeamBlueprints.companyId, companyId),
      eq(companyTeamBlueprints.id, savedBlueprintId),
    ))
    .limit(1);
  const row = rows[0] ?? null;
  if (!row) throw notFound("Saved team blueprint not found");
  return serializeSavedBlueprintRow(row);
}

export function listTeamBlueprints(): TeamBlueprint[] {
  return DEFAULT_TEAM_BLUEPRINTS.map((blueprint) => cloneBlueprint(blueprint));
}

function resolveMigrationHelpers(companyName: string | null | undefined): TeamBlueprintMigrationHelper[] {
  const helper = canonicalTemplateForCompanyName(companyName)?.blueprintAbsorptionPrep ?? null;
  return helper ? [{ ...helper }] : [];
}

export function teamBlueprintService(db?: Db) {
  return {
    async getCatalog(companyId: string, companyName?: string | null): Promise<TeamBlueprintCatalogView> {
      return {
        companyId,
        blueprints: listTeamBlueprints(),
        savedBlueprints: db ? await listSavedBlueprints(db, companyId) : [],
        migrationHelpers: resolveMigrationHelpers(companyName),
      };
    },
    async exportBlueprint(
      companyId: string,
      blueprintKey: TeamBlueprint["key"],
      companyName?: string | null,
    ): Promise<TeamBlueprintExportResult> {
      const blueprint = resolveTeamBlueprint(blueprintKey);
      if (!blueprint) throw notFound("Team blueprint not found");
      return {
        bundle: buildTeamBlueprintExportBundle({
          companyId,
          companyName: companyName ?? null,
          blueprint,
        }),
        warnings: [],
      };
    },
    async previewImport(
      companyId: string,
      request: TeamBlueprintImportPreviewRequest,
    ): Promise<TeamBlueprintImportPreviewResult> {
      if (!db) throw new Error("teamBlueprintService.previewImport requires a database handle");

      if (request.source.type !== "inline") {
        throw unprocessable("Unsupported team blueprint import source");
      }

      const savedBlueprints = await listSavedBlueprints(db, companyId);
      const resolved = resolveImportedPortableTeamBlueprintDefinition({
        bundle: request.source.bundle,
        existingSavedBlueprints: savedBlueprints,
        slug: request.slug,
        label: request.label,
        collisionStrategy: request.collisionStrategy,
      });
      const preview = (
        await loadPreviewStateForBlueprint(
          db,
          companyId,
          materializePortableTeamBlueprint(resolved.definition),
          undefined,
          request.source.bundle.defaultPreviewRequest,
        )
      ).preview;
      const previewBase = {
        targetCompanyId: companyId,
        definition: resolved.definition,
        saveAction: resolved.saveAction,
        existingSavedBlueprintId: resolved.existingSavedBlueprintId,
        collisionStrategy: resolved.collisionStrategy,
        preview,
        warnings: [] as string[],
        errors: [] as string[],
      };
      return {
        ...previewBase,
        previewHash: buildTeamBlueprintImportPreviewHash(previewBase),
      };
    },
    async importBlueprint(
      companyId: string,
      request: TeamBlueprintImportRequest,
    ): Promise<TeamBlueprintImportResult> {
      if (!db) throw new Error("teamBlueprintService.importBlueprint requires a database handle");

      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const preview = await teamBlueprintService(txDb).previewImport(companyId, request);
        if (preview.previewHash !== request.previewHash) {
          throw conflict("Imported blueprint preview is stale. Refresh preview before saving.");
        }

        const now = new Date();
        const sourceMetadata = savedTeamBlueprintSourceMetadataSchema.parse({
          type: request.source.type === "inline" ? "import_bundle" : "import_bundle",
          companyId: request.source.bundle.source.companyId,
          companyName: request.source.bundle.source.companyName,
          blueprintKey: request.source.bundle.source.blueprintKey,
          generatedAt: request.source.bundle.generatedAt,
        });

        if (preview.saveAction === "replace" && preview.existingSavedBlueprintId) {
          const rows = await txDb
            .update(companyTeamBlueprints)
            .set({
              slug: preview.definition.slug,
              label: preview.definition.label,
              description: preview.definition.description,
              sourceBlueprintKey: preview.definition.sourceBlueprintKey,
              definition: preview.definition as unknown as Record<string, unknown>,
              defaultPreviewRequest: request.source.bundle.defaultPreviewRequest as unknown as Record<string, unknown>,
              sourceMetadata: sourceMetadata as unknown as Record<string, unknown>,
              updatedAt: now,
            })
            .where(and(
              eq(companyTeamBlueprints.companyId, companyId),
              eq(companyTeamBlueprints.id, preview.existingSavedBlueprintId),
            ))
            .returning();
          const row = rows[0] ?? null;
          if (!row) throw notFound("Saved team blueprint not found");
          return {
            savedBlueprint: serializeSavedBlueprintRow(row),
            action: "updated",
            previewHash: preview.previewHash,
            warnings: preview.warnings,
          };
        }

        const rows = await txDb
          .insert(companyTeamBlueprints)
          .values({
            companyId,
            slug: preview.definition.slug,
            label: preview.definition.label,
            description: preview.definition.description,
            sourceBlueprintKey: preview.definition.sourceBlueprintKey,
            definition: preview.definition as unknown as Record<string, unknown>,
            defaultPreviewRequest: (request.source.bundle.defaultPreviewRequest ?? {}) as Record<string, unknown>,
            sourceMetadata: sourceMetadata as unknown as Record<string, unknown>,
          })
          .returning();
        const row = rows[0] ?? null;
        if (!row) {
          throw conflict("Failed to save imported team blueprint");
        }
        return {
          savedBlueprint: serializeSavedBlueprintRow(row),
          action: "created",
          previewHash: preview.previewHash,
          warnings: preview.warnings,
        };
      });
    },
    async previewSavedBlueprint(
      companyId: string,
      savedBlueprintId: string,
      request?: TeamBlueprintPreviewRequest,
    ): Promise<TeamBlueprintPreviewResult> {
      if (!db) throw new Error("teamBlueprintService.previewSavedBlueprint requires a database handle");

      const savedBlueprint = await getSavedBlueprintById(db, companyId, savedBlueprintId);
      const state = await loadPreviewStateForBlueprint(
        db,
        companyId,
        materializePortableTeamBlueprint(savedBlueprint.definition),
        request,
        savedBlueprint.defaultPreviewRequest,
      );
      return state.preview;
    },
    async preview(
      companyId: string,
      blueprintKey: TeamBlueprint["key"],
      request?: TeamBlueprintPreviewRequest,
    ) {
      if (!db) throw new Error("teamBlueprintService.preview requires a database handle");
      const state = await loadPreviewState(db, companyId, blueprintKey, request);
      return state.preview;
    },
    async apply(
      companyId: string,
      blueprintKey: TeamBlueprint["key"],
      request: TeamBlueprintApplyRequest,
      actor: {
        userId?: string | null;
        agentId?: string | null;
      },
    ): Promise<TeamBlueprintApplyResult> {
      if (!db) throw new Error("teamBlueprintService.apply requires a database handle");

      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const state = await loadPreviewState(txDb, companyId, blueprintKey, request);
        if (state.preview.previewHash !== request.previewHash) {
          throw conflict("Blueprint preview is stale. Refresh preview before applying.");
        }

        const projectsSvc = projectService(txDb);
        const agentsSvc = agentService(txDb);
        const setupSvc = setupProgressService(txDb);
        const rolePacks = rolePackService(txDb);
        const roleTemplateByKey = new Map(state.preview.blueprint.roles.map((role) => [role.key, role]));
        const projectSlotByKey = new Map(state.projectSlots.map((slot) => [slot.slotKey, slot]));

        const rolePackSeed = await rolePacks.seedDefaults({
          companyId,
          presetKey: state.preview.blueprint.presetKey,
          actor,
        });

        const projectIdBySlotKey = new Map<string, string>();
        const projectResults: TeamBlueprintApplyResult["projectResults"] = [];

        for (const projectDiff of state.preview.projectDiff) {
          if (projectDiff.status === "adopt_existing" && projectDiff.existingProjectId && projectDiff.existingProjectName) {
            projectIdBySlotKey.set(projectDiff.slotKey, projectDiff.existingProjectId);
            projectResults.push({
              slotKey: projectDiff.slotKey,
              templateKey: projectDiff.templateKey,
              label: projectDiff.label,
              action: "adopt_existing",
              projectId: projectDiff.existingProjectId,
              projectName: projectDiff.existingProjectName,
            });
            continue;
          }

          const projectSlot = state.projectSlots.find((slot) => slot.slotKey === projectDiff.slotKey);
          if (!projectSlot) {
            throw conflict(`Blueprint project slot '${projectDiff.slotKey}' could not be resolved during apply.`);
          }
          const createdProject = await projectsSvc.create(companyId, {
            name: projectSlot.label,
            description: projectSlot.description,
            status: "planned",
            leadAgentId: null,
            targetDate: null,
            archivedAt: null,
            color: null,
          });
          projectIdBySlotKey.set(projectDiff.slotKey, createdProject.id);
          projectResults.push({
            slotKey: projectDiff.slotKey,
            templateKey: projectDiff.templateKey,
            label: projectDiff.label,
            action: "create_new",
            projectId: createdProject.id,
            projectName: createdProject.name,
          });
        }

        const createdAgentIds = new Set<string>();
        const updatedAgentIds = new Set<string>();
        const agentIdBySlotKey = new Map<string, string>();
        const roleResults: TeamBlueprintApplyResult["roleResults"] = [];

        for (const match of state.roleSlotMatches) {
          const desiredReportsTo = resolveManagerAgentId(
            match.slot,
            state.roleSlotMatches,
            agentIdBySlotKey,
            projectSlotByKey,
            roleTemplateByKey,
          );
          const desiredMetadata = buildAgentMetadataForBlueprint({
            existingMetadata: match.existingAgent?.metadata,
            blueprintKey,
            roleTemplateKey: match.slot.templateKey,
            projectSlotKey: match.slot.projectSlotKey,
            deliveryLane: match.slot.deliveryLane,
          });

          if (match.existingAgent) {
            agentIdBySlotKey.set(match.slot.slotKey, match.existingAgent.id);
            const needsUpdate =
              match.existingAgent.reportsTo !== desiredReportsTo ||
              JSON.stringify(match.existingAgent.metadata ?? null) !== JSON.stringify(desiredMetadata);

            if (needsUpdate) {
              await agentsSvc.update(match.existingAgent.id, {
                reportsTo: desiredReportsTo,
                metadata: desiredMetadata,
              });
              updatedAgentIds.add(match.existingAgent.id);
            }

            roleResults.push({
              slotKey: match.slot.slotKey,
              templateKey: match.slot.templateKey,
              label: match.slot.label,
              action: needsUpdate ? "update_existing" : "adopt_existing",
              agentId: match.existingAgent.id,
              agentName: match.existingAgent.name,
              reportsToAgentId: desiredReportsTo,
              updated: needsUpdate,
            });
            continue;
          }

          const createdAgent = await agentsSvc.create(companyId, {
            name: match.slot.label,
            role: match.slot.role,
            title: match.slot.title ?? match.slot.label,
            icon: null,
            reportsTo: desiredReportsTo,
            capabilities: match.slot.capabilities.join(", "),
            adapterType: match.slot.preferredAdapterTypes[0] ?? "process",
            adapterConfig: {},
            runtimeConfig: {},
            budgetMonthlyCents: 0,
            metadata: desiredMetadata,
            status: "idle",
            spentMonthlyCents: 0,
            lastHeartbeatAt: null,
          });
          createdAgentIds.add(createdAgent.id);
          agentIdBySlotKey.set(match.slot.slotKey, createdAgent.id);
          roleResults.push({
            slotKey: match.slot.slotKey,
            templateKey: match.slot.templateKey,
            label: match.slot.label,
            action: "create_new",
            agentId: createdAgent.id,
            agentName: createdAgent.name,
            reportsToAgentId: desiredReportsTo,
            updated: false,
          });
        }

        for (const projectSlot of state.projectSlots) {
          if (!projectSlot.defaultLeadRoleKey) continue;
          const projectId = projectIdBySlotKey.get(projectSlot.slotKey);
          if (!projectId) continue;
          const matchingLead = state.roleSlotMatches.find((match) =>
            match.slot.templateKey === projectSlot.defaultLeadRoleKey && match.slot.projectSlotKey === projectSlot.slotKey
          ) ?? state.roleSlotMatches.find((match) => match.slot.templateKey === projectSlot.defaultLeadRoleKey);
          const leadAgentId = matchingLead ? agentIdBySlotKey.get(matchingLead.slot.slotKey) ?? null : null;
          if (!leadAgentId) continue;
          await projectsSvc.update(projectId, {
            leadAgentId,
          });
        }

        const setupProgress = await setupSvc.update(companyId, {
          status: "squad_ready",
          metadata: {
            rolePacksSeeded: true,
            rolePackPresetKey: state.preview.blueprint.presetKey,
            teamBlueprintKey: blueprintKey,
            teamBlueprintPreviewHash: state.preview.previewHash,
          },
        });

        return {
          companyId,
          blueprintKey,
          previewHash: state.preview.previewHash,
          parameters: state.preview.parameters,
          summary: {
            adoptedProjectCount: projectResults.filter((result) => result.action === "adopt_existing").length,
            createdProjectCount: projectResults.filter((result) => result.action === "create_new").length,
            adoptedAgentCount: roleResults.filter((result) => result.action === "adopt_existing").length,
            createdAgentCount: createdAgentIds.size,
            updatedAgentCount: updatedAgentIds.size,
            seededRolePackCount: rolePackSeed.created.length,
            existingRolePackCount: rolePackSeed.existing.length,
          },
          projectResults,
          roleResults,
          setupProgress,
          warnings: state.preview.warnings,
        };
      });
    },
  };
}
