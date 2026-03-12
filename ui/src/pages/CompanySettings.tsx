import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
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
import { Field, ToggleField, HintIcon } from "../components/agent-config-primitives";
import { Layers3, SearchCheck, Settings, ShieldCheck } from "lucide-react";
import {
  WORKFLOW_TEMPLATE_ACTION_TYPES,
  ROLE_PACK_FILE_NAMES,
  type DoctorCheckStatus,
  type OperatingAlertDestinationConfig,
  type RolePackCustomBaseRoleKey,
  type RolePackFileName,
  type RolePackPresetDescriptor,
  type RolePackPresetKey,
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

export function CompanySettings() {
  const { companies, selectedCompany, selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
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

  const { data: rolePacks = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.companies.rolePacks(selectedCompanyId) : ["companies", "__none__", "role-packs"],
    queryFn: () => companiesApi.listRolePacks(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });
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
