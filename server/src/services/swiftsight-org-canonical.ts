import type { AgentAdapterType } from "@squadrail/shared";
import { normalizeAgentUrlKey } from "@squadrail/shared";
import {
  DEFAULT_CLAUDE_LOCAL_SKIP_PERMISSIONS,
} from "@squadrail/adapter-claude-local";
import {
  DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
  DEFAULT_CODEX_LOCAL_MODEL,
} from "@squadrail/adapter-codex-local";

export const SWIFTSIGHT_CANONICAL_TEMPLATE_KEY = "cloud-swiftsight";
export const SWIFTSIGHT_CANONICAL_VERSION = "cloud-swiftsight-18a-v1";

type CanonicalProject = {
  slug: string;
  name: string;
  leadAgentSlug: string;
};

export type CanonicalAgentDefinition = {
  canonicalSlug: string;
  name: string;
  role: string;
  title: string | null;
  adapterType: AgentAdapterType;
  reportsToSlug: string | null;
  projectSlug: string | null;
  deliveryLane: string | null;
  capabilities: string | null;
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
  metadata: Record<string, unknown>;
  legacySlugs: string[];
};

const PROJECTS: CanonicalProject[] = [
  { slug: "swiftsight-cloud", name: "swiftsight-cloud", leadAgentSlug: "swiftsight-cloud-tl" },
  { slug: "swiftsight-agent", name: "swiftsight-agent", leadAgentSlug: "swiftsight-agent-tl" },
  { slug: "swiftcl", name: "swiftcl", leadAgentSlug: "swiftcl-tl" },
  { slug: "swiftsight-report-server", name: "swiftsight-report-server", leadAgentSlug: "swiftsight-python-tl" },
  { slug: "swiftsight-worker", name: "swiftsight-worker", leadAgentSlug: "swiftsight-python-tl" },
];

const TOP_LEVEL_AGENTS: Array<Omit<CanonicalAgentDefinition, "adapterConfig" | "runtimeConfig" | "metadata" | "legacySlugs"> & {
  legacySlugs?: string[];
}> = [
  {
    canonicalSlug: "swiftsight-cto",
    name: "SwiftSight CTO",
    role: "cto",
    title: "CTO",
    adapterType: "claude_local",
    reportsToSlug: null,
    projectSlug: null,
    deliveryLane: null,
    capabilities: "cross-project orchestration, technical strategy, final review synthesis",
  },
  {
    canonicalSlug: "swiftsight-pm",
    name: "SwiftSight PM",
    role: "pm",
    title: "PM",
    adapterType: "claude_local",
    reportsToSlug: "swiftsight-cto",
    projectSlug: null,
    deliveryLane: null,
    capabilities: "requirements clarification, documentation debt tracking, acceptance criteria",
  },
  {
    canonicalSlug: "swiftsight-qa-lead",
    name: "SwiftSight QA Lead",
    role: "qa",
    title: "QA Lead",
    adapterType: "claude_local",
    reportsToSlug: "swiftsight-cto",
    projectSlug: null,
    deliveryLane: null,
    capabilities: "regression triage, release safety, evidence quality",
  },
  {
    canonicalSlug: "swiftsight-qa-engineer",
    name: "SwiftSight QA Engineer",
    role: "qa",
    title: "QA Engineer",
    adapterType: "codex_local",
    reportsToSlug: "swiftsight-qa-lead",
    projectSlug: null,
    deliveryLane: null,
    capabilities: "test reproduction, validation scripts, evidence capture",
  },
  {
    canonicalSlug: "swiftsight-cloud-tl",
    name: "SwiftSight Cloud TL",
    role: "engineer",
    title: "Tech Lead",
    adapterType: "claude_local",
    reportsToSlug: "swiftsight-cto",
    projectSlug: "swiftsight-cloud",
    deliveryLane: null,
    capabilities: "ConnectRPC, Hasura, Temporal, PostgreSQL, RabbitMQ",
  },
  {
    canonicalSlug: "swiftsight-agent-tl",
    name: "SwiftSight Agent TL",
    role: "engineer",
    title: "Tech Lead",
    adapterType: "claude_local",
    reportsToSlug: "swiftsight-cto",
    projectSlug: "swiftsight-agent",
    deliveryLane: null,
    capabilities: "gRPC, DICOM, command execution, RabbitMQ",
  },
  {
    canonicalSlug: "swiftcl-tl",
    name: "SwiftCL TL",
    role: "engineer",
    title: "Tech Lead",
    adapterType: "claude_local",
    reportsToSlug: "swiftsight-cto",
    projectSlug: "swiftcl",
    deliveryLane: null,
    capabilities: "HCL v2, Tree-sitter, LSP, compiler pipeline",
  },
  {
    canonicalSlug: "swiftsight-python-tl",
    name: "SwiftSight Python TL",
    role: "engineer",
    title: "Tech Lead",
    adapterType: "claude_local",
    reportsToSlug: "swiftsight-cto",
    projectSlug: null,
    deliveryLane: null,
    capabilities: "Python, RabbitMQ, Temporal SDK, testing, ML-adjacent services",
    legacySlugs: ["python-tl"],
  },
];

