import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { companiesApi } from "../api/companies";
import { accessApi } from "../api/access";
import { knowledgeApi, type RetrievalPolicyRecord } from "../api/knowledge";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import { appRoutes } from "../lib/appRoutes";
import { Button } from "@/components/ui/button";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
import { HeroSection } from "../components/HeroSection";
import { MarkdownBody } from "../components/MarkdownBody";
import { MarkdownDiffView } from "../components/MarkdownDiffView";
import { RoleSimulationConsole } from "../components/RoleSimulationConsole";
import { SupportMetricCard } from "../components/SupportMetricCard";
import {
  TeamBlueprintParameterEditor,
  describeTeamBlueprintParameterChanges,
} from "../components/TeamBlueprintParameterEditor";
import { Field, ToggleField, HintIcon } from "../components/agent-config-primitives";
import { Layers3, SearchCheck, Settings, ShieldCheck } from "lucide-react";
import {
  canDeleteSavedTeamBlueprint,
  buildNextSavedTeamBlueprintVersionLabel,
  buildNextSavedTeamBlueprintVersionSlug,
  buildDefaultTeamBlueprintPreviewRequest,
  describeSavedTeamBlueprintDeleteRestriction,
  describeSavedTeamBlueprintVersionChanges,
  resolveSavedTeamBlueprintLifecycleState,
  resolveSavedTeamBlueprintVersionInfo,
  WORKFLOW_TEMPLATE_ACTION_TYPES,
  ROLE_PACK_FILE_NAMES,
  type DoctorCheckStatus,
  type OperatingAlertDestinationConfig,
  type CompanySavedTeamBlueprint,
  type RolePackCustomBaseRoleKey,
  type RolePackFileName,
  type RolePackPresetDescriptor,
  type RolePackPresetKey,
  type SavedTeamBlueprintLifecycleState,
  type TeamBlueprint,
  type TeamBlueprintApplyResult,
  type TeamBlueprintImportPreviewResult,
  type TeamBlueprintKey,
  type TeamBlueprintPreviewRequest,
  type TeamBlueprintPreviewResult,
  type RolePackWithLatestRevision,
  type WorkflowTemplate,
  type WorkflowTemplateActionType,
} from "@squadrail/shared";

const ENGINE_OPTIONS = [
  { value: "claude_local", label: "Claude Code" },
  { value: "codex_local", label: "Codex" },
] as const;

function statusTone(status: DoctorCheckStatus) {
  if (status === "fail") return "border-red-300 bg-red-50 text-red-700";
  if (status === "warn") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-emerald-300 bg-emerald-50 text-emerald-700";
}