function buildAdapterConfig(adapterType: AgentAdapterType) {
  if (adapterType === "claude_local") {
    return {
      dangerouslySkipPermissions: DEFAULT_CLAUDE_LOCAL_SKIP_PERMISSIONS,
      timeoutSec: 900,
    };
  }
  if (adapterType === "codex_local") {
    return {
      model: DEFAULT_CODEX_LOCAL_MODEL,
      dangerouslyBypassApprovalsAndSandbox: DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
    };
  }
  return {};
}

function buildMetadata(input: {
  projectSlug: string | null;
  deliveryLane: string | null;
  adapterType: AgentAdapterType;
  canonicalSlug: string;
}) {
  return {
    bootstrapSlug: input.canonicalSlug,
    canonicalTemplateKey: SWIFTSIGHT_CANONICAL_TEMPLATE_KEY,
    canonicalTemplateVersion: SWIFTSIGHT_CANONICAL_VERSION,
    projectSlug: input.projectSlug,
    executionEngine: input.adapterType,
    deliveryLane: input.deliveryLane,
  };
}

function engineerPairDefinitions(project: CanonicalProject): CanonicalAgentDefinition[] {
  return [
    {
      canonicalSlug: `${project.slug}-codex-engineer`,
      name: `${project.name} Codex Engineer`,
      role: "engineer",
      title: "Engineer",
      adapterType: "codex_local",
      reportsToSlug: project.leadAgentSlug,
      projectSlug: project.slug,
      deliveryLane: "implementation",
      capabilities: `${project.name} implementation delivery`,
      adapterConfig: buildAdapterConfig("codex_local"),
      runtimeConfig: {},
      metadata: buildMetadata({
        projectSlug: project.slug,
        deliveryLane: "implementation",
        adapterType: "codex_local",
        canonicalSlug: `${project.slug}-codex-engineer`,
      }),
      legacySlugs: [`${project.slug}-engineer`],
    },
    {
      canonicalSlug: `${project.slug}-claude-engineer`,
      name: `${project.name} Claude Engineer`,
      role: "engineer",
      title: "Engineer",
      adapterType: "claude_local",
      reportsToSlug: project.leadAgentSlug,
      projectSlug: project.slug,
      deliveryLane: "analysis",
      capabilities: `${project.name} analysis and design delivery`,
      adapterConfig: buildAdapterConfig("claude_local"),
      runtimeConfig: {},
      metadata: buildMetadata({
        projectSlug: project.slug,
        deliveryLane: "analysis",
        adapterType: "claude_local",
        canonicalSlug: `${project.slug}-claude-engineer`,
      }),
      legacySlugs: [],
    },
  ];
}

export function listCanonicalSwiftsightProjects() {
  return PROJECTS.map((project) => ({ ...project }));
}

export function listCanonicalSwiftsightAgents(): CanonicalAgentDefinition[] {
  const topLevel = TOP_LEVEL_AGENTS.map((agent) => ({
    ...agent,
    adapterConfig: buildAdapterConfig(agent.adapterType),
    runtimeConfig: {},
    metadata: buildMetadata({
      projectSlug: agent.projectSlug,
      deliveryLane: agent.deliveryLane,
      adapterType: agent.adapterType,
      canonicalSlug: agent.canonicalSlug,
    }),
    legacySlugs: agent.legacySlugs ?? [],
  }));

  return [
    ...topLevel,
    ...PROJECTS.flatMap((project) => engineerPairDefinitions(project)),
  ];
}

export function buildCanonicalLookupMaps() {
  const definitions = listCanonicalSwiftsightAgents();
  const bySlug = new Map(definitions.map((definition) => [definition.canonicalSlug, definition]));
  const byUrlKey = new Map(definitions.map((definition) => [
    normalizeAgentUrlKey(definition.name) ?? definition.canonicalSlug,
    definition,
  ]));
  const legacySlugMap = new Map<string, CanonicalAgentDefinition>();

  for (const definition of definitions) {
    for (const legacySlug of definition.legacySlugs) {
      legacySlugMap.set(legacySlug, definition);
    }
  }

  return {
    definitions,
    bySlug,
    byUrlKey,
    legacySlugMap,
  };
}

export function canonicalTemplateForCompanyName(companyName: string | null | undefined) {
  if (companyName?.trim() !== "cloud-swiftsight") return null;
  return {
    templateKey: SWIFTSIGHT_CANONICAL_TEMPLATE_KEY,
    canonicalVersion: SWIFTSIGHT_CANONICAL_VERSION,
    agents: listCanonicalSwiftsightAgents(),
    projects: listCanonicalSwiftsightProjects(),
  };
}