function formatRoleKeyLabel(roleKey: string) {
  return roleKey
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function rolePackDisplayName(rolePack: Pick<RolePackWithLatestRevision, "displayName" | "roleKey">) {
  return rolePack.displayName || formatRoleKeyLabel(rolePack.roleKey);
}

function formatWorkflowActionLabel(actionType: string) {
  return formatRoleKeyLabel(actionType.toLowerCase());
}

function formatSetupStepLabel(stepKey: string) {
  return stepKey
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

function blueprintStatusTone(status: "ready" | "warning" | "missing" | "partial") {
  if (status === "ready") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (status === "warning") return "border-amber-300 bg-amber-50 text-amber-700";
  if (status === "partial") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-red-300 bg-red-50 text-red-700";
}

function savedBlueprintLifecycleTone(state: SavedTeamBlueprintLifecycleState) {
  if (state === "published") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (state === "superseded") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-amber-300 bg-amber-50 text-amber-700";
}

function formatSavedBlueprintLifecycleLabel(state: SavedTeamBlueprintLifecycleState) {
  if (state === "published") return "Published";
  if (state === "superseded") return "Superseded";
  return "Draft";
}

function previewRolePackFile(rolePack: RolePackWithLatestRevision, filename: string) {
  const file = rolePack.latestFiles.find((entry) => entry.filename === filename);
  if (!file) return null;
  return file.content.split(/\r?\n/).slice(0, 8).join("\n");
}

function buildRolePackDraftFromFiles(files: Array<{ filename: RolePackFileName; content: string }>) {
  const draft = Object.fromEntries(ROLE_PACK_FILE_NAMES.map((filename) => [filename, ""])) as Record<RolePackFileName, string>;
  for (const file of files) {
    draft[file.filename] = file.content;
  }
  return draft;
}

function buildRolePackDraft(rolePack: RolePackWithLatestRevision) {
  return buildRolePackDraftFromFiles(rolePack.latestFiles);
}

function countChangedRolePackFiles(
  draft: Record<RolePackFileName, string> | undefined,
  baselineFiles: Array<{ filename: RolePackFileName; content: string }>,
) {
  if (!draft) return 0;
  const baseline = buildRolePackDraftFromFiles(baselineFiles);
  return ROLE_PACK_FILE_NAMES.filter((filename) => (draft[filename] ?? "") !== (baseline[filename] ?? "")).length;
}

function listChangedRolePackFiles(
  draft: Record<RolePackFileName, string> | undefined,
  baselineFiles: Array<{ filename: RolePackFileName; content: string }>,
) {
  if (!draft) return [] as RolePackFileName[];
  const baseline = buildRolePackDraftFromFiles(baselineFiles);
  return ROLE_PACK_FILE_NAMES.filter((filename) => (draft[filename] ?? "") !== (baseline[filename] ?? ""));
}

function retrievalPolicyKey(policy: Pick<RetrievalPolicyRecord, "role" | "eventType" | "workflowState">) {
  return `${policy.role}::${policy.eventType}::${policy.workflowState}`;
}

function csvToList(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function createOperatingAlertDestinationDraft(): OperatingAlertDestinationConfig {
  return {
    id: `destination-${Math.random().toString(36).slice(2, 10)}`,
    label: "",
    type: "slack_webhook",
    url: "",
    enabled: true,
    authHeaderName: null,
    authHeaderValue: null,
  };
}

function createWorkflowTemplateDraft(actionType: WorkflowTemplateActionType): WorkflowTemplate {
  return {
    id: `company-${actionType.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`,
    actionType,
    label: `Company ${formatWorkflowActionLabel(actionType)}`,
    description: null,
    summary: null,
    fields: {},
    scope: "company",
  };
}

function stringifyWorkflowTemplateFields(fields: Record<string, string>) {
  return JSON.stringify(fields, null, 2);
}

function downloadJsonFile(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function CompanySettings() {
  const { companies, selectedCompany, selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  // General settings local state
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [setupEngine, setSetupEngine] = useState("");
  const [setupWorkspaceId, setSetupWorkspaceId] = useState("");
  const [deepDoctorReport, setDeepDoctorReport] = useState<Awaited<ReturnType<typeof companiesApi.getDoctorReport>> | null>(null);
  const [selectedRolePackId, setSelectedRolePackId] = useState<string | null>(null);
  const [selectedRolePackFile, setSelectedRolePackFile] = useState<RolePackFileName>("ROLE.md");
  const [selectedRolePackRevisionId, setSelectedRolePackRevisionId] = useState<string | null>(null);
  const [rolePackRevisionMessage, setRolePackRevisionMessage] = useState("");
  const [rolePackDrafts, setRolePackDrafts] = useState<Record<string, Record<RolePackFileName, string>>>({});
  const [rolePackRestoreSources, setRolePackRestoreSources] = useState<Record<string, string | null>>({});
  const [selectedRolePackPresetKey, setSelectedRolePackPresetKey] = useState<RolePackPresetKey>("squadrail_default_v1");
  const [selectedWorkflowTemplateId, setSelectedWorkflowTemplateId] = useState<string | null>(null);
  const [workflowTemplateLabel, setWorkflowTemplateLabel] = useState("");
  const [workflowTemplateDescription, setWorkflowTemplateDescription] = useState("");
  const [workflowTemplateSummary, setWorkflowTemplateSummary] = useState("");
  const [workflowTemplateFieldsText, setWorkflowTemplateFieldsText] = useState("{}");
  const [newWorkflowTemplateAction, setNewWorkflowTemplateAction] = useState<WorkflowTemplateActionType>("ASSIGN_TASK");
  const [customRoleName, setCustomRoleName] = useState("");
  const [customRoleSlug, setCustomRoleSlug] = useState("");
  const [customRoleBaseRoleKey, setCustomRoleBaseRoleKey] = useState<RolePackCustomBaseRoleKey>("engineer");
  const [customRoleDescription, setCustomRoleDescription] = useState("");
  const [customRolePublish, setCustomRolePublish] = useState(true);
  const [selectedPolicyKey, setSelectedPolicyKey] = useState("");
  const [policyRole, setPolicyRole] = useState("engineer");
  const [policyEventType, setPolicyEventType] = useState("START_IMPLEMENTATION");
  const [policyWorkflowState, setPolicyWorkflowState] = useState("implementing");
  const [policyTopKDense, setPolicyTopKDense] = useState("20");
  const [policyTopKSparse, setPolicyTopKSparse] = useState("20");
  const [policyRerankK, setPolicyRerankK] = useState("20");
  const [policyFinalK, setPolicyFinalK] = useState("8");
  const [policySourceTypes, setPolicySourceTypes] = useState("code, adr, issue, runbook, meeting");
  const [policyAuthorityLevels, setPolicyAuthorityLevels] = useState("canonical, draft");
  const [policyMetadataText, setPolicyMetadataText] = useState("{}");
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertMinSeverity, setAlertMinSeverity] = useState<"medium" | "high" | "critical">("high");
  const [alertCooldownMinutes, setAlertCooldownMinutes] = useState("15");
  const [alertDestinations, setAlertDestinations] = useState<OperatingAlertDestinationConfig[]>([]);
  const [selectedTeamBlueprintKey, setSelectedTeamBlueprintKey] = useState<TeamBlueprintKey | null>(null);
  const [teamBlueprintPreviewRequests, setTeamBlueprintPreviewRequests] = useState<Record<string, TeamBlueprintPreviewRequest>>({});
  const [teamBlueprintPreview, setTeamBlueprintPreview] = useState<TeamBlueprintPreviewResult | null>(null);
  const [teamBlueprintApplyResult, setTeamBlueprintApplyResult] = useState<TeamBlueprintApplyResult | null>(null);
  const [teamBlueprintLibraryDrafts, setTeamBlueprintLibraryDrafts] = useState<Record<string, {
    slug: string;
    label: string;
    description: string;
    versionNote: string;
  }>>({});
  const [confirmTeamBlueprintApply, setConfirmTeamBlueprintApply] = useState(false);
  const [selectedSavedTeamBlueprintId, setSelectedSavedTeamBlueprintId] = useState<string | null>(null);
  const [savedTeamBlueprintPreviewRequests, setSavedTeamBlueprintPreviewRequests] = useState<Record<string, TeamBlueprintPreviewRequest>>({});
  const [savedTeamBlueprintMetadataDrafts, setSavedTeamBlueprintMetadataDrafts] = useState<Record<string, {
    slug: string;
    label: string;
    description: string;
  }>>({});
  const [savedTeamBlueprintVersionDrafts, setSavedTeamBlueprintVersionDrafts] = useState<Record<string, {
    slug: string;
    label: string;
    description: string;
    versionNote: string;
  }>>({});
  const [savedTeamBlueprintPreviewState, setSavedTeamBlueprintPreviewState] = useState<{
    savedBlueprintId: string;
    preview: TeamBlueprintPreviewResult;
  } | null>(null);
  const [savedTeamBlueprintApplyResult, setSavedTeamBlueprintApplyResult] = useState<{
    savedBlueprintId: string;
    result: TeamBlueprintApplyResult;
  } | null>(null);
  const [confirmSavedTeamBlueprintApply, setConfirmSavedTeamBlueprintApply] = useState(false);
  const [teamBlueprintImportText, setTeamBlueprintImportText] = useState("");
  const [teamBlueprintImportSlug, setTeamBlueprintImportSlug] = useState("");
  const [teamBlueprintImportLabel, setTeamBlueprintImportLabel] = useState("");
  const [teamBlueprintImportCollisionStrategy, setTeamBlueprintImportCollisionStrategy] = useState<"rename" | "replace">("rename");
  const [teamBlueprintImportPreview, setTeamBlueprintImportPreview] = useState<TeamBlueprintImportPreviewResult | null>(null);
  const [confirmTeamBlueprintImport, setConfirmTeamBlueprintImport] = useState(false);

  // Sync local state from selected company
  useEffect(() => {
    if (!selectedCompany) return;
    setCompanyName(selectedCompany.name);
    setDescription(selectedCompany.description ?? "");
    setBrandColor(selectedCompany.brandColor ?? "");
  }, [selectedCompany]);

  const { data: projects = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.projects.list(selectedCompanyId) : ["projects", "__none__"],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const workspaces = useMemo(
    () => projects.flatMap((project) =>
      project.workspaces.map((workspace) => ({
        ...workspace,
        projectName: project.name,
      }))),
    [projects],
  );

  const { data: setupProgress } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.companies.setupProgress(selectedCompanyId) : ["companies", "__none__", "setup-progress"],
    queryFn: () => companiesApi.getSetupProgress(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const { data: doctorReport, refetch: refetchDoctor, isFetching: doctorFetching } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.companies.doctor(selectedCompanyId) : ["companies", "__none__", "doctor"],
    queryFn: () => companiesApi.getDoctorReport(selectedCompanyId!, {
      workspaceId: setupProgress?.selectedWorkspaceId ?? undefined,
    }),
    enabled: Boolean(selectedCompanyId),
  });

  const { data: workflowTemplatesView } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.companies.workflowTemplates(selectedCompanyId) : ["companies", "__none__", "workflow-templates"],
    queryFn: () => companiesApi.getWorkflowTemplates(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const { data: teamBlueprintCatalog } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.companies.teamBlueprints(selectedCompanyId) : ["companies", "__none__", "team-blueprints"],
    queryFn: () => companiesApi.getTeamBlueprints(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const teamBlueprintImportBundleParse = useMemo(() => {
    if (teamBlueprintImportText.trim().length === 0) {
      return {
        bundle: null,
        error: null,
      };
    }
    try {
      return {
        bundle: JSON.parse(teamBlueprintImportText) as unknown,
        error: null,
      };
    } catch (error) {
      return {
        bundle: null,
        error: error instanceof Error ? error.message : "Invalid JSON",
      };
    }
  }, [teamBlueprintImportText]);

  const { data: rolePacks = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.companies.rolePacks(selectedCompanyId) : ["companies", "__none__", "role-packs"],
    queryFn: () => companiesApi.listRolePacks(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  useEffect(() => {
    setTeamBlueprintPreview(null);
    setTeamBlueprintApplyResult(null);
    setConfirmTeamBlueprintApply(false);
    setTeamBlueprintPreviewRequests({});
    setSelectedSavedTeamBlueprintId(null);
    setSavedTeamBlueprintPreviewState(null);
    setSavedTeamBlueprintApplyResult(null);
    setConfirmSavedTeamBlueprintApply(false);
    setSavedTeamBlueprintPreviewRequests({});
    setSavedTeamBlueprintMetadataDrafts({});
    setTeamBlueprintImportPreview(null);
    setConfirmTeamBlueprintImport(false);
  }, [selectedCompanyId]);

  useEffect(() => {
    const catalogBlueprints = teamBlueprintCatalog?.blueprints ?? [];
    const firstBlueprint = catalogBlueprints[0]?.key ?? null;
    if (!selectedTeamBlueprintKey && firstBlueprint) {
      setSelectedTeamBlueprintKey(firstBlueprint);
      return;
    }
    if (
      selectedTeamBlueprintKey
      && !catalogBlueprints.some((blueprint) => blueprint.key === selectedTeamBlueprintKey)
    ) {
      setSelectedTeamBlueprintKey(firstBlueprint);
    }
  }, [selectedTeamBlueprintKey, teamBlueprintCatalog]);

  useEffect(() => {
    setConfirmTeamBlueprintApply(false);
    setTeamBlueprintApplyResult((current) =>
      current && current.blueprintKey === selectedTeamBlueprintKey ? current : null);
  }, [selectedTeamBlueprintKey]);

  useEffect(() => {
    const firstSavedBlueprint = teamBlueprintCatalog?.savedBlueprints?.[0]?.id ?? null;
    if (!selectedSavedTeamBlueprintId && firstSavedBlueprint) {
      setSelectedSavedTeamBlueprintId(firstSavedBlueprint);
      return;
    }
    if (
      selectedSavedTeamBlueprintId
      && !teamBlueprintCatalog?.savedBlueprints?.some((entry) => entry.id === selectedSavedTeamBlueprintId)
    ) {
      setSelectedSavedTeamBlueprintId(firstSavedBlueprint);
    }
  }, [selectedSavedTeamBlueprintId, teamBlueprintCatalog]);

  useEffect(() => {
    setConfirmSavedTeamBlueprintApply(false);
    setSavedTeamBlueprintApplyResult((current) =>
      current && current.savedBlueprintId === selectedSavedTeamBlueprintId ? current : null);
  }, [selectedSavedTeamBlueprintId]);

  useEffect(() => {
    if (!selectedSavedTeamBlueprintId) return;
    const selected = teamBlueprintCatalog?.savedBlueprints?.find((entry) => entry.id === selectedSavedTeamBlueprintId);
    if (!selected) return;
    setSavedTeamBlueprintMetadataDrafts((current) => (
      current[selected.id]
        ? current
        : {
          ...current,
          [selected.id]: {
            slug: selected.definition.slug,
            label: selected.definition.label,
            description: selected.definition.description ?? "",
          },
        }
    ));
  }, [selectedSavedTeamBlueprintId, teamBlueprintCatalog]);
  const { data: rolePackPresets = [] } = useQuery({
    queryKey: queryKeys.companies.rolePackPresets,
    queryFn: () => companiesApi.listRolePackPresets(),
    enabled: Boolean(selectedCompanyId),
  });
  const { data: selectedRolePackRevisions = [] } = useQuery({
    queryKey:
      selectedCompanyId && selectedRolePackId
        ? queryKeys.companies.rolePackRevisions(selectedCompanyId, selectedRolePackId)
        : ["companies", "__none__", "role-pack-revisions"],
    queryFn: () => companiesApi.listRolePackRevisions(selectedCompanyId!, selectedRolePackId!),
    enabled: Boolean(selectedCompanyId && selectedRolePackId),
  });

  const { data: retrievalPolicies = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.companies.retrievalPolicies(selectedCompanyId) : ["companies", "__none__", "retrieval-policies"],
    queryFn: () => knowledgeApi.listRetrievalPolicies(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const { data: operatingAlerts } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.companies.operatingAlerts(selectedCompanyId) : ["companies", "__none__", "operating-alerts"],
    queryFn: () => companiesApi.getOperatingAlerts(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  useEffect(() => {
    setSetupEngine(setupProgress?.selectedEngine ?? "");
    setSetupWorkspaceId(setupProgress?.selectedWorkspaceId ?? "");
  }, [setupProgress?.selectedEngine, setupProgress?.selectedWorkspaceId]);

  useEffect(() => {
    setDeepDoctorReport(null);
  }, [selectedCompanyId, setupProgress?.selectedEngine, setupProgress?.selectedWorkspaceId]);

  useEffect(() => {
    if (rolePacks.length === 0) {
      setSelectedRolePackId(null);
      return;
    }
    setSelectedRolePackId((current) =>
      current && rolePacks.some((rolePack) => rolePack.id === current) ? current : rolePacks[0]?.id ?? null);
  }, [rolePacks]);

  useEffect(() => {
    const presetFromPack = rolePacks[0]?.metadata?.presetKey;
    if (
      presetFromPack === "squadrail_default_v1"
      || presetFromPack === "example_product_squad_v1"
      || presetFromPack === "example_large_org_v1"
    ) {
      setSelectedRolePackPresetKey(presetFromPack);
    }
  }, [rolePacks]);

  useEffect(() => {
    if (!selectedRolePackId) return;
    const rolePack = rolePacks.find((entry) => entry.id === selectedRolePackId);
    if (!rolePack) return;
    setRolePackDrafts((current) => {
      if (current[selectedRolePackId]) return current;
      return {
        ...current,
        [selectedRolePackId]: buildRolePackDraft(rolePack),
      };
    });
  }, [rolePacks, selectedRolePackId]);

  useEffect(() => {
    if (selectedRolePackRevisions.length === 0) {
      setSelectedRolePackRevisionId(null);
      return;
    }
    setSelectedRolePackRevisionId((current) =>
      current && selectedRolePackRevisions.some((revision) => revision.id === current)
        ? current
        : selectedRolePackRevisions[0]?.id ?? null);
  }, [selectedRolePackRevisions]);

  useEffect(() => {
    const templates = workflowTemplatesView?.templates ?? [];
    if (templates.length === 0) {
      setSelectedWorkflowTemplateId(null);
      return;
    }
    setSelectedWorkflowTemplateId((current) =>
      current && templates.some((template) => template.id === current)
        ? current
        : templates[0]?.id ?? null);
  }, [workflowTemplatesView?.templates]);

  useEffect(() => {
    const template = (workflowTemplatesView?.templates ?? []).find((entry) => entry.id === selectedWorkflowTemplateId);
    if (!template) return;
    setWorkflowTemplateLabel(template.label);
    setWorkflowTemplateDescription(template.description ?? "");
    setWorkflowTemplateSummary(template.summary ?? "");
    setWorkflowTemplateFieldsText(stringifyWorkflowTemplateFields(template.fields));
    setNewWorkflowTemplateAction(template.actionType);
  }, [selectedWorkflowTemplateId, workflowTemplatesView?.templates]);

  useEffect(() => {
    if (retrievalPolicies.length === 0) {
      setSelectedPolicyKey("");
      return;
    }
    setSelectedPolicyKey((current) =>
      current && retrievalPolicies.some((policy) => retrievalPolicyKey(policy) === current)
        ? current
        : retrievalPolicyKey(retrievalPolicies[0]!));
  }, [retrievalPolicies]);

  useEffect(() => {
    const policy = retrievalPolicies.find((entry) => retrievalPolicyKey(entry) === selectedPolicyKey);
    if (!policy) return;
    setPolicyRole(policy.role);
    setPolicyEventType(policy.eventType);
    setPolicyWorkflowState(policy.workflowState);
    setPolicyTopKDense(String(policy.topKDense));
    setPolicyTopKSparse(String(policy.topKSparse));
    setPolicyRerankK(String(policy.rerankK));
    setPolicyFinalK(String(policy.finalK));
    setPolicySourceTypes(policy.allowedSourceTypes.join(", "));
    setPolicyAuthorityLevels(policy.allowedAuthorityLevels.join(", "));
    setPolicyMetadataText(JSON.stringify(policy.metadata ?? {}, null, 2));
  }, [retrievalPolicies, selectedPolicyKey]);

  useEffect(() => {
    if (!operatingAlerts) return;
    setAlertEnabled(operatingAlerts.config.enabled);
    setAlertMinSeverity(operatingAlerts.config.minSeverity);
    setAlertCooldownMinutes(String(operatingAlerts.config.cooldownMinutes));
    setAlertDestinations(operatingAlerts.config.destinations);
  }, [operatingAlerts]);

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const generalDirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      description !== (selectedCompany.description ?? "") ||
      brandColor !== (selectedCompany.brandColor ?? ""));

  const setupDirty =
    Boolean(selectedCompanyId) &&
    (setupEngine !== (setupProgress?.selectedEngine ?? "") ||
      setupWorkspaceId !== (setupProgress?.selectedWorkspaceId ?? ""));

  const normalizedAlertDestinations = alertDestinations.map((destination) => ({
    ...destination,
    label: destination.label.trim(),
    url: destination.url.trim(),
    authHeaderName: destination.authHeaderName?.trim() || null,
    authHeaderValue: destination.authHeaderValue?.trim() || null,
  }));
  const alertDraft = {
    enabled: alertEnabled,
    minSeverity: alertMinSeverity,
    cooldownMinutes: Number(alertCooldownMinutes || 0),
    destinations: normalizedAlertDestinations,
  };
  const alertSavedConfig = operatingAlerts?.config ?? {
    enabled: false,
    minSeverity: "high" as const,
    cooldownMinutes: 15,
    destinations: [],
  };
  const alertDirty =
    JSON.stringify(alertDraft) !== JSON.stringify(alertSavedConfig);
  const alertConfigValid =
    Number.isInteger(alertDraft.cooldownMinutes)
    && alertDraft.cooldownMinutes >= 1
    && normalizedAlertDestinations.every((destination) => destination.label && destination.url);

  const generalMutation = useMutation({
    mutationFn: (data: { name: string; description: string | null; brandColor: string | null }) =>
      companiesApi.update(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      companiesApi.update(selectedCompanyId!, {
        requireBoardApprovalForNewAgents: requireApproval,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createCompanyInvite(selectedCompanyId!, {
        allowedJoinTypes: "both",
        expiresInHours: 72,
      }),
    onSuccess: (invite) => {
      setInviteError(null);
      const base = window.location.origin.replace(/\/+$/, "");
      const absoluteUrl = invite.inviteUrl.startsWith("http")
        ? invite.inviteUrl
        : `${base}${invite.inviteUrl}`;
      setInviteLink(absoluteUrl);
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId!) });
    },
    onError: (err) => {
      setInviteError(err instanceof Error ? err.message : "Failed to create invite");
    },
  });
  const archiveMutation = useMutation({
    mutationFn: ({
      companyId,
      nextCompanyId,
    }: {
      companyId: string;
      nextCompanyId: string | null;
    }) => companiesApi.archive(companyId).then(() => ({ nextCompanyId })),
    onSuccess: async ({ nextCompanyId }) => {
      if (nextCompanyId) {
        setSelectedCompanyId(nextCompanyId);
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.stats });
    },
  });

  const setupMutation = useMutation({
    mutationFn: () =>
      companiesApi.updateSetupProgress(selectedCompanyId!, {
        selectedEngine: setupEngine ? (setupEngine as "claude_local" | "codex_local") : null,
        selectedWorkspaceId: setupWorkspaceId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.setupProgress(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.doctor(selectedCompanyId!) });
    },
  });

  const deepDoctorMutation = useMutation({
    mutationFn: () =>
      companiesApi.getDoctorReport(selectedCompanyId!, {
        deep: true,
        workspaceId: setupWorkspaceId || undefined,
      }),
    onSuccess: (report) => {
      setDeepDoctorReport(report);
    },
  });

  const seedRolePacksMutation = useMutation({
    mutationFn: (force: boolean) =>
      companiesApi.seedDefaultRolePacks(selectedCompanyId!, {
        force,
        presetKey: selectedRolePackPresetKey,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.rolePacks(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.setupProgress(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.doctor(selectedCompanyId!) });
    },
  });

  const workflowTemplatesMutation = useMutation({
    mutationFn: (templates: WorkflowTemplate[]) =>
      companiesApi.updateWorkflowTemplates(selectedCompanyId!, {
        templates: templates.map((template) => ({
          id: template.id,
          actionType: template.actionType,
          label: template.label,
          description: template.description,
          summary: template.summary,
          fields: template.fields,
        })),
      }),
    onSuccess: (view) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.workflowTemplates(selectedCompanyId!) });
      setSelectedWorkflowTemplateId((current) =>
        current && view.templates.some((template) => template.id === current)
          ? current
          : view.companyTemplates[0]?.id ?? view.templates[0]?.id ?? null);
    },
  });

  const teamBlueprintPreviewMutation = useMutation({
    mutationFn: async (input: {
      companyId: string;
      blueprintKey: TeamBlueprintKey;
      request?: TeamBlueprintPreviewRequest;
    }) =>
      companiesApi.previewTeamBlueprint(input.companyId, input.blueprintKey, input.request),
    onSuccess: (preview) => {
      setSelectedTeamBlueprintKey(preview.blueprint.key);
      setTeamBlueprintPreview(preview);
      setTeamBlueprintApplyResult(null);
      setConfirmTeamBlueprintApply(false);
    },
  });

  const teamBlueprintSaveMutation = useMutation({
    mutationFn: async (input: {
      companyId: string;
      blueprintKey: TeamBlueprintKey;
      preview: TeamBlueprintPreviewResult;
      slug: string;
      label: string;
      description: string | null;
      versionNote: string | null;
    }) =>
      companiesApi.saveTeamBlueprint(input.companyId, input.blueprintKey, {
        previewHash: input.preview.previewHash,
        projectCount: input.preview.parameters.projectCount,
        engineerPairsPerProject: input.preview.parameters.engineerPairsPerProject,
        includePm: input.preview.parameters.includePm,
        includeQa: input.preview.parameters.includeQa,
        includeCto: input.preview.parameters.includeCto,
        slug: input.slug,
        label: input.label,
        description: input.description,
        versionNote: input.versionNote,
      }),
    onSuccess: async (result, variables) => {
      setSelectedSavedTeamBlueprintId(result.savedBlueprint.id);
      setSavedTeamBlueprintMetadataDrafts((current) => ({
        ...current,
        [result.savedBlueprint.id]: {
          slug: result.savedBlueprint.definition.slug,
          label: result.savedBlueprint.definition.label,
          description: result.savedBlueprint.definition.description ?? "",
        },
      }));
      setSavedTeamBlueprintPreviewRequests((current) => ({
        ...current,
        [result.savedBlueprint.id]: result.savedBlueprint.defaultPreviewRequest,
      }));
      setSavedTeamBlueprintVersionDrafts((current) => {
        const next = { ...current };
        delete next[result.savedBlueprint.id];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.teamBlueprints(variables.companyId) });
      pushToast({
        tone: "success",
        title: `Saved ${result.savedBlueprint.definition.label}`,
        body: "Preview defaults were stored in the company blueprint library.",
        dedupeKey: `team-blueprint-save:${variables.companyId}:${result.savedBlueprint.id}`,
      });
    },
    onError: (error, variables) => {
      pushToast({
        tone: "error",
        title: "Library save failed",
        body: error instanceof Error ? error.message : "Failed to save blueprint defaults to the company library",
        dedupeKey: `team-blueprint-save-error:${variables.companyId}:${variables.blueprintKey}`,
      });
    },
  });

  const teamBlueprintApplyMutation = useMutation({
    mutationFn: async (input: { companyId: string; preview: TeamBlueprintPreviewResult }) =>
      companiesApi.applyTeamBlueprint(input.companyId, input.preview.blueprint.key, {
        previewHash: input.preview.previewHash,
        projectCount: input.preview.parameters.projectCount,
        engineerPairsPerProject: input.preview.parameters.engineerPairsPerProject,
        includePm: input.preview.parameters.includePm,
        includeQa: input.preview.parameters.includeQa,
        includeCto: input.preview.parameters.includeCto,
      }),
    onSuccess: async (result, variables) => {
      if (variables.companyId === selectedCompanyId) {
        setTeamBlueprintApplyResult(result);
        setTeamBlueprintPreview(null);
        setConfirmTeamBlueprintApply(false);
      }
      await invalidateTeamBuilderQueries(variables.companyId);
      pushToast({
        tone: "success",
        title: `Applied ${result.blueprintKey}`,
        body: `${result.summary.createdProjectCount} project(s), ${result.summary.createdAgentCount} agent(s), ${result.summary.updatedAgentCount} agent update(s).`,
        dedupeKey: `team-blueprint-apply:${variables.companyId}:${result.previewHash}`,
      });
    },
    onError: (error, variables) => {
      pushToast({
        tone: "error",
        title: "Blueprint apply failed",
        body: error instanceof Error ? error.message : "Failed to apply team blueprint",
        dedupeKey: `team-blueprint-apply-error:${variables.companyId}:${variables.preview.blueprint.key}`,
      });
    },
  });

  const savedTeamBlueprintApplyMutation = useMutation({
    mutationFn: async (input: {
      companyId: string;
      savedBlueprintId: string;
      preview: TeamBlueprintPreviewResult;
    }) =>
      companiesApi.applySavedTeamBlueprint(input.companyId, input.savedBlueprintId, {
        previewHash: input.preview.previewHash,
        projectCount: input.preview.parameters.projectCount,
        engineerPairsPerProject: input.preview.parameters.engineerPairsPerProject,
        includePm: input.preview.parameters.includePm,
        includeQa: input.preview.parameters.includeQa,
        includeCto: input.preview.parameters.includeCto,
      }),
    onSuccess: async (result, variables) => {
      if (variables.companyId === selectedCompanyId) {
        setSavedTeamBlueprintApplyResult({
          savedBlueprintId: variables.savedBlueprintId,
          result,
        });
        setConfirmSavedTeamBlueprintApply(false);
      }
      await invalidateTeamBuilderQueries(variables.companyId);
      pushToast({
        tone: "success",
        title: `Applied saved ${result.blueprintKey}`,
        body: `${result.summary.createdProjectCount} project(s), ${result.summary.createdAgentCount} agent(s), ${result.summary.updatedAgentCount} agent update(s).`,
        dedupeKey: `saved-team-blueprint-apply:${variables.companyId}:${variables.savedBlueprintId}:${result.previewHash}`,
      });
    },
    onError: (error, variables) => {
      pushToast({
        tone: "error",
        title: "Saved blueprint apply failed",
        body: error instanceof Error ? error.message : "Failed to apply saved team blueprint",
        dedupeKey: `saved-team-blueprint-apply-error:${variables.companyId}:${variables.savedBlueprintId}`,
      });
    },
  });

  const teamBlueprintExportMutation = useMutation({
    mutationFn: async (input: { companyId: string; blueprintKey: TeamBlueprintKey }) =>
      companiesApi.exportTeamBlueprint(input.companyId, input.blueprintKey),
    onSuccess: (result, variables) => {
      const filename = `${result.bundle.definition.slug || variables.blueprintKey}.team-blueprint.json`;
      downloadJsonFile(filename, result.bundle);
      pushToast({
        tone: "success",
        title: `Exported ${result.bundle.source.blueprintLabel}`,
        body: `Downloaded ${filename}`,
        dedupeKey: `team-blueprint-export:${variables.companyId}:${variables.blueprintKey}`,
      });
    },
    onError: (error, variables) => {
      pushToast({
        tone: "error",
        title: "Blueprint export failed",
        body: error instanceof Error ? error.message : "Failed to export team blueprint",
        dedupeKey: `team-blueprint-export-error:${variables.companyId}:${variables.blueprintKey}`,
      });
    },
  });

  const teamBlueprintImportPreviewMutation = useMutation({
    mutationFn: async (input: {
      companyId: string;
      bundle: unknown;
      slug?: string | null;
      label?: string | null;
      collisionStrategy: "rename" | "replace";
    }) =>
      companiesApi.previewTeamBlueprintImport(input.companyId, {
        source: {
          type: "inline",
          bundle: input.bundle as never,
        },
        slug: input.slug ?? null,
        label: input.label ?? null,
        collisionStrategy: input.collisionStrategy,
      }),
    onSuccess: (preview) => {
      setTeamBlueprintImportPreview(preview);
      setConfirmTeamBlueprintImport(false);
    },
  });

  const teamBlueprintImportMutation = useMutation({
    mutationFn: async (input: {
      companyId: string;
      bundle: unknown;
      slug?: string | null;
      label?: string | null;
      collisionStrategy: "rename" | "replace";
      previewHash: string;
    }) =>
      companiesApi.importTeamBlueprint(input.companyId, {
        previewHash: input.previewHash,
        source: {
          type: "inline",
          bundle: input.bundle as never,
        },
        slug: input.slug ?? null,
        label: input.label ?? null,
        collisionStrategy: input.collisionStrategy,
      }),
    onSuccess: async (result, variables) => {
      setSelectedSavedTeamBlueprintId(result.savedBlueprint.id);
      setSavedTeamBlueprintMetadataDrafts((current) => ({
        ...current,
        [result.savedBlueprint.id]: {
          slug: result.savedBlueprint.definition.slug,
          label: result.savedBlueprint.definition.label,
          description: result.savedBlueprint.definition.description ?? "",
        },
      }));
      setSavedTeamBlueprintVersionDrafts((current) => {
        const next = { ...current };
        delete next[result.savedBlueprint.id];
        return next;
      });
      setSavedTeamBlueprintPreviewState(null);
      setTeamBlueprintImportPreview(null);
      setConfirmTeamBlueprintImport(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.teamBlueprints(variables.companyId) });
      pushToast({
        tone: "success",
        title: `Saved ${result.savedBlueprint.definition.label}`,
        body: `${result.action === "created" ? "Created" : "Updated"} company blueprint library entry.`,
        dedupeKey: `team-blueprint-import:${variables.companyId}:${result.savedBlueprint.id}`,
      });
    },
    onError: (error, variables) => {
      pushToast({
        tone: "error",
        title: "Blueprint import failed",
        body: error instanceof Error ? error.message : "Failed to save imported team blueprint",
        dedupeKey: `team-blueprint-import-error:${variables.companyId}:${variables.previewHash}`,
      });
    },
  });

  const savedTeamBlueprintExportMutation = useMutation({
    mutationFn: async (input: {
      companyId: string;
      savedBlueprintId: string;
    }) => companiesApi.exportSavedTeamBlueprint(input.companyId, input.savedBlueprintId),
    onSuccess: (result, variables) => {
      const filename = `${result.bundle.definition.slug || "team-blueprint"}.json`;
      downloadJsonFile(filename, result.bundle);
      pushToast({
        tone: "success",
        title: `Exported ${result.bundle.definition.label}`,
        body: "Saved blueprint bundle downloaded as JSON.",
        dedupeKey: `saved-team-blueprint-export:${variables.companyId}:${variables.savedBlueprintId}`,
      });
    },
    onError: (error, variables) => {
      pushToast({
        tone: "error",
        title: "Saved blueprint export failed",
        body: error instanceof Error ? error.message : "Failed to export saved team blueprint",
        dedupeKey: `saved-team-blueprint-export-error:${variables.companyId}:${variables.savedBlueprintId}`,
      });
    },
  });

  const savedTeamBlueprintUpdateMutation = useMutation({
    mutationFn: async (input: {
      companyId: string;
      savedBlueprintId: string;
      slug: string;
      label: string;
      description: string | null;
    }) => companiesApi.updateSavedTeamBlueprint(input.companyId, input.savedBlueprintId, {
      slug: input.slug,
      label: input.label,
      description: input.description,
    }),
    onSuccess: async (result, variables) => {
      setSavedTeamBlueprintMetadataDrafts((current) => ({
        ...current,
        [result.savedBlueprint.id]: {
          slug: result.savedBlueprint.definition.slug,
          label: result.savedBlueprint.definition.label,
          description: result.savedBlueprint.definition.description ?? "",
        },
      }));
      setSavedTeamBlueprintPreviewState((current) =>
        current && current.savedBlueprintId === result.savedBlueprint.id ? null : current);
      setSavedTeamBlueprintApplyResult((current) =>
        current && current.savedBlueprintId === result.savedBlueprint.id ? null : current);
      setSavedTeamBlueprintVersionDrafts((current) => {
        const next = { ...current };
        delete next[result.savedBlueprint.id];
        return next;
      });
      setConfirmSavedTeamBlueprintApply(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.teamBlueprints(variables.companyId) });
      pushToast({
        tone: "success",
        title: `Updated ${result.savedBlueprint.definition.label}`,
        body: "Saved blueprint library metadata updated.",
        dedupeKey: `saved-team-blueprint-update:${variables.companyId}:${variables.savedBlueprintId}`,
      });
    },
    onError: (error, variables) => {
      pushToast({
        tone: "error",
        title: "Saved blueprint update failed",
        body: error instanceof Error ? error.message : "Failed to update saved blueprint",
        dedupeKey: `saved-team-blueprint-update-error:${variables.companyId}:${variables.savedBlueprintId}`,
      });
    },
  });

  const savedTeamBlueprintDeleteMutation = useMutation({
    mutationFn: async (input: {
      companyId: string;
      savedBlueprintId: string;
    }) => companiesApi.deleteSavedTeamBlueprint(input.companyId, input.savedBlueprintId),
    onSuccess: async (result, variables) => {
      setSavedTeamBlueprintMetadataDrafts((current) => {
        const next = { ...current };
        delete next[result.deletedSavedBlueprintId];
        return next;
      });
      setSavedTeamBlueprintPreviewRequests((current) => {
        const next = { ...current };
        delete next[result.deletedSavedBlueprintId];
        return next;
      });
      setSavedTeamBlueprintVersionDrafts((current) => {
        const next = { ...current };
        delete next[result.deletedSavedBlueprintId];
        return next;
      });
      setSavedTeamBlueprintPreviewState((current) =>
        current && current.savedBlueprintId === result.deletedSavedBlueprintId ? null : current);
      setSavedTeamBlueprintApplyResult((current) =>
        current && current.savedBlueprintId === result.deletedSavedBlueprintId ? null : current);
      setConfirmSavedTeamBlueprintApply(false);
      if (selectedSavedTeamBlueprintId === result.deletedSavedBlueprintId) {
        setSelectedSavedTeamBlueprintId(null);
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.teamBlueprints(variables.companyId) });
      pushToast({
        tone: "success",
        title: "Saved blueprint deleted",
        body: "The company blueprint library entry was removed.",
        dedupeKey: `saved-team-blueprint-delete:${variables.companyId}:${variables.savedBlueprintId}`,
      });
    },
    onError: (error, variables) => {
      pushToast({
        tone: "error",
        title: "Saved blueprint delete failed",
        body: error instanceof Error ? error.message : "Failed to delete saved blueprint",
        dedupeKey: `saved-team-blueprint-delete-error:${variables.companyId}:${variables.savedBlueprintId}`,
      });
    },
  });

  const savedTeamBlueprintPreviewMutation = useMutation({
    mutationFn: async (input: {
      companyId: string;
      savedBlueprintId: string;
      request?: TeamBlueprintPreviewRequest;
    }) =>
      companiesApi.previewSavedTeamBlueprint(input.companyId, input.savedBlueprintId, input.request),
    onSuccess: (preview, variables) => {
      setSavedTeamBlueprintPreviewState({
        savedBlueprintId: variables.savedBlueprintId,
        preview,
      });
      setSavedTeamBlueprintApplyResult(null);
      setConfirmSavedTeamBlueprintApply(false);
    },
  });

  const savedTeamBlueprintCreateVersionMutation = useMutation({
    mutationFn: async (input: {
      companyId: string;
      savedBlueprintId: string;
      preview: TeamBlueprintPreviewResult;
      slug?: string | null;
      label?: string | null;
      description?: string | null;
      versionNote?: string | null;
    }) =>
      companiesApi.createSavedTeamBlueprintVersion(input.companyId, input.savedBlueprintId, {
        previewHash: input.preview.previewHash,
        projectCount: input.preview.parameters.projectCount,
        engineerPairsPerProject: input.preview.parameters.engineerPairsPerProject,
        includePm: input.preview.parameters.includePm,
        includeQa: input.preview.parameters.includeQa,
        includeCto: input.preview.parameters.includeCto,
        slug: input.slug ?? null,
        label: input.label ?? null,
        description: input.description ?? null,
        versionNote: input.versionNote ?? null,
      }),
    onSuccess: async (result, variables) => {
      setSelectedSavedTeamBlueprintId(result.savedBlueprint.id);
      setSavedTeamBlueprintMetadataDrafts((current) => ({
        ...current,
        [result.savedBlueprint.id]: {
          slug: result.savedBlueprint.definition.slug,
          label: result.savedBlueprint.definition.label,
          description: result.savedBlueprint.definition.description ?? "",
        },
      }));
      setSavedTeamBlueprintPreviewRequests((current) => ({
        ...current,
        [result.savedBlueprint.id]: result.savedBlueprint.defaultPreviewRequest,
      }));
      setSavedTeamBlueprintPreviewState(null);
      setSavedTeamBlueprintApplyResult(null);
      setConfirmSavedTeamBlueprintApply(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.teamBlueprints(variables.companyId) });
      pushToast({
        tone: "success",
        title: `Created ${result.savedBlueprint.definition.label}`,
        body: "Saved blueprint preview was stored as the next company-local version.",
        dedupeKey: `saved-team-blueprint-version:${variables.companyId}:${result.savedBlueprint.id}`,
      });
    },
    onError: (error, variables) => {
      pushToast({
        tone: "error",
        title: "Version save failed",
        body: error instanceof Error ? error.message : "Failed to save the next blueprint version",
        dedupeKey: `saved-team-blueprint-version-error:${variables.companyId}:${variables.savedBlueprintId}`,
      });
    },
  });

  const savedTeamBlueprintPublishMutation = useMutation({
    mutationFn: async (input: {
      companyId: string;
      savedBlueprintId: string;
    }) => companiesApi.publishSavedTeamBlueprint(input.companyId, input.savedBlueprintId),
    onSuccess: async (result, variables) => {
      setSelectedSavedTeamBlueprintId(result.savedBlueprint.id);
      setSavedTeamBlueprintPreviewState((current) =>
        current && current.savedBlueprintId === result.savedBlueprint.id ? null : current);
      setSavedTeamBlueprintApplyResult((current) =>
        current && current.savedBlueprintId === result.savedBlueprint.id ? null : current);
      setConfirmSavedTeamBlueprintApply(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.teamBlueprints(variables.companyId) });
      pushToast({
        tone: "success",
        title: `Published ${result.savedBlueprint.definition.label}`,
        body: result.supersededSavedBlueprintIds.length > 0
          ? `Promoted this version and superseded ${result.supersededSavedBlueprintIds.length} published version(s).`
          : "Promoted this saved blueprint version as the current published entry.",
        dedupeKey: `saved-team-blueprint-publish:${variables.companyId}:${variables.savedBlueprintId}`,
      });
    },
    onError: (error, variables) => {
      pushToast({
        tone: "error",
        title: "Publish failed",
        body: error instanceof Error ? error.message : "Failed to publish saved blueprint version",
        dedupeKey: `saved-team-blueprint-publish-error:${variables.companyId}:${variables.savedBlueprintId}`,
      });
    },
  });

  const createCustomRoleMutation = useMutation({
    mutationFn: () =>
      companiesApi.createCustomRolePack(selectedCompanyId!, {
        roleName: customRoleName.trim(),
        roleSlug: customRoleSlug.trim() || null,
        baseRoleKey: customRoleBaseRoleKey,
        description: customRoleDescription.trim() || null,
        publish: customRolePublish,
      }),
    onSuccess: (rolePack) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.rolePacks(selectedCompanyId!) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.companies.rolePackRevisions(selectedCompanyId!, rolePack.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.setupProgress(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.doctor(selectedCompanyId!) });
      setSelectedRolePackId(rolePack.id);
      setSelectedRolePackFile("ROLE.md");
      setCustomRoleName("");
      setCustomRoleSlug("");
      setCustomRoleDescription("");
      setCustomRoleBaseRoleKey("engineer");
      setCustomRolePublish(true);
    },
  });

  const selectedRolePackPreset =
    rolePackPresets.find((preset) => preset.key === selectedRolePackPresetKey) ??
    ({
      key: "squadrail_default_v1",
      label: "Squadrail Default",
      description: "General-purpose delivery squad for protocol-first planning, implementation, and review.",
      recommended: true,
      starterTaskTitle: "",
      starterTaskDescription: "",
    } satisfies RolePackPresetDescriptor);

  const createRolePackRevisionMutation = useMutation({
    mutationFn: async (input: {
      rolePackSetId: string;
      status: "draft" | "published";
      files: Record<RolePackFileName, string>;
      message: string | null;
    }) => companiesApi.createRolePackRevision(selectedCompanyId!, input.rolePackSetId, {
      status: input.status,
      message: input.message,
      files: ROLE_PACK_FILE_NAMES.map((filename) => ({
        filename,
        content: input.files[filename] ?? "",
      })),
    }),
    onSuccess: (updatedRolePack) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.rolePacks(selectedCompanyId!) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.companies.rolePackRevisions(selectedCompanyId!, updatedRolePack.id),
      });
      setSelectedRolePackRevisionId(updatedRolePack.latestRevision?.id ?? null);
      setRolePackRevisionMessage("");
      setRolePackDrafts((current) => ({
        ...current,
        [updatedRolePack.id]: buildRolePackDraft(updatedRolePack),
      }));
      setRolePackRestoreSources((current) => ({
        ...current,
        [updatedRolePack.id]: null,
      }));
    },
  });

  const restoreRolePackRevisionMutation = useMutation({
    mutationFn: async (input: {
      rolePackSetId: string;
      revisionId: string;
      message: string;
    }) => companiesApi.restoreRolePackRevision(selectedCompanyId!, input.rolePackSetId, input.revisionId, {
      message: input.message,
      status: "draft",
    }),
    onSuccess: (updatedRolePack) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.rolePacks(selectedCompanyId!) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.companies.rolePackRevisions(selectedCompanyId!, updatedRolePack.id),
      });
      setSelectedRolePackRevisionId(updatedRolePack.latestRevision?.id ?? null);
      setRolePackDrafts((current) => ({
        ...current,
        [updatedRolePack.id]: buildRolePackDraft(updatedRolePack),
      }));
      setRolePackRestoreSources((current) => ({
        ...current,
        [updatedRolePack.id]: updatedRolePack.latestRevision?.id ?? null,
      }));
      setRolePackRevisionMessage("");
    },
  });

  const upsertRetrievalPolicyMutation = useMutation({
    mutationFn: async () => {
      const metadata = policyMetadataText.trim() ? JSON.parse(policyMetadataText) as Record<string, unknown> : {};
      return knowledgeApi.upsertRetrievalPolicy({
        companyId: selectedCompanyId!,
        role: policyRole.trim(),
        eventType: policyEventType.trim(),
        workflowState: policyWorkflowState.trim(),
        topKDense: Number(policyTopKDense),
        topKSparse: Number(policyTopKSparse),
        rerankK: Number(policyRerankK),
        finalK: Number(policyFinalK),
        allowedSourceTypes: csvToList(policySourceTypes),
        allowedAuthorityLevels: csvToList(policyAuthorityLevels),
        metadata,
      });
    },
    onSuccess: (policy) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.retrievalPolicies(selectedCompanyId!) });
      setSelectedPolicyKey(retrievalPolicyKey(policy));
    },
  });

  const operatingAlertsMutation = useMutation({
    mutationFn: () => companiesApi.updateOperatingAlerts(selectedCompanyId!, alertDraft),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.operatingAlerts(selectedCompanyId!) });
    },
  });

  const operatingAlertTestMutation = useMutation({
    mutationFn: () =>
      companiesApi.sendOperatingAlertTest(selectedCompanyId!, {
        severity: alertMinSeverity,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.operatingAlerts(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.activity(selectedCompanyId!) });
    },
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: appRoutes.overview },
      { label: "Settings" },
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No company selected. Select a company from the switcher above.
      </div>
    );
  }

  function handleSaveGeneral() {
    generalMutation.mutate({
      name: companyName.trim(),
      description: description.trim() || null,
      brandColor: brandColor || null,
    });
  }

  const selectedRolePack = selectedRolePackId
    ? rolePacks.find((rolePack) => rolePack.id === selectedRolePackId) ?? null
    : null;
  const selectedRolePackDraft = selectedRolePackId ? rolePackDrafts[selectedRolePackId] : null;
  const selectedRolePackRevision = selectedRolePackRevisions.find((revision) => revision.id === selectedRolePackRevisionId)
    ?? selectedRolePackRevisions[0]
    ?? null;
  const draftChangedFileCount =
    selectedRolePack && selectedRolePackDraft
      ? countChangedRolePackFiles(selectedRolePackDraft, selectedRolePack.latestFiles)
      : 0;
  const changedRolePackFiles =
    selectedRolePack && selectedRolePackDraft
      ? listChangedRolePackFiles(selectedRolePackDraft, selectedRolePack.latestFiles)
      : [];
  const restoredFromRevisionId = selectedRolePackId ? (rolePackRestoreSources[selectedRolePackId] ?? null) : null;
  const restoredFromRevision = restoredFromRevisionId
    ? selectedRolePackRevisions.find((revision) => revision.id === restoredFromRevisionId) ?? null
    : null;
  const selectedRolePackDiffBaseline = selectedRolePackRevision
    ? {
        label: `Revision v${selectedRolePackRevision.version}`,
        files: buildRolePackDraftFromFiles(selectedRolePackRevision.files),
      }
    : selectedRolePack
      ? {
          label: selectedRolePack.latestRevision ? `Latest v${selectedRolePack.latestRevision.version}` : "Latest revision",
          files: buildRolePackDraft(selectedRolePack),
        }
      : null;
  const canSaveRolePackDraft = draftChangedFileCount > 0;
  const canPublishRolePackRevision = canSaveRolePackDraft && rolePackRevisionMessage.trim().length > 0;
  const readinessStepCount = setupProgress ? Object.values(setupProgress.steps).filter(Boolean).length : 0;
  const readinessTotalSteps = setupProgress ? Object.keys(setupProgress.steps).length : 0;
  const activeDoctorReport = deepDoctorReport ?? doctorReport;
  const doctorFailCount = activeDoctorReport
    ? activeDoctorReport.checks.filter((check) => check.status === "fail").length
    : 0;
  const teamBlueprints = teamBlueprintCatalog?.blueprints ?? [];
  const savedTeamBlueprints = teamBlueprintCatalog?.savedBlueprints ?? [];
  const migrationHelpers = teamBlueprintCatalog?.migrationHelpers ?? [];
  const selectedTeamBlueprint: TeamBlueprint | null = selectedTeamBlueprintKey
    ? teamBlueprints.find((blueprint) => blueprint.key === selectedTeamBlueprintKey) ?? null
    : teamBlueprints[0] ?? null;
  const selectedMigrationHelpers =
    selectedTeamBlueprint
      ? migrationHelpers.filter((helper) => helper.blueprintKey === selectedTeamBlueprint.key)
      : [];
  const selectedTeamBlueprintPreview =
    teamBlueprintPreview && selectedTeamBlueprint && teamBlueprintPreview.blueprint.key === selectedTeamBlueprint.key
      ? teamBlueprintPreview
      : null;
  const selectedTeamBlueprintRequest = selectedTeamBlueprint
    ? (teamBlueprintPreviewRequests[selectedTeamBlueprint.key] ?? buildDefaultTeamBlueprintPreviewRequest(selectedTeamBlueprint))
    : undefined;
  const selectedTeamBlueprintParameterChanges = selectedTeamBlueprint
    ? describeTeamBlueprintParameterChanges(
      selectedTeamBlueprint,
      selectedTeamBlueprintPreview?.parameters ?? selectedTeamBlueprintRequest,
    )
    : [];
  const selectedTeamBlueprintLibraryDraft = selectedTeamBlueprint
    ? (teamBlueprintLibraryDrafts[selectedTeamBlueprint.key] ?? {
      slug: selectedTeamBlueprint.key,
      label: selectedTeamBlueprint.label,
      description: selectedTeamBlueprint.description,
      versionNote: "",
    })
    : null;
  const selectedTeamBlueprintLibraryDraftValid = selectedTeamBlueprintLibraryDraft
    ? selectedTeamBlueprintLibraryDraft.slug.trim().length > 0 && selectedTeamBlueprintLibraryDraft.label.trim().length > 0
    : false;
  const selectedSavedTeamBlueprint: CompanySavedTeamBlueprint | null = selectedSavedTeamBlueprintId
    ? savedTeamBlueprints.find((entry) => entry.id === selectedSavedTeamBlueprintId) ?? null
    : savedTeamBlueprints[0] ?? null;
  const selectedSavedTeamBlueprintVersionInfo = selectedSavedTeamBlueprint
    ? resolveSavedTeamBlueprintVersionInfo(selectedSavedTeamBlueprint)
    : null;
  const selectedSavedTeamBlueprintMetadataDraft = selectedSavedTeamBlueprint
    ? (savedTeamBlueprintMetadataDrafts[selectedSavedTeamBlueprint.id] ?? {
      slug: selectedSavedTeamBlueprint.definition.slug,
      label: selectedSavedTeamBlueprint.definition.label,
      description: selectedSavedTeamBlueprint.definition.description ?? "",
    })
    : null;
  const selectedSavedTeamBlueprintRequest = selectedSavedTeamBlueprint
    ? (savedTeamBlueprintPreviewRequests[selectedSavedTeamBlueprint.id]
      ?? buildDefaultTeamBlueprintPreviewRequest(
        selectedSavedTeamBlueprint.definition,
        selectedSavedTeamBlueprint.defaultPreviewRequest,
      ))
    : undefined;
  const selectedSavedTeamBlueprintPreview =
    savedTeamBlueprintPreviewState
    && selectedSavedTeamBlueprint
    && savedTeamBlueprintPreviewState.savedBlueprintId === selectedSavedTeamBlueprint.id
      ? savedTeamBlueprintPreviewState.preview
      : null;
  const selectedSavedTeamBlueprintApplyResult =
    savedTeamBlueprintApplyResult
    && selectedSavedTeamBlueprint
    && savedTeamBlueprintApplyResult.savedBlueprintId === selectedSavedTeamBlueprint.id
      ? savedTeamBlueprintApplyResult.result
      : null;
  const selectedSavedTeamBlueprintParameterChanges = selectedSavedTeamBlueprint
    ? describeTeamBlueprintParameterChanges(
      selectedSavedTeamBlueprint.definition,
      selectedSavedTeamBlueprintPreview?.parameters ?? selectedSavedTeamBlueprintRequest,
      selectedSavedTeamBlueprint.defaultPreviewRequest,
    )
    : [];
  const selectedSavedTeamBlueprintVersionDraft = selectedSavedTeamBlueprint && selectedSavedTeamBlueprintVersionInfo
    ? (savedTeamBlueprintVersionDrafts[selectedSavedTeamBlueprint.id] ?? {
      slug: buildNextSavedTeamBlueprintVersionSlug(
        selectedSavedTeamBlueprint.definition.slug,
        selectedSavedTeamBlueprintVersionInfo.version + 1,
      ),
      label: buildNextSavedTeamBlueprintVersionLabel(
        selectedSavedTeamBlueprint.definition.label,
        selectedSavedTeamBlueprintVersionInfo.version + 1,
      ),
      description: selectedSavedTeamBlueprint.definition.description ?? "",
      versionNote: "",
    })
    : null;
  const selectedSavedTeamBlueprintVersionDraftValid = selectedSavedTeamBlueprintVersionDraft
    ? selectedSavedTeamBlueprintVersionDraft.slug.trim().length > 0
      && selectedSavedTeamBlueprintVersionDraft.label.trim().length > 0
    : false;
  const selectedSavedTeamBlueprintLineage = selectedSavedTeamBlueprint && selectedSavedTeamBlueprintVersionInfo
    ? savedTeamBlueprints
      .filter((entry) => resolveSavedTeamBlueprintVersionInfo(entry).lineageKey === selectedSavedTeamBlueprintVersionInfo.lineageKey)
      .sort((left, right) => resolveSavedTeamBlueprintVersionInfo(right).version - resolveSavedTeamBlueprintVersionInfo(left).version)
    : [];
  const selectedSavedTeamBlueprintLifecycleState = selectedSavedTeamBlueprint
    ? resolveSavedTeamBlueprintLifecycleState(selectedSavedTeamBlueprint)
    : null;
  const selectedSavedTeamBlueprintDeleteRestriction = selectedSavedTeamBlueprint
    ? describeSavedTeamBlueprintDeleteRestriction(selectedSavedTeamBlueprint, selectedSavedTeamBlueprintLineage)
    : null;
  const canDeleteSelectedSavedTeamBlueprint = selectedSavedTeamBlueprint
    ? canDeleteSavedTeamBlueprint(selectedSavedTeamBlueprint, selectedSavedTeamBlueprintLineage)
    : false;
  const selectedSavedTeamBlueprintPreviousVersion = selectedSavedTeamBlueprint && selectedSavedTeamBlueprintVersionInfo
    ? selectedSavedTeamBlueprintLineage.find((entry) => entry.id === selectedSavedTeamBlueprintVersionInfo.parentSavedBlueprintId)
      ?? selectedSavedTeamBlueprintLineage.find((entry) =>
        entry.id !== selectedSavedTeamBlueprint.id
        && resolveSavedTeamBlueprintVersionInfo(entry).version < selectedSavedTeamBlueprintVersionInfo.version)
      ?? null
    : null;
  const selectedSavedTeamBlueprintVersionChanges = selectedSavedTeamBlueprint
    ? describeSavedTeamBlueprintVersionChanges(
      selectedSavedTeamBlueprint,
      selectedSavedTeamBlueprintPreviousVersion,
    )
    : [];
  const selectedSavedTeamBlueprintMetadataDirty = selectedSavedTeamBlueprint && selectedSavedTeamBlueprintMetadataDraft
    ? (
      selectedSavedTeamBlueprintMetadataDraft.slug !== selectedSavedTeamBlueprint.definition.slug
      || selectedSavedTeamBlueprintMetadataDraft.label !== selectedSavedTeamBlueprint.definition.label
      || selectedSavedTeamBlueprintMetadataDraft.description !== (selectedSavedTeamBlueprint.definition.description ?? "")
    )
    : false;
  const selectedSavedTeamBlueprintMetadataValid = selectedSavedTeamBlueprintMetadataDraft
    ? selectedSavedTeamBlueprintMetadataDraft.label.trim().length > 0
      && selectedSavedTeamBlueprintMetadataDraft.slug.trim().length > 0
    : false;
  const workflowTemplates = workflowTemplatesView?.templates ?? [];
  const companyWorkflowTemplates = workflowTemplatesView?.companyTemplates ?? [];
  const selectedWorkflowTemplate = selectedWorkflowTemplateId
    ? workflowTemplates.find((template) => template.id === selectedWorkflowTemplateId) ?? null
    : null;
  const workflowTemplateFieldsParse = useMemo(() => {
    try {
      const parsed = workflowTemplateFieldsText.trim().length > 0
        ? JSON.parse(workflowTemplateFieldsText) as unknown
        : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {
          fields: null,
          error: "Fields JSON must be an object of string values.",
        };
      }
      const invalidEntry = Object.entries(parsed).find(([, value]) => typeof value !== "string");
      if (invalidEntry) {
        return {
          fields: null,
          error: "Each workflow template field value must be a string.",
        };
      }
      return {
        fields: parsed as Record<string, string>,
        error: null,
      };
    } catch (error) {
      return {
        fields: null,
        error: error instanceof Error ? error.message : "Invalid JSON",
      };
    }
  }, [workflowTemplateFieldsText]);
  const workflowTemplateDirty = selectedWorkflowTemplate
    ? workflowTemplateLabel.trim() !== selectedWorkflowTemplate.label
      || workflowTemplateDescription.trim() !== (selectedWorkflowTemplate.description ?? "")
      || workflowTemplateSummary.trim() !== (selectedWorkflowTemplate.summary ?? "")
      || stringifyWorkflowTemplateFields(workflowTemplateFieldsParse.fields ?? {}) !== stringifyWorkflowTemplateFields(selectedWorkflowTemplate.fields)
    : false;
  const customRoleSlugValid = customRoleSlug.trim().length === 0 || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(customRoleSlug.trim());
  const customRoleValid = customRoleName.trim().length > 0 && customRoleSlugValid;

  async function invalidateTeamBuilderQueries(companyId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.setupProgress(companyId) }),
      queryClient.invalidateQueries({ queryKey: ["companies", companyId, "doctor"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.org(companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.orgSync(companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.knowledgeSetup(companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.rolePacks(companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.teamBlueprints(companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity(companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(companyId) }),
    ]);
  }

  function updateRolePackDraft(filename: RolePackFileName, content: string) {
    if (!selectedRolePackId) return;
    setRolePackDrafts((current) => ({
      ...current,
      [selectedRolePackId]: {
        ...(current[selectedRolePackId] ?? Object.fromEntries(ROLE_PACK_FILE_NAMES.map((name) => [name, ""]))),
        [filename]: content,
      } as Record<RolePackFileName, string>,
    }));
  }

  function resetRolePackDraftToLatest() {
    if (!selectedRolePack) return;
    setRolePackDrafts((current) => ({
      ...current,
      [selectedRolePack.id]: buildRolePackDraft(selectedRolePack),
    }));
    setRolePackRestoreSources((current) => ({
      ...current,
      [selectedRolePack.id]: null,
    }));
    setRolePackRevisionMessage("");
  }

  function updateAlertDestination(id: string, patch: Partial<OperatingAlertDestinationConfig>) {
    setAlertDestinations((current) =>
      current.map((destination) =>
        destination.id === id
          ? {
              ...destination,
              ...patch,
            }
          : destination),
    );
  }

  function resetWorkflowTemplateEditor(template: WorkflowTemplate) {
    setSelectedWorkflowTemplateId(template.id);
    setWorkflowTemplateLabel(template.label);
    setWorkflowTemplateDescription(template.description ?? "");
    setWorkflowTemplateSummary(template.summary ?? "");
    setWorkflowTemplateFieldsText(stringifyWorkflowTemplateFields(template.fields));
    setNewWorkflowTemplateAction(template.actionType);
  }

  function handleApplyTeamBlueprint() {
    if (!selectedTeamBlueprintPreview || teamBlueprintApplyMutation.isPending) return;
    const confirmed = window.confirm(
      `Apply ${selectedTeamBlueprintPreview.blueprint.label}?\n\n` +
        `Projects: ${selectedTeamBlueprintPreview.summary.adoptedProjectCount} adopt / ${selectedTeamBlueprintPreview.summary.createProjectCount} create\n` +
        `Roles: ${selectedTeamBlueprintPreview.summary.matchedRoleCount} matched / ${selectedTeamBlueprintPreview.summary.missingRoleCount} missing\n\n` +
        "This will provision projects, agents, reporting lines, and setup metadata for the current company.",
    );
    if (!confirmed) return;
    teamBlueprintApplyMutation.mutate({
      companyId: selectedCompanyId!,
      preview: selectedTeamBlueprintPreview,
    });
  }

  function handleExportTeamBlueprint() {
    if (!selectedCompanyId || !selectedTeamBlueprint || teamBlueprintExportMutation.isPending) return;
    teamBlueprintExportMutation.mutate({
      companyId: selectedCompanyId,
      blueprintKey: selectedTeamBlueprint.key,
    });
  }

  function handleUpdateSelectedTeamBlueprintLibraryDraft(
    patch: Partial<{ slug: string; label: string; description: string; versionNote: string }>,
  ) {
    if (!selectedTeamBlueprint) return;
    setTeamBlueprintLibraryDrafts((current) => ({
      ...current,
      [selectedTeamBlueprint.key]: {
        slug: current[selectedTeamBlueprint.key]?.slug ?? selectedTeamBlueprint.key,
        label: current[selectedTeamBlueprint.key]?.label ?? selectedTeamBlueprint.label,
        description: current[selectedTeamBlueprint.key]?.description ?? selectedTeamBlueprint.description,
        versionNote: current[selectedTeamBlueprint.key]?.versionNote ?? "",
        ...patch,
      },
    }));
  }

  function handleSaveSelectedTeamBlueprintToLibrary() {
    if (
      !selectedCompanyId
      || !selectedTeamBlueprint
      || !selectedTeamBlueprintPreview
      || !selectedTeamBlueprintLibraryDraft
      || teamBlueprintSaveMutation.isPending
    ) {
      return;
    }
    teamBlueprintSaveMutation.mutate({
      companyId: selectedCompanyId,
      blueprintKey: selectedTeamBlueprint.key,
      preview: selectedTeamBlueprintPreview,
      slug: selectedTeamBlueprintLibraryDraft.slug.trim(),
      label: selectedTeamBlueprintLibraryDraft.label.trim(),
      description: selectedTeamBlueprintLibraryDraft.description.trim() || null,
      versionNote: selectedTeamBlueprintLibraryDraft.versionNote.trim() || null,
    });
  }

  function handleUpdateSelectedTeamBlueprintRequest(next: TeamBlueprintPreviewRequest) {
    if (!selectedTeamBlueprint) return;
    setTeamBlueprintPreviewRequests((current) => ({
      ...current,
      [selectedTeamBlueprint.key]: next,
    }));
    setTeamBlueprintPreview(null);
    setTeamBlueprintApplyResult(null);
    setConfirmTeamBlueprintApply(false);
  }

  function handleUpdateSelectedSavedTeamBlueprintRequest(next: TeamBlueprintPreviewRequest) {
    if (!selectedSavedTeamBlueprint) return;
    setSavedTeamBlueprintPreviewRequests((current) => ({
      ...current,
      [selectedSavedTeamBlueprint.id]: next,
    }));
    setSavedTeamBlueprintPreviewState(null);
    setSavedTeamBlueprintApplyResult(null);
    setConfirmSavedTeamBlueprintApply(false);
  }

  function handleUpdateSelectedSavedTeamBlueprintVersionDraft(
    patch: Partial<{ slug: string; label: string; description: string; versionNote: string }>,
  ) {
    if (!selectedSavedTeamBlueprint || !selectedSavedTeamBlueprintVersionInfo) return;
    setSavedTeamBlueprintVersionDrafts((current) => ({
      ...current,
      [selectedSavedTeamBlueprint.id]: {
        slug: current[selectedSavedTeamBlueprint.id]?.slug
          ?? buildNextSavedTeamBlueprintVersionSlug(
            selectedSavedTeamBlueprint.definition.slug,
            selectedSavedTeamBlueprintVersionInfo.version + 1,
          ),
        label: current[selectedSavedTeamBlueprint.id]?.label
          ?? buildNextSavedTeamBlueprintVersionLabel(
            selectedSavedTeamBlueprint.definition.label,
            selectedSavedTeamBlueprintVersionInfo.version + 1,
          ),
        description: current[selectedSavedTeamBlueprint.id]?.description
          ?? (selectedSavedTeamBlueprint.definition.description ?? ""),
        versionNote: current[selectedSavedTeamBlueprint.id]?.versionNote ?? "",
        ...patch,
      },
    }));
  }

  function handleUpdateSelectedSavedTeamBlueprintMetadata(
    patch: Partial<{ slug: string; label: string; description: string }>,
  ) {
    if (!selectedSavedTeamBlueprint) return;
    setSavedTeamBlueprintMetadataDrafts((current) => ({
      ...current,
      [selectedSavedTeamBlueprint.id]: {
        slug: current[selectedSavedTeamBlueprint.id]?.slug ?? selectedSavedTeamBlueprint.definition.slug,
        label: current[selectedSavedTeamBlueprint.id]?.label ?? selectedSavedTeamBlueprint.definition.label,
        description: current[selectedSavedTeamBlueprint.id]?.description ?? (selectedSavedTeamBlueprint.definition.description ?? ""),
        ...patch,
      },
    }));
  }

  function handleApplySavedTeamBlueprint() {
    if (
      !selectedCompanyId
      || !selectedSavedTeamBlueprint
      || !selectedSavedTeamBlueprintPreview
      || savedTeamBlueprintApplyMutation.isPending
    ) {
      return;
    }
    const confirmed = window.confirm(
      `Apply saved blueprint ${selectedSavedTeamBlueprint.definition.label}?\n\n` +
        `Projects: ${selectedSavedTeamBlueprintPreview.summary.adoptedProjectCount} adopt / ${selectedSavedTeamBlueprintPreview.summary.createProjectCount} create\n` +
        `Roles: ${selectedSavedTeamBlueprintPreview.summary.matchedRoleCount} matched / ${selectedSavedTeamBlueprintPreview.summary.missingRoleCount} missing\n\n` +
        "This will provision projects, agents, reporting lines, and setup metadata for the current company.",
    );
    if (!confirmed) return;
    savedTeamBlueprintApplyMutation.mutate({
      companyId: selectedCompanyId,
      savedBlueprintId: selectedSavedTeamBlueprint.id,
      preview: selectedSavedTeamBlueprintPreview,
    });
  }

  function handleExportSelectedSavedTeamBlueprint() {
    if (!selectedCompanyId || !selectedSavedTeamBlueprint || savedTeamBlueprintExportMutation.isPending) return;
    savedTeamBlueprintExportMutation.mutate({
      companyId: selectedCompanyId,
      savedBlueprintId: selectedSavedTeamBlueprint.id,
    });
  }

  function handleSaveSelectedSavedTeamBlueprintMetadata() {
    if (
      !selectedCompanyId
      || !selectedSavedTeamBlueprint
      || !selectedSavedTeamBlueprintMetadataDraft
      || savedTeamBlueprintUpdateMutation.isPending
    ) {
      return;
    }
    savedTeamBlueprintUpdateMutation.mutate({
      companyId: selectedCompanyId,
      savedBlueprintId: selectedSavedTeamBlueprint.id,
      slug: selectedSavedTeamBlueprintMetadataDraft.slug.trim(),
      label: selectedSavedTeamBlueprintMetadataDraft.label.trim(),
      description: selectedSavedTeamBlueprintMetadataDraft.description.trim() || null,
    });
  }

  function handleCreateSavedTeamBlueprintVersion() {
    if (
      !selectedCompanyId
      || !selectedSavedTeamBlueprint
      || !selectedSavedTeamBlueprintPreview
      || !selectedSavedTeamBlueprintVersionDraft
      || savedTeamBlueprintCreateVersionMutation.isPending
    ) {
      return;
    }
    savedTeamBlueprintCreateVersionMutation.mutate({
      companyId: selectedCompanyId,
      savedBlueprintId: selectedSavedTeamBlueprint.id,
      preview: selectedSavedTeamBlueprintPreview,
      slug: selectedSavedTeamBlueprintVersionDraft.slug.trim() || null,
      label: selectedSavedTeamBlueprintVersionDraft.label.trim() || null,
      description: selectedSavedTeamBlueprintVersionDraft.description.trim() || null,
      versionNote: selectedSavedTeamBlueprintVersionDraft.versionNote.trim() || null,
    });
  }

  function handleDeleteSelectedSavedTeamBlueprint() {
    if (
      !selectedCompanyId
      || !selectedSavedTeamBlueprint
      || savedTeamBlueprintDeleteMutation.isPending
      || !canDeleteSelectedSavedTeamBlueprint
    ) {
      return;
    }
    const confirmed = window.confirm(
      `Delete saved blueprint ${selectedSavedTeamBlueprint.definition.label}?\n\n` +
      "This removes the library entry from the current company. Existing projects and agents remain unchanged.",
    );
    if (!confirmed) return;
    savedTeamBlueprintDeleteMutation.mutate({
      companyId: selectedCompanyId,
      savedBlueprintId: selectedSavedTeamBlueprint.id,
    });
  }

  function handlePublishSelectedSavedTeamBlueprint() {
    if (!selectedCompanyId || !selectedSavedTeamBlueprint || savedTeamBlueprintPublishMutation.isPending) return;
    const confirmed = window.confirm(
      `Publish saved blueprint ${selectedSavedTeamBlueprint.definition.label}?\n\n` +
      "This promotes the selected version as the published lineage entry for this company library.",
    );
    if (!confirmed) return;
    savedTeamBlueprintPublishMutation.mutate({
      companyId: selectedCompanyId,
      savedBlueprintId: selectedSavedTeamBlueprint.id,
    });
  }

  function handlePreviewImportedTeamBlueprint() {
    if (!selectedCompanyId || !teamBlueprintImportBundleParse.bundle || teamBlueprintImportPreviewMutation.isPending) return;
    teamBlueprintImportPreviewMutation.mutate({
      companyId: selectedCompanyId,
      bundle: teamBlueprintImportBundleParse.bundle,
      slug: teamBlueprintImportSlug.trim() || null,
      label: teamBlueprintImportLabel.trim() || null,
      collisionStrategy: teamBlueprintImportCollisionStrategy,
    });
  }

  function handleSaveImportedTeamBlueprint() {
    if (
      !selectedCompanyId
      || !teamBlueprintImportBundleParse.bundle
      || !teamBlueprintImportPreview
      || teamBlueprintImportPreview.errors.length > 0
      || teamBlueprintImportMutation.isPending
    ) {
      return;
    }
    teamBlueprintImportMutation.mutate({
      companyId: selectedCompanyId,
      bundle: teamBlueprintImportBundleParse.bundle,
      slug: teamBlueprintImportSlug.trim() || null,
      label: teamBlueprintImportLabel.trim() || null,
      collisionStrategy: teamBlueprintImportCollisionStrategy,
      previewHash: teamBlueprintImportPreview.previewHash,
    });
  }

  function renderTeamBuilderSection() {
    return (
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Team Builder
        </div>
        <div className="space-y-4 rounded-md border border-border px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-semibold">Reusable delivery team starting points</div>
              <p className="text-xs text-muted-foreground">
                Start here: pick the team shape, review the diff, and apply it before runtime setup or role-pack tuning.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedTeamBlueprint || teamBlueprintPreviewMutation.isPending || teamBlueprintApplyMutation.isPending}
              onClick={() => {
                if (!selectedTeamBlueprint || !selectedCompanyId) return;
                teamBlueprintPreviewMutation.mutate({
                  companyId: selectedCompanyId,
                  blueprintKey: selectedTeamBlueprint.key,
                  request: selectedTeamBlueprintRequest,
                });
              }}
            >
              {teamBlueprintPreviewMutation.isPending
                ? "Generating preview..."
                : "Preview team plan"}
            </Button>
          </div>

          {selectedMigrationHelpers.length > 0 && (
            <div className="space-y-3">
              {selectedMigrationHelpers.map((helper) => (
                <div key={helper.key} className="rounded-md border border-sky-300 bg-sky-50 px-3 py-3">
                  <div className="text-sm font-semibold text-sky-900">{helper.label}</div>
                  <p className="mt-1 text-xs text-sky-800">
                    {helper.description}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-sky-800">
                    {helper.projectMappings.map((mapping) => (
                      <li key={`${helper.key}:${mapping.canonicalProjectSlug}`}>
                        • {mapping.canonicalProjectName} → {mapping.blueprintSlotKey}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 text-xs text-sky-800">
                    Generic preview/apply remains the default path. Use this mapping only as migration guidance.
                  </div>
                </div>
              ))}
            </div>
          )}

          {teamBlueprints.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
              Team blueprint catalog is not available yet.
            </div>
          ) : (
            <>
              <div className="grid gap-3 lg:grid-cols-3">
                {teamBlueprints.map((blueprint) => {
                  const active = blueprint.key === selectedTeamBlueprint?.key;
                  return (
                    <button
                      key={blueprint.key}
                      type="button"
                      onClick={() => setSelectedTeamBlueprintKey(blueprint.key)}
                      className={`rounded-md border px-4 py-3 text-left transition ${active ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold">{blueprint.label}</div>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                          {blueprint.projects.length} project template(s)
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{blueprint.description}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full border border-border px-2 py-0.5">
                          {blueprint.portability.workspaceModel === "per_project" ? "per-project workspaces" : "single workspace"}
                        </span>
                        <span className="rounded-full border border-border px-2 py-0.5">
                          {blueprint.portability.knowledgeModel} knowledge
                        </span>
                        <span className="rounded-full border border-border px-2 py-0.5">
                          default {blueprint.parameterHints.defaultProjectCount} project(s)
                        </span>
                        <span className="rounded-full border border-border px-2 py-0.5">
                          {blueprint.roles.length} role template(s)
                        </span>
                        {migrationHelpers.some((helper) => helper.blueprintKey === blueprint.key) && (
                          <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-sky-800">
                            migration helper
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedTeamBlueprint && (
                <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-3 rounded-md border border-border px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{selectedTeamBlueprint.label}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{selectedTeamBlueprint.description}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={teamBlueprintExportMutation.isPending}
                      onClick={handleExportTeamBlueprint}
                    >
                      {teamBlueprintExportMutation.isPending ? "Exporting..." : "Export JSON"}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full border border-border px-2 py-0.5">
                      {selectedTeamBlueprint.portability.companyAgnostic ? "company-agnostic" : "company-bound"}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5">
                      {selectedTeamBlueprint.portability.workspaceModel === "per_project" ? "per-project workspaces" : "single workspace"}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5">
                      {selectedTeamBlueprint.portability.knowledgeModel} knowledge
                    </span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                      {selectedTeamBlueprint.projects.map((project) => (
                        <div key={project.key} className="rounded-md border border-border px-3 py-3 text-sm">
                          <div className="font-medium">{project.label}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{project.description}</div>
                          <div className="mt-2 text-[11px] text-muted-foreground">
                            Kind: {project.kind} {project.repositoryHint ? `· ${project.repositoryHint}` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  <div className="rounded-md border border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                      Recommended first quick request: {selectedTeamBlueprint.readiness.recommendedFirstQuickRequest}
                    </div>
                  </div>

                  <TeamBlueprintParameterEditor
                    blueprint={selectedTeamBlueprint}
                    value={selectedTeamBlueprintRequest}
                    onChange={handleUpdateSelectedTeamBlueprintRequest}
                    disabled={teamBlueprintPreviewMutation.isPending || teamBlueprintApplyMutation.isPending}
                    description="Adjust the reusable team shape before generating the preview diff or applying it."
                  />

                  <div className="space-y-3 rounded-md border border-border px-4 py-4">
                    <div className="text-sm font-semibold">Readiness expectations</div>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <div>
                        Required workspaces: <span className="font-medium text-foreground">{selectedTeamBlueprint.readiness.requiredWorkspaceCount}</span>
                      </div>
                      <div>
                        Knowledge sources: <span className="font-medium text-foreground">{selectedTeamBlueprint.readiness.knowledgeSources.join(", ")}</span>
                      </div>
                      <div>
                        Approval roles: <span className="font-medium text-foreground">{selectedTeamBlueprint.readiness.approvalRequiredRoleKeys.join(", ")}</span>
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Setup prerequisites</div>
                      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                        {selectedTeamBlueprint.readiness.doctorSetupPrerequisites.map((step) => (
                          <li key={step}>• {step}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {selectedTeamBlueprintPreview && (
                <div className="space-y-4 rounded-md border border-border px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">Preview diff</div>
                      <p className="text-xs text-muted-foreground">
                        Review the diff, confirm it, then apply the team shape to this company.
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Projects {selectedTeamBlueprintPreview.summary.adoptedProjectCount} adopt / {selectedTeamBlueprintPreview.summary.createProjectCount} create
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Parameter diff vs blueprint defaults</div>
                    {selectedTeamBlueprintParameterChanges.length === 0 ? (
                      <div className="mt-2 text-sm text-muted-foreground">This preview is using the blueprint defaults.</div>
                    ) : (
                      <ul className="mt-2 space-y-1 text-sm text-foreground">
                        {selectedTeamBlueprintParameterChanges.map((change) => (
                          <li key={change.key}>
                            {change.label}: <span className="text-muted-foreground">{change.before}</span> → {change.after}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-md border border-border px-3 py-3 text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Current state</div>
                      <div className="mt-2 font-medium text-foreground">
                        {selectedTeamBlueprintPreview.summary.currentProjectCount} project(s) / {selectedTeamBlueprintPreview.summary.currentWorkspaceCount} workspace(s)
                      </div>
                    </div>
                    <div className="rounded-md border border-border px-3 py-3 text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Role coverage</div>
                      <div className="mt-2 font-medium text-foreground">
                        {selectedTeamBlueprintPreview.summary.matchedRoleCount} matched / {selectedTeamBlueprintPreview.summary.missingRoleCount} missing
                      </div>
                    </div>
                    <div className="rounded-md border border-border px-3 py-3 text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Preview parameters</div>
                      <div className="mt-2 font-medium text-foreground">
                        {selectedTeamBlueprintPreview.parameters.projectCount} project slot(s), {selectedTeamBlueprintPreview.parameters.engineerPairsPerProject} engineer pair(s)
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <div className="text-sm font-semibold">Project diff</div>
                      {selectedTeamBlueprintPreview.projectDiff.map((project) => (
                        <div key={project.slotKey} className="rounded-md border border-border px-3 py-3 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium">{project.label}</div>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${project.status === "adopt_existing" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}`}>
                              {project.status === "adopt_existing" ? "Adopt existing" : "Create new"}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {project.existingProjectName
                              ? `${project.existingProjectName} · ${project.workspaceCount} workspace(s)`
                              : project.repositoryHint ?? "New project slot"}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm font-semibold">Role coverage</div>
                      {selectedTeamBlueprintPreview.roleDiff.map((role) => (
                        <div key={role.templateKey} className="rounded-md border border-border px-3 py-3 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium">{role.label}</div>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${blueprintStatusTone(role.status)}`}>
                              {role.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {role.existingCount}/{role.requiredCount} matched
                            {role.matchingAgentNames.length > 0 ? ` · ${role.matchingAgentNames.join(", ")}` : ""}
                          </div>
                          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                            {role.notes.map((note) => (
                              <li key={note}>• {note}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold">Readiness checks</div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {selectedTeamBlueprintPreview.readinessChecks.map((check) => (
                        <div
                          key={check.key}
                          className={`rounded-md border px-3 py-3 text-sm ${blueprintStatusTone(check.status)}`}
                        >
                          <div className="font-medium">{check.label}</div>
                          <div className="mt-1 text-xs">{check.detail}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {selectedTeamBlueprintPreview.warnings.length > 0 && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3">
                      <div className="text-sm font-semibold text-amber-800">Preview warnings</div>
                      <ul className="mt-2 space-y-1 text-xs text-amber-700">
                        {selectedTeamBlueprintPreview.warnings.map((warning) => (
                          <li key={warning}>• {warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selectedTeamBlueprintLibraryDraft && (
                    <div className="space-y-3 rounded-md border border-border bg-background px-3 py-3">
                      <div>
                        <div className="text-sm font-semibold">Save preview to company library</div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Turn this tuned built-in blueprint into a company-local reusable entry without round-tripping through JSON export/import.
                        </p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Library label" hint="Operator-facing label for the saved company-local blueprint.">
                          <input
                            value={selectedTeamBlueprintLibraryDraft.label}
                            onChange={(event) => handleUpdateSelectedTeamBlueprintLibraryDraft({ label: event.target.value })}
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                          />
                        </Field>
                        <Field label="Slug" hint="Stable company-scoped slug for this saved blueprint.">
                          <input
                            value={selectedTeamBlueprintLibraryDraft.slug}
                            onChange={(event) => handleUpdateSelectedTeamBlueprintLibraryDraft({ slug: event.target.value })}
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                          />
                        </Field>
                      </div>
                      <Field label="Description" hint="Optional company-local note for when this saved blueprint should be reused.">
                        <textarea
                          rows={3}
                          value={selectedTeamBlueprintLibraryDraft.description}
                          onChange={(event) => handleUpdateSelectedTeamBlueprintLibraryDraft({ description: event.target.value })}
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                      </Field>
                      <Field label="Version note" hint="Optional note describing why these preview defaults should be captured in the company library.">
                        <input
                          value={selectedTeamBlueprintLibraryDraft.versionNote}
                          onChange={(event) => handleUpdateSelectedTeamBlueprintLibraryDraft({ versionNote: event.target.value })}
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                          placeholder="Initial company-local blueprint defaults"
                        />
                      </Field>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!selectedTeamBlueprintLibraryDraftValid || teamBlueprintSaveMutation.isPending}
                          onClick={handleSaveSelectedTeamBlueprintToLibrary}
                        >
                          {teamBlueprintSaveMutation.isPending ? "Saving to library..." : "Save to library"}
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          Saves the current preview parameters as the default library baseline.
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
                    <label className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={confirmTeamBlueprintApply}
                        onChange={(event) => setConfirmTeamBlueprintApply(event.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-border"
                      />
                      <span>
                        I reviewed this preview diff and want to apply the current team blueprint to this company.
                      </span>
                    </label>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        onClick={handleApplyTeamBlueprint}
                        disabled={!confirmTeamBlueprintApply || teamBlueprintApplyMutation.isPending}
                      >
                        {teamBlueprintApplyMutation.isPending ? "Applying blueprint..." : "Apply team blueprint"}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Apply uses the current preview hash and will be rejected if company state drifts first.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {teamBlueprintApplyResult && selectedTeamBlueprint && teamBlueprintApplyResult.blueprintKey === selectedTeamBlueprint.key && (
                <div className="space-y-3 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-emerald-900">Blueprint applied</div>
                      <p className="text-xs text-emerald-800">
                        Preview hash {teamBlueprintApplyResult.previewHash.slice(0, 12)}... applied successfully.
                      </p>
                    </div>
                    <span className="rounded-full border border-emerald-300 px-2 py-0.5 text-[11px] text-emerald-800">
                      {teamBlueprintApplyResult.blueprintKey}
                    </span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-3">
                    <div className="rounded-md border border-emerald-200 bg-white/70 px-3 py-3 text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Projects</div>
                      <div className="mt-1 font-medium text-foreground">
                        {teamBlueprintApplyResult.summary.adoptedProjectCount} adopt / {teamBlueprintApplyResult.summary.createdProjectCount} create
                      </div>
                    </div>
                    <div className="rounded-md border border-emerald-200 bg-white/70 px-3 py-3 text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Agents</div>
                      <div className="mt-1 font-medium text-foreground">
                        {teamBlueprintApplyResult.summary.adoptedAgentCount} adopt / {teamBlueprintApplyResult.summary.createdAgentCount} create / {teamBlueprintApplyResult.summary.updatedAgentCount} update
                      </div>
                    </div>
                    <div className="rounded-md border border-emerald-200 bg-white/70 px-3 py-3 text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Role packs</div>
                      <div className="mt-1 font-medium text-foreground">
                        {teamBlueprintApplyResult.summary.seededRolePackCount} seeded / {teamBlueprintApplyResult.summary.existingRolePackCount} existing
                      </div>
                    </div>
                  </div>
                  {teamBlueprintApplyResult.warnings.length > 0 && (
                    <ul className="space-y-1 text-xs text-emerald-900">
                      {teamBlueprintApplyResult.warnings.map((warning) => (
                        <li key={warning}>• {warning}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-3 rounded-md border border-border px-4 py-4">
                  <div>
                    <div className="text-sm font-semibold">Import blueprint bundle</div>
                    <p className="text-xs text-muted-foreground">
                      Paste an exported blueprint JSON, preview the company diff, then save it into this company&apos;s blueprint library.
                    </p>
                  </div>

                  <Field
                    label="Bundle JSON"
                    hint="Use the JSON produced by Export JSON. Import only saves a company-scoped blueprint definition after preview."
                  >
                    <textarea
                      className="min-h-[180px] w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono"
                      value={teamBlueprintImportText}
                      onChange={(event) => setTeamBlueprintImportText(event.target.value)}
                      placeholder='{"schemaVersion":1,"source":{...},"definition":{...}}'
                    />
                  </Field>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Slug override" hint="Optional company-scoped slug. Leave empty to reuse the bundle slug.">
                      <input
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        value={teamBlueprintImportSlug}
                        onChange={(event) => setTeamBlueprintImportSlug(event.target.value)}
                        placeholder="product-squad-v2"
                      />
                    </Field>
                    <Field label="Label override" hint="Optional label shown in this company&apos;s blueprint library.">
                      <input
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        value={teamBlueprintImportLabel}
                        onChange={(event) => setTeamBlueprintImportLabel(event.target.value)}
                        placeholder="Product Squad v2"
                      />
                    </Field>
                  </div>

                  <Field
                    label="Collision strategy"
                    hint="Rename keeps the existing library entry. Replace only works for draft imported entries; published, superseded, and versioned entries must be saved as a new library entry."
                  >
                    <select
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      value={teamBlueprintImportCollisionStrategy}
                      onChange={(event) => setTeamBlueprintImportCollisionStrategy(event.target.value as "rename" | "replace")}
                    >
                      <option value="rename">rename</option>
                      <option value="replace">replace</option>
                    </select>
                  </Field>

                  {teamBlueprintImportBundleParse.error && (
                    <div className="rounded-md border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-700">
                      Invalid bundle JSON: {teamBlueprintImportBundleParse.error}
                    </div>
                  )}

                  {teamBlueprintImportPreview && (
                    <div className="space-y-3 rounded-md border border-border bg-muted/20 px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold">Import preview</div>
                          <div className="text-xs text-muted-foreground">
                            {teamBlueprintImportPreview.definition.label} · slug {teamBlueprintImportPreview.definition.slug}
                          </div>
                        </div>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                          {teamBlueprintImportPreview.saveAction === "replace" ? "replace existing" : "create new"}
                        </span>
                      </div>
                      <div className="grid gap-2 md:grid-cols-3">
                        <div className="rounded-md border border-border bg-background px-3 py-3 text-sm">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">Projects</div>
                          <div className="mt-1 font-medium">
                            {teamBlueprintImportPreview.preview.summary.adoptedProjectCount} adopt / {teamBlueprintImportPreview.preview.summary.createProjectCount} create
                          </div>
                        </div>
                        <div className="rounded-md border border-border bg-background px-3 py-3 text-sm">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">Roles</div>
                          <div className="mt-1 font-medium">
                            {teamBlueprintImportPreview.preview.summary.matchedRoleCount} matched / {teamBlueprintImportPreview.preview.summary.missingRoleCount} missing
                          </div>
                        </div>
                        <div className="rounded-md border border-border bg-background px-3 py-3 text-sm">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">Preview hash</div>
                          <div className="mt-1 font-medium">{teamBlueprintImportPreview.previewHash.slice(0, 12)}...</div>
                        </div>
                      </div>
                      {teamBlueprintImportPreview.warnings.length > 0 && (
                        <ul className="space-y-1 text-xs text-amber-700">
                          {teamBlueprintImportPreview.warnings.map((warning) => (
                            <li key={warning}>• {warning}</li>
                          ))}
                        </ul>
                      )}
                      {teamBlueprintImportPreview.errors.length > 0 && (
                        <ul className="space-y-1 text-xs text-red-700">
                          {teamBlueprintImportPreview.errors.map((error) => (
                            <li key={error}>• {error}</li>
                          ))}
                        </ul>
                      )}
                      <label className="flex items-start gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={confirmTeamBlueprintImport}
                          onChange={(event) => setConfirmTeamBlueprintImport(event.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-border"
                        />
                        <span>I reviewed the import preview and want to save this blueprint into the company library.</span>
                      </label>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!teamBlueprintImportBundleParse.bundle || teamBlueprintImportPreviewMutation.isPending || Boolean(teamBlueprintImportBundleParse.error)}
                      onClick={handlePreviewImportedTeamBlueprint}
                    >
                      {teamBlueprintImportPreviewMutation.isPending ? "Previewing import..." : "Preview import"}
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        !teamBlueprintImportPreview
                        || teamBlueprintImportPreview.errors.length > 0
                        || !confirmTeamBlueprintImport
                        || teamBlueprintImportMutation.isPending
                      }
                      onClick={handleSaveImportedTeamBlueprint}
                    >
                      {teamBlueprintImportMutation.isPending ? "Saving blueprint..." : "Save to library"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3 rounded-md border border-border px-4 py-4">
                  <div>
                    <div className="text-sm font-semibold">Saved blueprint library</div>
                    <p className="text-xs text-muted-foreground">
                      Company-scoped blueprint definitions imported from reusable bundles. Preview uses the same generic diff path as built-in blueprints.
                    </p>
                  </div>

                  {savedTeamBlueprints.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                      No saved blueprints yet. Export a built-in blueprint or import one from another company first.
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {savedTeamBlueprints.map((savedBlueprint) => {
                          const active = savedBlueprint.id === selectedSavedTeamBlueprint?.id;
                          return (
                            <button
                              key={savedBlueprint.id}
                              type="button"
                              onClick={() => setSelectedSavedTeamBlueprintId(savedBlueprint.id)}
                              className={`w-full rounded-md border px-3 py-3 text-left transition ${active ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40 hover:bg-muted/20"}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-sm font-semibold">{savedBlueprint.definition.label}</div>
                                <div className="flex flex-wrap items-center justify-end gap-1">
                                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                                    {savedBlueprint.definition.slug}
                                  </span>
                                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                                    v{resolveSavedTeamBlueprintVersionInfo(savedBlueprint).version}
                                  </span>
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[11px] ${savedBlueprintLifecycleTone(resolveSavedTeamBlueprintLifecycleState(savedBlueprint))}`}
                                  >
                                    {formatSavedBlueprintLifecycleLabel(resolveSavedTeamBlueprintLifecycleState(savedBlueprint))}
                                  </span>
                                </div>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {savedBlueprint.definition.portability.workspaceModel} · {savedBlueprint.definition.portability.knowledgeModel} knowledge
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {selectedSavedTeamBlueprint && (
                        <div className="space-y-3 rounded-md border border-border bg-muted/20 px-3 py-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold">{selectedSavedTeamBlueprint.definition.label}</div>
                              {selectedSavedTeamBlueprintVersionInfo && (
                                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                                  v{selectedSavedTeamBlueprintVersionInfo.version}
                                </span>
                              )}
                              {selectedSavedTeamBlueprintLifecycleState && (
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[11px] ${savedBlueprintLifecycleTone(selectedSavedTeamBlueprintLifecycleState)}`}
                                >
                                  {formatSavedBlueprintLifecycleLabel(selectedSavedTeamBlueprintLifecycleState)}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Source: {selectedSavedTeamBlueprint.sourceMetadata.type} · {selectedSavedTeamBlueprint.sourceMetadata.companyName ?? "unknown company"}
                            </div>
                            {selectedSavedTeamBlueprintVersionInfo?.versionNote && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                Version note: {selectedSavedTeamBlueprintVersionInfo.versionNote}
                              </div>
                            )}
                            {selectedSavedTeamBlueprint.sourceMetadata.publishedAt && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                Published: {new Date(selectedSavedTeamBlueprint.sourceMetadata.publishedAt).toLocaleString()}
                              </div>
                            )}
                          </div>
                          {selectedSavedTeamBlueprintLineage.length > 1 && (
                            <div className="rounded-md border border-border bg-background px-3 py-3">
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Version history</div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {selectedSavedTeamBlueprintLineage.map((entry) => {
                                  const versionInfo = resolveSavedTeamBlueprintVersionInfo(entry);
                                  return (
                                    <button
                                      key={entry.id}
                                      type="button"
                                      onClick={() => setSelectedSavedTeamBlueprintId(entry.id)}
                                      className={`rounded-full border px-2 py-1 text-[11px] ${entry.id === selectedSavedTeamBlueprint.id ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}
                                    >
                                      v{versionInfo.version} · {entry.definition.label} · {formatSavedBlueprintLifecycleLabel(resolveSavedTeamBlueprintLifecycleState(entry))}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {selectedSavedTeamBlueprintPreviousVersion && (
                            <div className="rounded-md border border-border bg-background px-3 py-3">
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Changes vs previous version
                              </div>
                              {selectedSavedTeamBlueprintVersionChanges.length === 0 ? (
                                <div className="mt-2 text-sm text-muted-foreground">
                                  No library metadata or default parameter changes compared to the previous saved version.
                                </div>
                              ) : (
                                <ul className="mt-2 space-y-1 text-sm text-foreground">
                                  {selectedSavedTeamBlueprintVersionChanges.map((change) => (
                                    <li key={change.key}>
                                      {change.label}: <span className="text-muted-foreground">{change.before}</span> → {change.after}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                          <div className="grid gap-3 md:grid-cols-2">
                            <Field label="Library label" hint="Operator-facing label for this company-scoped blueprint entry.">
                              <input
                                value={selectedSavedTeamBlueprintMetadataDraft?.label ?? ""}
                                onChange={(event) => handleUpdateSelectedSavedTeamBlueprintMetadata({ label: event.target.value })}
                                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                              />
                            </Field>
                            <Field label="Slug" hint="Stable company library identifier used for rename/replace checks.">
                              <input
                                value={selectedSavedTeamBlueprintMetadataDraft?.slug ?? ""}
                                onChange={(event) => handleUpdateSelectedSavedTeamBlueprintMetadata({ slug: event.target.value })}
                                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                              />
                            </Field>
                          </div>
                          <Field label="Description" hint="Optional company-local note for when this saved blueprint should be reused.">
                            <textarea
                              rows={3}
                              value={selectedSavedTeamBlueprintMetadataDraft?.description ?? ""}
                              onChange={(event) => handleUpdateSelectedSavedTeamBlueprintMetadata({ description: event.target.value })}
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                            />
                          </Field>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!selectedSavedTeamBlueprintMetadataDirty || !selectedSavedTeamBlueprintMetadataValid || savedTeamBlueprintUpdateMutation.isPending}
                              onClick={handleSaveSelectedSavedTeamBlueprintMetadata}
                            >
                              {savedTeamBlueprintUpdateMutation.isPending ? "Saving metadata..." : "Save library details"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={savedTeamBlueprintPublishMutation.isPending}
                              onClick={handlePublishSelectedSavedTeamBlueprint}
                            >
                              {savedTeamBlueprintPublishMutation.isPending
                                ? "Publishing..."
                                : selectedSavedTeamBlueprintLifecycleState === "published"
                                  ? "Republish version"
                                  : "Publish version"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={savedTeamBlueprintExportMutation.isPending}
                              onClick={handleExportSelectedSavedTeamBlueprint}
                            >
                              {savedTeamBlueprintExportMutation.isPending ? "Exporting..." : "Re-export JSON"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canDeleteSelectedSavedTeamBlueprint || savedTeamBlueprintDeleteMutation.isPending}
                              onClick={handleDeleteSelectedSavedTeamBlueprint}
                            >
                              {savedTeamBlueprintDeleteMutation.isPending ? "Deleting..." : "Delete from library"}
                            </Button>
                          </div>
                          {selectedSavedTeamBlueprintDeleteRestriction && (
                            <div className="text-xs text-muted-foreground">
                              Delete locked: {selectedSavedTeamBlueprintDeleteRestriction}
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                savedTeamBlueprintPreviewMutation.isPending
                                || savedTeamBlueprintApplyMutation.isPending
                                || savedTeamBlueprintUpdateMutation.isPending
                                || savedTeamBlueprintDeleteMutation.isPending
                                || savedTeamBlueprintPublishMutation.isPending
                              }
                              onClick={() => {
                                if (!selectedCompanyId) return;
                                savedTeamBlueprintPreviewMutation.mutate({
                                  companyId: selectedCompanyId,
                                  savedBlueprintId: selectedSavedTeamBlueprint.id,
                                  request: selectedSavedTeamBlueprintRequest,
                                });
                              }}
                            >
                              {savedTeamBlueprintPreviewMutation.isPending ? "Previewing..." : "Preview saved blueprint"}
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              Saved blueprints now use the same generic preview/apply contract as built-in blueprints.
                            </span>
                          </div>

                          <TeamBlueprintParameterEditor
                            blueprint={selectedSavedTeamBlueprint.definition}
                            value={selectedSavedTeamBlueprintRequest}
                            defaultValue={selectedSavedTeamBlueprint.defaultPreviewRequest}
                            onChange={handleUpdateSelectedSavedTeamBlueprintRequest}
                            disabled={
                              savedTeamBlueprintPreviewMutation.isPending
                              || savedTeamBlueprintUpdateMutation.isPending
                              || savedTeamBlueprintDeleteMutation.isPending
                              || savedTeamBlueprintPublishMutation.isPending
                            }
                            title="Saved blueprint preview parameters"
                            description="Preview saved blueprint definitions with their stored default parameters, compare edited values, and apply the resulting team plan once the diff is reviewed."
                            compact
                          />

                          {selectedSavedTeamBlueprintPreview && (
                            <div className="space-y-3">
                              <div className="rounded-md border border-border bg-background px-3 py-3">
                                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Parameter diff vs blueprint defaults
                                </div>
                                {selectedSavedTeamBlueprintParameterChanges.length === 0 ? (
                                  <div className="mt-2 text-sm text-muted-foreground">
                                    This preview is using the saved blueprint defaults.
                                  </div>
                                ) : (
                                  <ul className="mt-2 space-y-1 text-sm text-foreground">
                                    {selectedSavedTeamBlueprintParameterChanges.map((change) => (
                                      <li key={change.key}>
                                        {change.label}: <span className="text-muted-foreground">{change.before}</span> → {change.after}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>

                              <div className="grid gap-2 md:grid-cols-3">
                                <div className="rounded-md border border-border bg-background px-3 py-3 text-sm">
                                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Projects</div>
                                  <div className="mt-1 font-medium">
                                    {selectedSavedTeamBlueprintPreview.summary.adoptedProjectCount} adopt / {selectedSavedTeamBlueprintPreview.summary.createProjectCount} create
                                  </div>
                                </div>
                                <div className="rounded-md border border-border bg-background px-3 py-3 text-sm">
                                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Roles</div>
                                  <div className="mt-1 font-medium">
                                    {selectedSavedTeamBlueprintPreview.summary.matchedRoleCount} matched / {selectedSavedTeamBlueprintPreview.summary.missingRoleCount} missing
                                  </div>
                                </div>
                                <div className="rounded-md border border-border bg-background px-3 py-3 text-sm">
                                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Warnings</div>
                                  <div className="mt-1 font-medium">
                                    {selectedSavedTeamBlueprintPreview.warnings.length}
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-md border border-border bg-background px-3 py-3">
                                <label className="flex items-start gap-2 text-sm text-foreground">
                                  <input
                                    type="checkbox"
                                    checked={confirmSavedTeamBlueprintApply}
                                    onChange={(event) => setConfirmSavedTeamBlueprintApply(event.target.checked)}
                                    className="mt-0.5 h-4 w-4 rounded border-border"
                                  />
                                  <span>I reviewed this saved blueprint preview diff and want to apply it to this company.</span>
                                </label>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <Button
                                    size="sm"
                                    disabled={!confirmSavedTeamBlueprintApply || savedTeamBlueprintApplyMutation.isPending}
                                    onClick={handleApplySavedTeamBlueprint}
                                  >
                                    {savedTeamBlueprintApplyMutation.isPending ? "Applying saved blueprint..." : "Apply saved blueprint"}
                                  </Button>
                                  {selectedSavedTeamBlueprintApplyResult && (
                                    <span className="text-xs text-muted-foreground">
                                      Applied preview hash {selectedSavedTeamBlueprintApplyResult.previewHash.slice(0, 12)}...
                                    </span>
                                  )}
                                </div>
                              </div>

                              {selectedSavedTeamBlueprintVersionDraft && selectedSavedTeamBlueprintVersionInfo && (
                                <div className="space-y-3 rounded-md border border-border bg-background px-3 py-3">
                                  <div>
                                    <div className="text-sm font-semibold">Save preview as next version</div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      Store the current saved blueprint preview as v{selectedSavedTeamBlueprintVersionInfo.version + 1} in this company library.
                                    </p>
                                  </div>
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <Field label="Next version label" hint="Operator-facing label for the next saved blueprint version.">
                                      <input
                                        value={selectedSavedTeamBlueprintVersionDraft.label}
                                        onChange={(event) => handleUpdateSelectedSavedTeamBlueprintVersionDraft({ label: event.target.value })}
                                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                                      />
                                    </Field>
                                    <Field label="Slug" hint="Stable company-scoped slug for the next saved version.">
                                      <input
                                        value={selectedSavedTeamBlueprintVersionDraft.slug}
                                        onChange={(event) => handleUpdateSelectedSavedTeamBlueprintVersionDraft({ slug: event.target.value })}
                                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                                      />
                                    </Field>
                                  </div>
                                  <Field label="Description" hint="Optional library description for the next saved version.">
                                    <textarea
                                      rows={3}
                                      value={selectedSavedTeamBlueprintVersionDraft.description}
                                      onChange={(event) => handleUpdateSelectedSavedTeamBlueprintVersionDraft({ description: event.target.value })}
                                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                                    />
                                  </Field>
                                  <Field label="Version note" hint="Short note explaining what changed in this saved blueprint version.">
                                    <input
                                      value={selectedSavedTeamBlueprintVersionDraft.versionNote}
                                      onChange={(event) => handleUpdateSelectedSavedTeamBlueprintVersionDraft({ versionNote: event.target.value })}
                                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                                      placeholder={`Why v${selectedSavedTeamBlueprintVersionInfo.version + 1} exists`}
                                    />
                                  </Field>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={!selectedSavedTeamBlueprintVersionDraftValid || savedTeamBlueprintCreateVersionMutation.isPending}
                                      onClick={handleCreateSavedTeamBlueprintVersion}
                                    >
                                      {savedTeamBlueprintCreateVersionMutation.isPending ? "Saving version..." : "Save as next version"}
                                    </Button>
                                    <span className="text-xs text-muted-foreground">
                                      Uses the current saved preview hash and edited parameter defaults.
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {teamBlueprintPreviewMutation.isError && !selectedTeamBlueprintPreview && (
                <div className="text-sm text-destructive">
                  {teamBlueprintPreviewMutation.error instanceof Error
                    ? teamBlueprintPreviewMutation.error.message
                    : "Failed to generate blueprint preview"}
                </div>
              )}
              {teamBlueprintImportPreviewMutation.isError && (
                <div className="text-sm text-destructive">
                  {teamBlueprintImportPreviewMutation.error instanceof Error
                    ? teamBlueprintImportPreviewMutation.error.message
                    : "Failed to preview imported blueprint"}
                </div>
              )}
              {savedTeamBlueprintPreviewMutation.isError && (
                <div className="text-sm text-destructive">
                  {savedTeamBlueprintPreviewMutation.error instanceof Error
                    ? savedTeamBlueprintPreviewMutation.error.message
                    : "Failed to preview saved blueprint"}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  function handleCreateWorkflowTemplate() {
    const template = createWorkflowTemplateDraft(newWorkflowTemplateAction);
    const nextCompanyTemplates = [...companyWorkflowTemplates, template];
    setSelectedWorkflowTemplateId(template.id);
    setWorkflowTemplateLabel(template.label);
    setWorkflowTemplateDescription(template.description ?? "");
    setWorkflowTemplateSummary(template.summary ?? "");
    setWorkflowTemplateFieldsText(stringifyWorkflowTemplateFields(template.fields));
    workflowTemplatesMutation.mutate(nextCompanyTemplates);
  }

  function handleSaveWorkflowTemplate() {
    if (!selectedWorkflowTemplate || !workflowTemplateFieldsParse.fields) return;
    const nextTemplate: WorkflowTemplate = {
      id: selectedWorkflowTemplate.scope === "company"
        ? selectedWorkflowTemplate.id
        : `company-${selectedWorkflowTemplate.actionType.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`,
      actionType: selectedWorkflowTemplate.actionType,
      label: workflowTemplateLabel.trim(),
      description: workflowTemplateDescription.trim() || null,
      summary: workflowTemplateSummary.trim() || null,
      fields: workflowTemplateFieldsParse.fields,
      scope: "company",
    };
    const withoutCurrent = companyWorkflowTemplates.filter((template) => template.id !== nextTemplate.id);
    const nextCompanyTemplates = [...withoutCurrent, nextTemplate];
    setSelectedWorkflowTemplateId(nextTemplate.id);
    workflowTemplatesMutation.mutate(nextCompanyTemplates);
  }

  function handleDeleteWorkflowTemplate() {
    if (!selectedWorkflowTemplate || selectedWorkflowTemplate.scope !== "company") return;
    const nextCompanyTemplates = companyWorkflowTemplates.filter((template) => template.id !== selectedWorkflowTemplate.id);
    setSelectedWorkflowTemplateId(nextCompanyTemplates[0]?.id ?? workflowTemplates.find((template) => template.scope === "default")?.id ?? null);
    workflowTemplatesMutation.mutate(nextCompanyTemplates);
  }

  return (
    <div className="max-w-5xl space-y-8">
      <HeroSection
        title="Company Settings"
        subtitle="Tune setup readiness, role packs, retrieval policy, and operating defaults without leaving the company workspace."
        eyebrow={selectedCompany.name}
        actions={
          <div className="flex items-center gap-3">
            <div className="rounded-[1rem] border border-border/80 bg-background/80 p-1.5">
              <CompanyPatternIcon
                companyName={companyName || selectedCompany.name}
                brandColor={brandColor || null}
                className="h-10 w-10 rounded-[0.9rem]"
              />
            </div>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SupportMetricCard
          icon={Settings}
          label="Setup progress"
          value={readinessTotalSteps > 0 ? `${readinessStepCount}/${readinessTotalSteps}` : "0/0"}
          detail="Completed setup checkpoints for this company workspace."
          tone="accent"
        />
        <SupportMetricCard
          icon={SearchCheck}
          label="Doctor failures"
          value={doctorFailCount}
          detail="Doctor checks currently failing in the latest visible report."
          tone={doctorFailCount > 0 ? "warning" : "default"}
        />
        <SupportMetricCard
          icon={Layers3}
          label="Role packs"
          value={rolePacks.length}
          detail="Configured role pack sets available for this company."
        />
        <SupportMetricCard
          icon={ShieldCheck}
          label="Retrieval policies"
          value={retrievalPolicies.length}
          detail="Knowledge retrieval rules currently scoped to this company."
        />
      </div>

      {/* General */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          General
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <Field label="Company name" hint="The display name for your company.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </Field>
          <Field label="Description" hint="Optional description shown in the company profile.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={description}
              placeholder="Optional company description"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Appearance */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Appearance
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <CompanyPatternIcon
                companyName={companyName || selectedCompany.name}
                brandColor={brandColor || null}
                className="rounded-[14px]"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Field label="Brand color" hint="Sets the hue for the company icon. Leave empty for auto-generated color.">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandColor || "#6366f1"}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={brandColor}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^#[0-9a-fA-F]{0,6}$/.test(v)) {
                        setBrandColor(v);
                      }
                    }}
                    placeholder="Auto"
                    className="w-28 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  />
                  {brandColor && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBrandColor("")}
                      className="text-xs text-muted-foreground"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Save button for General + Appearance */}
      {generalDirty && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveGeneral}
            disabled={generalMutation.isPending || !companyName.trim()}
          >
            {generalMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
          {generalMutation.isSuccess && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {generalMutation.isError && (
            <span className="text-xs text-destructive">
              {generalMutation.error instanceof Error
                ? generalMutation.error.message
                : "Failed to save"}
            </span>
          )}
        </div>
      )}

      {/* Hiring */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Hiring
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <ToggleField
            label="Require board approval for new hires"
            hint="New agent hires stay pending until approved by board."
            checked={!!selectedCompany.requireBoardApprovalForNewAgents}
            onChange={(v) => settingsMutation.mutate(v)}
          />
        </div>
      </div>

      {renderTeamBuilderSection()}

      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Setup Readiness
        </div>
        <div className="space-y-4 rounded-md border border-border px-4 py-4">
          <div className="grid gap-2 md:grid-cols-3">
            {setupProgress && Object.entries(setupProgress.steps).map(([key, done]) => (
              <div
                key={key}
                className={`rounded-md border px-3 py-2 text-xs ${done ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-border bg-muted/30 text-muted-foreground"}`}
              >
                <div className="font-medium">{formatSetupStepLabel(key)}</div>
                <div>{done ? "Ready" : "Pending"}</div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Execution engine" hint="Squadrail is being narrowed to Claude Code and Codex.">
              <select
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                value={setupEngine}
                onChange={(event) => setSetupEngine(event.target.value)}
              >
                <option value="">Select an engine</option>
                {ENGINE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Primary workspace" hint="Used by import, retrieval bootstrap, and doctor checks.">
              <select
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                value={setupWorkspaceId}
                onChange={(event) => setSetupWorkspaceId(event.target.value)}
              >
                <option value="">Select a workspace</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.projectName} / {workspace.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => setupMutation.mutate()}
              disabled={!setupDirty || setupMutation.isPending}
            >
              {setupMutation.isPending ? "Saving..." : "Save setup"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetchDoctor()}
              disabled={doctorFetching}
            >
              {doctorFetching ? "Refreshing..." : "Refresh doctor"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => deepDoctorMutation.mutate()}
              disabled={deepDoctorMutation.isPending || !setupEngine}
            >
              {deepDoctorMutation.isPending ? "Running deep check..." : "Run deep check"}
            </Button>
            {setupProgress && (
              <span className="text-xs text-muted-foreground">
                Current status: <span className="font-medium text-foreground">{setupProgress.status}</span>
              </span>
            )}
          </div>
          {setupMutation.isError && (
            <p className="text-sm text-destructive">
              {setupMutation.error instanceof Error ? setupMutation.error.message : "Failed to save setup"}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Doctor
        </div>
        <div className="space-y-4 rounded-md border border-border px-4 py-4">
          {(() => {
            const activeReport = deepDoctorReport ?? doctorReport;
            if (!activeReport) {
              return <div className="text-sm text-muted-foreground">Doctor report is not ready yet.</div>;
            }
            return (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className={`rounded-full border px-3 py-1 text-xs font-medium ${statusTone(activeReport.status)}`}>
                    {activeReport.status.toUpperCase()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    pass {activeReport.summary.pass} / warn {activeReport.summary.warn} / fail {activeReport.summary.fail}
                  </div>
                </div>
                <div className="grid gap-2">
                  {activeReport.checks.map((check) => (
                    <div key={`${check.category}-${check.code}`} className="rounded-md border border-border px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone(check.status)}`}>
                          {check.status}
                        </span>
                        <span className="text-sm font-medium">{check.label}</span>
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{check.category}</span>
                      </div>
                      <p className="mt-1 text-sm text-foreground">{check.message}</p>
                      {check.detail && <p className="mt-1 text-xs font-mono text-muted-foreground">{check.detail}</p>}
                      {check.hint && <p className="mt-1 text-xs text-muted-foreground">{check.hint}</p>}
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      </div>

      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Workflow Templates
        </div>
        <div className="space-y-4 rounded-md border border-border px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Board action templates</div>
              <p className="text-xs text-muted-foreground">
                Pre-fill board protocol actions with reusable summaries, fields, and close handoff defaults.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                value={newWorkflowTemplateAction}
                onChange={(event) => setNewWorkflowTemplateAction(event.target.value as WorkflowTemplateActionType)}
              >
                {WORKFLOW_TEMPLATE_ACTION_TYPES.map((actionType) => (
                  <option key={actionType} value={actionType}>
                    {formatWorkflowActionLabel(actionType)}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCreateWorkflowTemplate}
                disabled={workflowTemplatesMutation.isPending}
              >
                New company template
              </Button>
            </div>
          </div>

          {workflowTemplates.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
              Workflow templates are not available yet.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {workflowTemplates.map((template) => {
                  const active = template.id === selectedWorkflowTemplateId;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => resetWorkflowTemplateEditor(template)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-accent/50"}`}
                    >
                      {template.label}
                    </button>
                  );
                })}
              </div>

              {selectedWorkflowTemplate && (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Action type" hint="Board action this template applies to.">
                        <input
                          className="w-full rounded-md border border-border bg-muted/20 px-2.5 py-2 text-sm text-muted-foreground outline-none"
                          value={formatWorkflowActionLabel(selectedWorkflowTemplate.actionType)}
                          readOnly
                        />
                      </Field>
                      <Field label="Scope" hint="Default templates are read-only until copied into company scope.">
                        <input
                          className="w-full rounded-md border border-border bg-muted/20 px-2.5 py-2 text-sm text-muted-foreground outline-none"
                          value={selectedWorkflowTemplate.scope}
                          readOnly
                        />
                      </Field>
                    </div>
                    <Field label="Template label" hint="Displayed in Protocol Action Console and Review Desk trace.">
                      <input
                        className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                        value={workflowTemplateLabel}
                        onChange={(event) => setWorkflowTemplateLabel(event.target.value)}
                        placeholder="Human close handoff"
                      />
                    </Field>
                    <Field label="Description" hint="Operator-facing explanation for when this template should be used.">
                      <textarea
                        className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                        value={workflowTemplateDescription}
                        onChange={(event) => setWorkflowTemplateDescription(event.target.value)}
                        placeholder="Use when closing human-reviewed merges that require rollback context."
                      />
                    </Field>
                    <Field label="Summary" hint="Optional summary injected into the protocol message. Supports {issueIdentifier}.">
                      <input
                        className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                        value={workflowTemplateSummary}
                        onChange={(event) => setWorkflowTemplateSummary(event.target.value)}
                        placeholder="Board closed {issueIdentifier}"
                      />
                    </Field>
                    <Field label="Fields JSON" hint="String map merged into the protocol payload. Use only string values.">
                      <textarea
                        className="min-h-[220px] w-full rounded-md border border-border bg-transparent px-3 py-3 font-mono text-sm outline-none"
                        value={workflowTemplateFieldsText}
                        onChange={(event) => setWorkflowTemplateFieldsText(event.target.value)}
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        onClick={handleSaveWorkflowTemplate}
                        disabled={
                          workflowTemplatesMutation.isPending
                          || workflowTemplateFieldsParse.fields === null
                          || workflowTemplateLabel.trim().length === 0
                          || !workflowTemplateDirty
                        }
                      >
                        {workflowTemplatesMutation.isPending
                          ? "Saving..."
                          : selectedWorkflowTemplate.scope === "company"
                            ? "Save company template"
                            : "Clone to company"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resetWorkflowTemplateEditor(selectedWorkflowTemplate)}
                        disabled={workflowTemplatesMutation.isPending || !workflowTemplateDirty}
                      >
                        Reset editor
                      </Button>
                      {selectedWorkflowTemplate.scope === "company" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleDeleteWorkflowTemplate}
                          disabled={workflowTemplatesMutation.isPending}
                        >
                          Delete company template
                        </Button>
                      )}
                      {workflowTemplatesMutation.isError && (
                        <span className="text-xs text-destructive">
                          {workflowTemplatesMutation.error instanceof Error
                            ? workflowTemplatesMutation.error.message
                            : "Failed to update workflow templates"}
                        </span>
                      )}
                    </div>
                    {workflowTemplateFieldsParse.error && (
                      <div className="text-xs text-destructive">{workflowTemplateFieldsParse.error}</div>
                    )}
                  </div>

                  <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Template Notes
                    </div>
                    <div className="rounded-md border border-border bg-background px-3 py-3">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Trace visibility</div>
                      <p className="mt-2 text-sm text-foreground">
                        Saved templates are traced into protocol payloads and surfaced in Change Review so operators can see which board template shaped the close or approval action.
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-background px-3 py-3">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Template inventory</div>
                      <div className="mt-2 text-sm text-foreground">
                        {companyWorkflowTemplates.length} company template(s) overriding {workflowTemplates.length - companyWorkflowTemplates.length} default template(s).
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-background px-3 py-3">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Field preview</div>
                      <pre className="mt-2 whitespace-pre-wrap text-xs text-foreground">
                        {workflowTemplateFieldsParse.fields
                          ? stringifyWorkflowTemplateFields(workflowTemplateFieldsParse.fields)
                          : workflowTemplateFieldsText}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Role Packs
        </div>
        <div className="space-y-4 rounded-md border border-border px-4 py-4">
          <div className="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
            <label className="text-sm font-medium text-foreground">Seed preset</label>
            <div className="space-y-2">
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={selectedRolePackPresetKey}
                onChange={(e) =>
                  setSelectedRolePackPresetKey(
                    e.target.value as RolePackPresetKey
                  )
                }
              >
                {rolePackPresets.map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{selectedRolePackPreset.description}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => seedRolePacksMutation.mutate(false)}
              disabled={seedRolePacksMutation.isPending}
            >
              {seedRolePacksMutation.isPending ? "Seeding..." : "Seed default role packs"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => seedRolePacksMutation.mutate(true)}
              disabled={seedRolePacksMutation.isPending}
            >
              Refresh defaults
            </Button>
            <span className="text-xs text-muted-foreground">
              Base persona packs for Tech Lead, Engineer, and Reviewer using the selected preset.
            </span>
          </div>
          {seedRolePacksMutation.isError && (
            <p className="text-sm text-destructive">
              {seedRolePacksMutation.error instanceof Error ? seedRolePacksMutation.error.message : "Failed to seed role packs"}
            </p>
          )}
          <div className="grid gap-4 rounded-lg border border-border bg-muted/20 px-4 py-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(260px,0.9fr)]">
            <div className="space-y-3">
              <div>
                <div className="text-sm font-semibold">Create custom role</div>
                <p className="text-xs text-muted-foreground">
                  Start from an existing delivery base role, then refine its markdown contract in Role Studio.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Role name" hint="Operator-facing display name for this custom role.">
                  <input
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                    value={customRoleName}
                    onChange={(event) => setCustomRoleName(event.target.value)}
                    placeholder="Release Captain"
                  />
                </Field>
                <Field label="Role slug" hint="Optional stable identifier. Lowercase letters, digits, and dashes only.">
                  <input
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                    value={customRoleSlug}
                    onChange={(event) => setCustomRoleSlug(event.target.value)}
                    placeholder="release-captain"
                  />
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Base role" hint="Initial runtime contract that this custom role inherits.">
                  <select
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                    value={customRoleBaseRoleKey}
                    onChange={(event) => setCustomRoleBaseRoleKey(event.target.value as RolePackCustomBaseRoleKey)}
                  >
                    <option value="cto">CTO</option>
                    <option value="tech_lead">Tech Lead</option>
                    <option value="engineer">Engineer</option>
                    <option value="reviewer">Reviewer</option>
                    <option value="qa">QA</option>
                    <option value="human_board">Human Board</option>
                    <option value="pm">PM</option>
                  </select>
                </Field>
                <div className="rounded-md border border-border/70 bg-background/60 px-3 py-3">
                  <ToggleField
                    label="Publish initial revision"
                    hint="Turn off to create the first revision as draft only."
                    checked={customRolePublish}
                    onChange={setCustomRolePublish}
                  />
                </div>
              </div>
              <Field label="Description" hint="Short explanation of the custom role's delivery responsibility.">
                <textarea
                  className="min-h-[96px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                  value={customRoleDescription}
                  onChange={(event) => setCustomRoleDescription(event.target.value)}
                  placeholder="Own release coordination, evidence collection, and rollback escalation across multiple work items."
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => createCustomRoleMutation.mutate()}
                  disabled={createCustomRoleMutation.isPending || !customRoleValid}
                >
                  {createCustomRoleMutation.isPending ? "Creating..." : "Create custom role"}
                </Button>
                {!customRoleSlugValid && (
                  <span className="text-xs text-destructive">
                    Custom role slug must use lowercase letters, digits, and dashes only.
                  </span>
                )}
                {createCustomRoleMutation.isError && (
                  <span className="text-xs text-destructive">
                    {createCustomRoleMutation.error instanceof Error
                      ? createCustomRoleMutation.error.message
                      : "Failed to create custom role"}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3 rounded-md border border-border bg-background px-4 py-4">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">How custom roles work</div>
              <ul className="space-y-2 text-sm text-foreground">
                <li>They inherit one base role contract and remain editable through normal Role Studio revisions.</li>
                <li>The runtime still follows the same protocol workflow and review gates as seeded roles.</li>
                <li>Use custom roles for company-specific specializations such as Release Captain or Staff Architect.</li>
              </ul>
            </div>
          </div>
          <div className="grid gap-3">
            {rolePacks.length === 0 ? (
              <div className="text-sm text-muted-foreground">No role packs have been seeded yet.</div>
            ) : rolePacks.map((rolePack) => {
              const agentsPreview = previewRolePackFile(rolePack, "AGENTS.md");
              return (
                <div key={rolePack.id} className="rounded-md border border-border px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold">{rolePackDisplayName(rolePack)}</div>
                    <div className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {rolePack.latestRevision ? `v${rolePack.latestRevision.version}` : "No revision"}
                    </div>
                    <div className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {rolePack.latestRevision?.status ?? rolePack.status}
                    </div>
                    {rolePack.baseRoleKey && (
                      <div className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        Base {formatRoleKeyLabel(rolePack.baseRoleKey)}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {rolePack.latestFiles.map((file) => (
                      <span key={file.id} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {file.filename}
                      </span>
                    ))}
                  </div>
                  {agentsPreview && (
                    <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">AGENTS.md preview</div>
                      <pre className="mt-2 whitespace-pre-wrap text-xs text-foreground">{agentsPreview}</pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {selectedRolePack && selectedRolePackDraft && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-background/70 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Role Studio</div>
                    <p className="text-xs text-muted-foreground">
                      Edit the markdown pack that composes this role's runtime persona.
                    </p>
                  </div>
                  <select
                    className="rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                    value={selectedRolePackId ?? ""}
                    onChange={(event) => setSelectedRolePackId(event.target.value)}
                  >
                    {rolePacks.map((rolePack) => (
                      <option key={rolePack.id} value={rolePack.id}>
                        {rolePackDisplayName(rolePack)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {ROLE_PACK_FILE_NAMES.map((filename) => (
                    <button
                      key={filename}
                      type="button"
                      onClick={() => setSelectedRolePackFile(filename)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${selectedRolePackFile === filename ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-accent/50"}`}
                    >
                      {filename}
                    </button>
                  ))}
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
                  <div className="space-y-3">
                    <div className="rounded-md border border-border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                      {draftChangedFileCount === 0
                        ? "Draft matches the latest revision."
                        : `${draftChangedFileCount} role pack file(s) differ from the latest revision.`}
                    </div>
                    {restoredFromRevision && (
                      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-xs text-amber-800">
                        Restored from revision v{restoredFromRevision.version}. Review the diff and publish with a new revision message when ready.
                      </div>
                    )}
                    {changedRolePackFiles.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {changedRolePackFiles.map((filename) => (
                          <span
                            key={filename}
                            className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {filename}
                          </span>
                        ))}
                      </div>
                    )}
                    <Field
                      label={`${selectedRolePackFile} contents`}
                      hint="Guided setup can seed these, but production behavior comes from the markdown pack."
                    >
                      <textarea
                        className="min-h-[360px] w-full rounded-md border border-border bg-transparent px-3 py-3 font-mono text-sm outline-none"
                        value={selectedRolePackDraft[selectedRolePackFile] ?? ""}
                        onChange={(event) => updateRolePackDraft(selectedRolePackFile, event.target.value)}
                      />
                    </Field>
                    <Field
                      label="Revision message"
                      hint="Short change summary stored with this draft or publish action."
                    >
                      <input
                        className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                        value={rolePackRevisionMessage}
                        onChange={(event) => setRolePackRevisionMessage(event.target.value)}
                        placeholder="Refine reviewer evidence policy"
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => createRolePackRevisionMutation.mutate({
                          rolePackSetId: selectedRolePack.id,
                          status: "draft",
                          files: selectedRolePackDraft,
                          message: rolePackRevisionMessage.trim() || null,
                        })}
                        disabled={createRolePackRevisionMutation.isPending || restoreRolePackRevisionMutation.isPending || !canSaveRolePackDraft}
                      >
                        {createRolePackRevisionMutation.isPending ? "Saving..." : "Save draft"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => createRolePackRevisionMutation.mutate({
                          rolePackSetId: selectedRolePack.id,
                          status: "published",
                          files: selectedRolePackDraft,
                          message: rolePackRevisionMessage.trim() || null,
                        })}
                        disabled={createRolePackRevisionMutation.isPending || restoreRolePackRevisionMutation.isPending || !canPublishRolePackRevision}
                      >
                        Publish revision
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={resetRolePackDraftToLatest}
                        disabled={createRolePackRevisionMutation.isPending || restoreRolePackRevisionMutation.isPending || draftChangedFileCount === 0}
                      >
                        Reset to latest
                      </Button>
                      {(createRolePackRevisionMutation.isError || restoreRolePackRevisionMutation.isError) && (
                        <span className="text-xs text-destructive">
                          {createRolePackRevisionMutation.error instanceof Error
                            ? createRolePackRevisionMutation.error.message
                            : restoreRolePackRevisionMutation.error instanceof Error
                              ? restoreRolePackRevisionMutation.error.message
                              : "Failed to update revision"}
                        </span>
                      )}
                    </div>
                    {!canPublishRolePackRevision && (
                      <div className="text-xs text-muted-foreground">
                        Publish requires at least one changed file and a revision message.
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Active Preview
                    </div>
                    <div className="rounded-md border border-border bg-background px-3 py-3">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {selectedRolePackFile}
                      </div>
                      <MarkdownBody className="mt-2">
                        {(selectedRolePackDraft[selectedRolePackFile] ?? "").trim() || "No content yet."}
                      </MarkdownBody>
                    </div>
                    <div className="rounded-md border border-border bg-background px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Revision History
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Latest revision: {selectedRolePack.latestRevision ? `v${selectedRolePack.latestRevision.version}` : "none"}
                        </div>
                      </div>
                      {selectedRolePackRevisions.length === 0 ? (
                        <div className="mt-2 text-xs text-muted-foreground">No revisions yet.</div>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {selectedRolePackRevisions.slice(0, 6).map((revision) => {
                            const isActivePreview = selectedRolePackRevision?.id === revision.id;
                            return (
                              <div key={revision.id} className="rounded-md border border-border/70 px-3 py-3">
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedRolePackRevisionId(revision.id)}
                                    className={`rounded-full border px-2 py-0.5 ${isActivePreview ? "border-foreground bg-foreground text-background" : "border-border"}`}
                                  >
                                    v{revision.version}
                                  </button>
                                  <span>{revision.status}</span>
                                  <span>{new Date(revision.createdAt).toLocaleString()}</span>
                                </div>
                                {revision.message && (
                                  <div className="mt-2 text-sm text-foreground">{revision.message}</div>
                                )}
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setRolePackDrafts((current) => ({
                                        ...current,
                                        [selectedRolePack.id]: buildRolePackDraftFromFiles(revision.files),
                                      }));
                                      setRolePackRestoreSources((current) => ({
                                        ...current,
                                        [selectedRolePack.id]: revision.id,
                                      }));
                                      setRolePackRevisionMessage(`Restore v${revision.version} for ${rolePackDisplayName(selectedRolePack)}`);
                                    }}
                                  >
                                    Load to editor
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => restoreRolePackRevisionMutation.mutate({
                                      rolePackSetId: selectedRolePack.id,
                                      revisionId: revision.id,
                                      message: `Restore v${revision.version} for ${rolePackDisplayName(selectedRolePack)}`,
                                    })}
                                    disabled={
                                      restoreRolePackRevisionMutation.isPending
                                      || createRolePackRevisionMutation.isPending
                                      || revision.id === selectedRolePack.latestRevision?.id
                                    }
                                  >
                                    Restore as draft
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setSelectedRolePackRevisionId(revision.id)}
                                  >
                                    Preview
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {selectedRolePackRevision && (
                      <div className="rounded-md border border-border bg-background px-3 py-3">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Revision Preview · v{selectedRolePackRevision.version}
                        </div>
                        <MarkdownBody className="mt-2">
                          {buildRolePackDraftFromFiles(selectedRolePackRevision.files)[selectedRolePackFile] || "No content in this revision."}
                        </MarkdownBody>
                      </div>
                    )}
                    {selectedRolePackDiffBaseline && (
                      <div className="rounded-md border border-border bg-background px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Side-by-side diff
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {selectedRolePackDiffBaseline.label} vs draft
                          </div>
                        </div>
                        <div className="mt-3">
                          <MarkdownDiffView
                            baselineLabel={selectedRolePackDiffBaseline.label}
                            candidateLabel="Draft editor"
                            baselineText={selectedRolePackDiffBaseline.files[selectedRolePackFile] ?? ""}
                            candidateText={selectedRolePackDraft[selectedRolePackFile] ?? ""}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <RoleSimulationConsole
                companyId={selectedCompanyId!}
                rolePackSetId={selectedRolePack.id}
                roleKey={selectedRolePack.baseRoleKey ?? selectedRolePack.roleKey}
                draftFiles={selectedRolePackDraft}
              />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Retrieval Policies
        </div>
        <div className="space-y-4 rounded-md border border-border px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Policy Console</div>
              <p className="text-xs text-muted-foreground">
                Tune how each role retrieves knowledge for a workflow transition.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSelectedPolicyKey("");
                setPolicyRole("engineer");
                setPolicyEventType("START_IMPLEMENTATION");
                setPolicyWorkflowState("implementing");
                setPolicyTopKDense("20");
                setPolicyTopKSparse("20");
                setPolicyRerankK("20");
                setPolicyFinalK("8");
                setPolicySourceTypes("code, adr, issue, runbook, meeting");
                setPolicyAuthorityLevels("canonical, draft");
                setPolicyMetadataText("{}");
              }}
            >
              New policy
            </Button>
          </div>

          {retrievalPolicies.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {retrievalPolicies.map((policy) => {
                const key = retrievalPolicyKey(policy);
                const active = key === selectedPolicyKey;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedPolicyKey(key)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-accent/50"}`}
                  >
                    {policy.role} · {policy.eventType} · {policy.workflowState}
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Role" hint="Recipient role for this retrieval policy.">
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                value={policyRole}
                onChange={(event) => setPolicyRole(event.target.value)}
              />
            </Field>
            <Field label="Event type" hint="Protocol message that triggers retrieval.">
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                value={policyEventType}
                onChange={(event) => setPolicyEventType(event.target.value)}
              />
            </Field>
            <Field label="Workflow state" hint="State in which this policy applies.">
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                value={policyWorkflowState}
                onChange={(event) => setPolicyWorkflowState(event.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Dense top K" hint="Vector candidate count before rerank.">
              <input className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none" value={policyTopKDense} onChange={(event) => setPolicyTopKDense(event.target.value)} />
            </Field>
            <Field label="Sparse top K" hint="FTS candidate count before rerank.">
              <input className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none" value={policyTopKSparse} onChange={(event) => setPolicyTopKSparse(event.target.value)} />
            </Field>
            <Field label="Rerank K" hint="Candidate count entering rerank.">
              <input className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none" value={policyRerankK} onChange={(event) => setPolicyRerankK(event.target.value)} />
            </Field>
            <Field label="Final K" hint="Final context size returned to the agent.">
              <input className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none" value={policyFinalK} onChange={(event) => setPolicyFinalK(event.target.value)} />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Allowed source types" hint="Comma-separated. Example: code, adr, issue.">
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                value={policySourceTypes}
                onChange={(event) => setPolicySourceTypes(event.target.value)}
              />
            </Field>
            <Field label="Authority levels" hint="Comma-separated. Example: canonical, draft.">
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                value={policyAuthorityLevels}
                onChange={(event) => setPolicyAuthorityLevels(event.target.value)}
              />
            </Field>
          </div>

          <Field label="Metadata JSON" hint="Optional rerank and freshness hints stored with the policy.">
            <textarea
              className="min-h-[180px] w-full rounded-md border border-border bg-transparent px-3 py-3 font-mono text-sm outline-none"
              value={policyMetadataText}
              onChange={(event) => setPolicyMetadataText(event.target.value)}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => upsertRetrievalPolicyMutation.mutate()}
              disabled={upsertRetrievalPolicyMutation.isPending}
            >
              {upsertRetrievalPolicyMutation.isPending ? "Saving..." : "Save policy"}
            </Button>
            {upsertRetrievalPolicyMutation.isError && (
              <span className="text-xs text-destructive">
                {upsertRetrievalPolicyMutation.error instanceof Error
                  ? upsertRetrievalPolicyMutation.error.message
                  : "Failed to save policy"}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Operating Alerts
        </div>
        <div className="space-y-4 rounded-md border border-border px-4 py-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-3 rounded-md border border-border/70 bg-muted/20 px-3 py-3">
              <ToggleField
                label="Enable external operator alerts"
                hint="Fan out high-signal review, dependency, protocol, and runtime incidents to Slack or generic webhooks."
                checked={alertEnabled}
                onChange={setAlertEnabled}
              />
            </div>
            <Field label="Minimum severity" hint="Only alerts at or above this severity will be delivered.">
              <select
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                value={alertMinSeverity}
                onChange={(event) => setAlertMinSeverity(event.target.value as "medium" | "high" | "critical")}
              >
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
            <Field label="Cooldown minutes" hint="Suppress repeated deliveries for the same dedupe key within this window.">
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                value={alertCooldownMinutes}
                onChange={(event) => setAlertCooldownMinutes(event.target.value.replace(/[^0-9]/g, ""))}
                placeholder="15"
              />
            </Field>
            <div className="rounded-md border border-border/70 bg-background/60 px-3 py-3 text-sm">
              <div className="font-medium text-foreground">Recent deliveries</div>
              <div className="mt-1 text-muted-foreground">
                {operatingAlerts?.recentDeliveries.length ?? 0} logged delivery attempts
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Destinations</div>
                <p className="text-xs text-muted-foreground">
                  Slack incoming webhooks and generic JSON webhooks are supported in this slice.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAlertDestinations((current) => [...current, createOperatingAlertDestinationDraft()])}
              >
                Add destination
              </Button>
            </div>

            {alertDestinations.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
                No external destinations configured yet.
              </div>
            ) : (
              <div className="space-y-3">
                {alertDestinations.map((destination, index) => (
                  <div key={destination.id} className="space-y-3 rounded-md border border-border px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold">Destination {index + 1}</div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setAlertDestinations((current) =>
                            current.filter((entry) => entry.id !== destination.id))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Label" hint="Shown in recent delivery history and outbound metadata.">
                        <input
                          className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                          value={destination.label}
                          onChange={(event) => updateAlertDestination(destination.id, { label: event.target.value })}
                          placeholder="Ops Slack"
                        />
                      </Field>
                      <Field label="Type" hint="Slack uses block-formatted payloads. Generic webhook receives full JSON.">
                        <select
                          className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                          value={destination.type}
                          onChange={(event) =>
                            updateAlertDestination(destination.id, {
                              type: event.target.value as OperatingAlertDestinationConfig["type"],
                            })}
                        >
                          <option value="slack_webhook">Slack webhook</option>
                          <option value="generic_webhook">Generic webhook</option>
                        </select>
                      </Field>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Webhook URL" hint="HTTPS endpoint that receives the outbound alert payload.">
                        <input
                          className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                          value={destination.url}
                          onChange={(event) => updateAlertDestination(destination.id, { url: event.target.value })}
                          placeholder="https://hooks.slack.com/services/..."
                        />
                      </Field>
                      <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-3">
                        <ToggleField
                          label="Enabled"
                          hint="Disabled destinations stay in config but do not receive events."
                          checked={destination.enabled}
                          onChange={(value) => updateAlertDestination(destination.id, { enabled: value })}
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Auth header name" hint="Optional header name for generic endpoints that require authentication.">
                        <input
                          className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                          value={destination.authHeaderName ?? ""}
                          onChange={(event) =>
                            updateAlertDestination(destination.id, {
                              authHeaderName: event.target.value || null,
                            })}
                          placeholder="Authorization"
                        />
                      </Field>
                      <Field label="Auth header value" hint="Stored in company setup metadata for now, so treat it like a temporary secret.">
                        <input
                          className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                          value={destination.authHeaderValue ?? ""}
                          onChange={(event) =>
                            updateAlertDestination(destination.id, {
                              authHeaderValue: event.target.value || null,
                            })}
                          placeholder="Bearer ..."
                        />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => operatingAlertsMutation.mutate()}
              disabled={!alertDirty || !alertConfigValid || operatingAlertsMutation.isPending}
            >
              {operatingAlertsMutation.isPending ? "Saving..." : "Save alerts"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => operatingAlertTestMutation.mutate()}
              disabled={operatingAlertTestMutation.isPending}
            >
              {operatingAlertTestMutation.isPending ? "Sending..." : "Send test alert"}
            </Button>
            {!alertConfigValid && (
              <span className="text-xs text-destructive">
                Cooldown must be at least 1 minute and every destination needs a label and URL.
              </span>
            )}
            {operatingAlertsMutation.isError && (
              <span className="text-xs text-destructive">
                {operatingAlertsMutation.error instanceof Error
                  ? operatingAlertsMutation.error.message
                  : "Failed to save operating alerts"}
              </span>
            )}
            {operatingAlertTestMutation.isError && (
              <span className="text-xs text-destructive">
                {operatingAlertTestMutation.error instanceof Error
                  ? operatingAlertTestMutation.error.message
                  : "Failed to send test alert"}
              </span>
            )}
          </div>

          <div className="space-y-3">
            <div className="text-sm font-semibold">Recent delivery activity</div>
            {(operatingAlerts?.recentDeliveries.length ?? 0) === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
                No outbound alert delivery has been logged yet.
              </div>
            ) : (
              <div className="space-y-2">
                {operatingAlerts?.recentDeliveries.map((delivery) => (
                  <div key={delivery.id} className="rounded-md border border-border px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded-full border border-border px-2 py-0.5">
                        {delivery.status}
                      </span>
                      <span>{delivery.severity}</span>
                      <span>{delivery.reason}</span>
                      <span>{delivery.destinationLabel}</span>
                    </div>
                    <div className="mt-2 text-sm font-medium text-foreground">{delivery.summary}</div>
                    {delivery.detail && (
                      <div className="mt-1 text-sm text-muted-foreground">{delivery.detail}</div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{new Date(delivery.createdAt).toLocaleString()}</span>
                      {delivery.issue?.identifier && <span>{delivery.issue.identifier}</span>}
                      {delivery.responseStatus != null && <span>HTTP {delivery.responseStatus}</span>}
                      {delivery.errorMessage && <span>{delivery.errorMessage}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Invites */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Invites
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Generate a link to invite humans or agents to this company.</span>
            <HintIcon text="Invite links expire after 72 hours and allow both human and agent joins." />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => inviteMutation.mutate()} disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? "Creating..." : "Create invite link"}
            </Button>
            {inviteLink && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(inviteLink);
                }}
              >
                Copy link
              </Button>
            )}
          </div>
          {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
          {inviteLink && (
            <div className="rounded-md border border-border bg-muted/30 p-2">
              <div className="text-xs text-muted-foreground">Share link</div>
              <div className="mt-1 break-all font-mono text-xs">{inviteLink}</div>
            </div>
          )}
        </div>
      </div>

      {/* Archive */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-amber-700 uppercase tracking-wide">
          Archive
        </div>
        <div className="space-y-3 rounded-md border border-amber-300/60 bg-amber-100/30 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Archive this company to hide it from the sidebar. This persists in the database.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={archiveMutation.isPending || selectedCompany.status === "archived"}
              onClick={() => {
                if (!selectedCompanyId) return;
                const confirmed = window.confirm(
                  `Archive company "${selectedCompany.name}"? It will be hidden from the sidebar.`,
                );
                if (!confirmed) return;
                const nextCompanyId = companies.find((company) =>
                  company.id !== selectedCompanyId && company.status !== "archived")?.id ?? null;
                archiveMutation.mutate({ companyId: selectedCompanyId, nextCompanyId });
              }}
            >
              {archiveMutation.isPending
                ? "Archiving..."
                : selectedCompany.status === "archived"
                  ? "Already archived"
                  : "Archive company"}
            </Button>
            {archiveMutation.isError && (
              <span className="text-xs text-destructive">
                {archiveMutation.error instanceof Error
                  ? archiveMutation.error.message
                  : "Failed to archive company"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
