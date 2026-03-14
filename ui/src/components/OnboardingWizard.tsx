import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdapterEnvironmentTestResult,
  IssuePriority,
  TeamBlueprint,
  TeamBlueprintApplyResult,
  TeamBlueprintKey,
  TeamBlueprintPreviewRequest,
  TeamBlueprintPreviewResult,
} from "@squadrail/shared";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { companiesApi } from "../api/companies";
import { goalsApi } from "../api/goals";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import { appRoutes } from "../lib/appRoutes";
import { Dialog, DialogPortal } from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";
import { getUIAdapter } from "../adapters";
import { defaultCreateValues } from "./agent-config-defaults";
import { ChoosePathButton } from "./PathInstructionsModal";
import { HintIcon } from "./agent-config-primitives";
import { ProductWordmark } from "./ProductWordmark";
import {
  DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
  DEFAULT_CODEX_LOCAL_MODEL,
} from "@squadrail/adapter-codex-local";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  Check,
  ChevronDown,
  FolderOpen,
  GitBranch,
  ListChecks,
  Loader2,
  Network,
  Sparkles,
  X,
} from "lucide-react";

type Step = 1 | 2 | 3 | 4;
type AdapterType = "claude_local" | "codex_local";

const NEW_WORKSPACE_OPTION = "__new__";
const QUICK_REQUEST_PRIORITY_OPTIONS: IssuePriority[] = [
  "critical",
  "high",
  "medium",
  "low",
];

const ONBOARDING_ADAPTER_OPTIONS = [
  {
    value: "claude_local" as const,
    label: "Claude Code",
    icon: Sparkles,
    desc: "Primary local execution engine",
    recommended: true,
  },
  {
    value: "codex_local" as const,
    label: "Codex",
    icon: Bot,
    desc: "Primary local execution engine",
    recommended: false,
  },
];

function blueprintStatusTone(status: "ready" | "warning" | "missing" | "partial") {
  if (status === "ready") return "border-emerald-300/65 bg-emerald-50/70 text-emerald-800";
  if (status === "warning" || status === "partial") {
    return "border-amber-300/65 bg-amber-50/70 text-amber-800";
  }
  return "border-rose-300/65 bg-rose-50/70 text-rose-800";
}

function titleCasePriority(priority: IssuePriority) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

async function waitForPersistedWorkspace(input: {
  companyId: string;
  projectId: string;
  workspaceId: string;
  cwd: string | null;
  repoUrl: string | null;
}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const project = await projectsApi.get(input.projectId, input.companyId);
    const workspace =
      project.workspaces.find((entry) => entry.id === input.workspaceId) ??
      project.workspaces.find(
        (entry) =>
          entry.isPrimary &&
          (input.cwd ? entry.cwd === input.cwd : true) &&
          (input.repoUrl ? entry.repoUrl === input.repoUrl : true)
      ) ??
      null;
    if (workspace) return workspace;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }

  return null;
}

export function OnboardingWizard() {
  const { onboardingOpen, onboardingOptions, closeOnboarding } = useDialog();
  const { companies, setSelectedCompanyId } = useCompany();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const initialStep = onboardingOptions.initialStep ?? 1;
  const existingCompanyId = onboardingOptions.companyId ?? null;

  const [step, setStep] = useState<Step>(initialStep);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);

  // Step 1
  const [companyName, setCompanyName] = useState("");
  const [companyGoal, setCompanyGoal] = useState("");

  // Step 2
  const [selectedTeamBlueprintKey, setSelectedTeamBlueprintKey] =
    useState<TeamBlueprintKey | null>(null);
  const [selectedTeamBlueprintPreview, setSelectedTeamBlueprintPreview] =
    useState<TeamBlueprintPreviewResult | null>(null);
  const [teamBlueprintApplyResult, setTeamBlueprintApplyResult] =
    useState<TeamBlueprintApplyResult | null>(null);
  const [confirmTeamBlueprintApply, setConfirmTeamBlueprintApply] = useState(false);

  // Step 3
  const [adapterType, setAdapterType] = useState<AdapterType>("claude_local");
  const [model, setModel] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [workspaceSelectionId, setWorkspaceSelectionId] = useState<string>(NEW_WORKSPACE_OPTION);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceCwd, setWorkspaceCwd] = useState("");
  const [workspaceRepoUrl, setWorkspaceRepoUrl] = useState("");
  const [adapterEnvResult, setAdapterEnvResult] =
    useState<AdapterEnvironmentTestResult | null>(null);
  const [adapterEnvError, setAdapterEnvError] = useState<string | null>(null);
  const [adapterEnvLoading, setAdapterEnvLoading] = useState(false);
  const [forceUnsetAnthropicApiKey, setForceUnsetAnthropicApiKey] =
    useState(false);
  const [unsetAnthropicLoading, setUnsetAnthropicLoading] = useState(false);

  // Step 4
  const [quickRequestTitle, setQuickRequestTitle] = useState("");
  const [quickRequest, setQuickRequest] = useState("");
  const [quickRequestPriority, setQuickRequestPriority] =
    useState<IssuePriority>("medium");
  const [quickRequestTouched, setQuickRequestTouched] = useState(false);

  // Created references
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(
    existingCompanyId
  );
  const [createdCompanyPrefix, setCreatedCompanyPrefix] = useState<string | null>(
    null
  );

  const quickRequestRef = useRef<HTMLTextAreaElement>(null);
  const autoResizeQuickRequest = useCallback(() => {
    const element = quickRequestRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  useEffect(() => {
    if (!onboardingOpen) return;
    const companyId = onboardingOptions.companyId ?? null;
    setStep(onboardingOptions.initialStep ?? 1);
    setCreatedCompanyId(companyId);
    setCreatedCompanyPrefix(null);
  }, [
    onboardingOpen,
    onboardingOptions.companyId,
    onboardingOptions.initialStep,
  ]);

  useEffect(() => {
    if (!onboardingOpen || !createdCompanyId || createdCompanyPrefix) return;
    const company = companies.find((entry) => entry.id === createdCompanyId);
    if (!company) return;
    setCreatedCompanyPrefix(company.issuePrefix);
    if (!companyName.trim()) {
      setCompanyName(company.name);
    }
  }, [
    onboardingOpen,
    createdCompanyId,
    createdCompanyPrefix,
    companies,
    companyName,
  ]);

  useEffect(() => {
    autoResizeQuickRequest();
  }, [quickRequest, autoResizeQuickRequest]);

  const { data: setupProgress } = useQuery({
    queryKey: createdCompanyId
      ? queryKeys.companies.setupProgress(createdCompanyId)
      : ["companies", "__none__", "setup-progress"],
    queryFn: () => companiesApi.getSetupProgress(createdCompanyId!),
    enabled: onboardingOpen && Boolean(createdCompanyId),
  });

  const { data: teamBlueprintCatalog } = useQuery({
    queryKey: createdCompanyId
      ? queryKeys.companies.teamBlueprints(createdCompanyId)
      : ["companies", "__none__", "team-blueprints"],
    queryFn: () => companiesApi.getTeamBlueprints(createdCompanyId!),
    enabled: onboardingOpen && Boolean(createdCompanyId),
  });

  const { data: projects = [] } = useQuery({
    queryKey: createdCompanyId
      ? queryKeys.projects.list(createdCompanyId)
      : ["projects", "__none__"],
    queryFn: () => projectsApi.list(createdCompanyId!),
    enabled: onboardingOpen && Boolean(createdCompanyId) && step >= 2,
  });

  const { data: companyAgents = [] } = useQuery({
    queryKey: createdCompanyId
      ? queryKeys.agents.list(createdCompanyId)
      : ["agents", "__none__"],
    queryFn: () => agentsApi.list(createdCompanyId!),
    enabled: onboardingOpen && Boolean(createdCompanyId) && step >= 2,
  });

  const { data: adapterModels } = useQuery({
    queryKey: ["adapter-models", adapterType],
    queryFn: () => agentsApi.adapterModels(adapterType),
    enabled: onboardingOpen && step === 3,
  });

  const teamBlueprints = teamBlueprintCatalog?.blueprints ?? [];
  const canonicalAbsorptionPrep = teamBlueprintCatalog?.canonicalAbsorptionPrep ?? null;
  const onboardingTeamBlueprints = useMemo(
    () => teamBlueprints.filter((blueprint) => blueprint.parameterHints.supportsPm),
    [teamBlueprints]
  );
  const selectedTeamBlueprint =
    onboardingTeamBlueprints.find((blueprint) => blueprint.key === selectedTeamBlueprintKey) ??
    null;

  useEffect(() => {
    if (!onboardingTeamBlueprints.length) {
      setSelectedTeamBlueprintKey(null);
      return;
    }
    const canonicalFirstBlueprint =
      canonicalAbsorptionPrep
        ? onboardingTeamBlueprints.find(
            (blueprint) => blueprint.key === canonicalAbsorptionPrep.blueprintKey,
          )?.key ?? null
        : null;
    const defaultBlueprintKey =
      canonicalFirstBlueprint ?? onboardingTeamBlueprints[0]!.key;
    if (!selectedTeamBlueprintKey) {
      setSelectedTeamBlueprintKey(defaultBlueprintKey);
      return;
    }
    if (
      !onboardingTeamBlueprints.some(
        (blueprint) => blueprint.key === selectedTeamBlueprintKey
      )
    ) {
      setSelectedTeamBlueprintKey(defaultBlueprintKey);
    }
  }, [canonicalAbsorptionPrep, onboardingTeamBlueprints, selectedTeamBlueprintKey]);

  useEffect(() => {
    if (!selectedTeamBlueprint || quickRequestTouched) return;
    setQuickRequest(selectedTeamBlueprint.readiness.recommendedFirstQuickRequest);
  }, [selectedTeamBlueprint, quickRequestTouched]);

  const setupReadyFromExistingState = Boolean(setupProgress?.steps.squadReady);
  const hasActivePmAgent = companyAgents.some(
    (agent) => agent.role === "pm" && agent.status === "active"
  );
  const quickRequestReadyFromExistingState =
    setupReadyFromExistingState && hasActivePmAgent;
  const canContinueBlueprintStep =
    Boolean(teamBlueprintApplyResult) || quickRequestReadyFromExistingState;

  const currentProject =
    projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedTeamBlueprintPreviewRequest =
    canonicalAbsorptionPrep && selectedTeamBlueprint?.key === canonicalAbsorptionPrep.blueprintKey
      ? canonicalAbsorptionPrep.previewRequest
      : undefined;
  const currentProjectWorkspaces = currentProject?.workspaces ?? [];
  const selectedWorkspace =
    currentProjectWorkspaces.find((workspace) => workspace.id === workspaceSelectionId) ??
    null;
  const isCreatingWorkspace = workspaceSelectionId === NEW_WORKSPACE_OPTION;

  useEffect(() => {
    if (!projects.length) {
      setSelectedProjectId("");
      return;
    }
    const selectedStillExists = projects.some((project) => project.id === selectedProjectId);
    if (selectedStillExists) return;
    const previewProjectId = teamBlueprintApplyResult?.projectResults[0]?.projectId ?? null;
    if (previewProjectId && projects.some((project) => project.id === previewProjectId)) {
      setSelectedProjectId(previewProjectId);
      return;
    }
    if (setupProgress?.selectedWorkspaceId) {
      const matchingProject = projects.find((project) =>
        project.workspaces.some((workspace) => workspace.id === setupProgress.selectedWorkspaceId)
      );
      if (matchingProject) {
        setSelectedProjectId(matchingProject.id);
        return;
      }
    }
    setSelectedProjectId(projects[0]!.id);
  }, [projects, selectedProjectId, teamBlueprintApplyResult, setupProgress]);

  useEffect(() => {
    if (!currentProject) {
      setWorkspaceSelectionId(NEW_WORKSPACE_OPTION);
      return;
    }
    const defaultWorkspaceName = `${currentProject.name} Workspace`;
    setWorkspaceName((current) => current || defaultWorkspaceName);
    const currentSelectionStillValid =
      workspaceSelectionId === NEW_WORKSPACE_OPTION ||
      currentProject.workspaces.some((workspace) => workspace.id === workspaceSelectionId);
    if (currentSelectionStillValid) {
      return;
    }
    if (
      setupProgress?.selectedWorkspaceId &&
      currentProject.workspaces.some((workspace) => workspace.id === setupProgress.selectedWorkspaceId)
    ) {
      setWorkspaceSelectionId(setupProgress.selectedWorkspaceId);
      return;
    }
    const nextWorkspace =
      currentProject.primaryWorkspace?.id ??
      currentProject.workspaces[0]?.id ??
      NEW_WORKSPACE_OPTION;
    setWorkspaceSelectionId(nextWorkspace);
  }, [currentProject, setupProgress, workspaceSelectionId]);

  useEffect(() => {
    if (!selectedWorkspace) return;
    if (!workspaceCwd.trim() && selectedWorkspace.cwd) {
      setWorkspaceCwd(selectedWorkspace.cwd);
    }
    if (!workspaceRepoUrl.trim() && selectedWorkspace.repoUrl) {
      setWorkspaceRepoUrl(selectedWorkspace.repoUrl);
    }
  }, [selectedWorkspace, workspaceCwd, workspaceRepoUrl]);

  useEffect(() => {
    if (!setupProgress?.selectedEngine) return;
    if (
      setupProgress.selectedEngine === "claude_local" ||
      setupProgress.selectedEngine === "codex_local"
    ) {
      setAdapterType(setupProgress.selectedEngine);
    }
  }, [setupProgress]);

  const selectedModel = (adapterModels ?? []).find((entry) => entry.id === model);
  const effectiveWorkspaceCwd = isCreatingWorkspace
    ? workspaceCwd.trim()
    : (selectedWorkspace?.cwd ?? "").trim();

  useEffect(() => {
    if (step !== 3) return;
    setAdapterEnvResult(null);
    setAdapterEnvError(null);
  }, [
    step,
    adapterType,
    model,
    workspaceSelectionId,
    workspaceCwd,
    selectedProjectId,
  ]);

  function reset() {
    setStep(1);
    setLoading(false);
    setError(null);
    setModelOpen(false);
    setCompanyName("");
    setCompanyGoal("");
    setSelectedTeamBlueprintKey(null);
    setSelectedTeamBlueprintPreview(null);
    setTeamBlueprintApplyResult(null);
    setConfirmTeamBlueprintApply(false);
    setAdapterType("claude_local");
    setModel("");
    setSelectedProjectId("");
    setWorkspaceSelectionId(NEW_WORKSPACE_OPTION);
    setWorkspaceName("");
    setWorkspaceCwd("");
    setWorkspaceRepoUrl("");
    setAdapterEnvResult(null);
    setAdapterEnvError(null);
    setAdapterEnvLoading(false);
    setForceUnsetAnthropicApiKey(false);
    setUnsetAnthropicLoading(false);
    setQuickRequestTitle("");
    setQuickRequest("");
    setQuickRequestPriority("medium");
    setQuickRequestTouched(false);
    setCreatedCompanyId(null);
    setCreatedCompanyPrefix(null);
  }

  function handleClose() {
    reset();
    closeOnboarding();
  }

  function buildAdapterConfig(
    cwdOverride?: string,
    forceUnsetAnthropic: boolean = forceUnsetAnthropicApiKey
  ): Record<string, unknown> {
    const adapter = getUIAdapter(adapterType);
    const config = adapter.buildAdapterConfig({
      ...defaultCreateValues,
      adapterType,
      cwd: cwdOverride ?? effectiveWorkspaceCwd,
      model: adapterType === "codex_local" ? model || DEFAULT_CODEX_LOCAL_MODEL : model,
      dangerouslySkipPermissions: adapterType === "claude_local",
      dangerouslyBypassSandbox:
        adapterType === "codex_local"
          ? DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX
          : defaultCreateValues.dangerouslyBypassSandbox,
    });
    if (adapterType === "claude_local" && forceUnsetAnthropic) {
      const env =
        typeof config.env === "object" &&
        config.env !== null &&
        !Array.isArray(config.env)
          ? { ...(config.env as Record<string, unknown>) }
          : {};
      env.ANTHROPIC_API_KEY = { type: "plain", value: "" };
      config.env = env;
    }
    return config;
  }

  async function runAdapterEnvironmentTest(
    cwdOverride?: string,
    forceUnsetAnthropic: boolean = forceUnsetAnthropicApiKey
  ) {
    if (!createdCompanyId) {
      setAdapterEnvError("Create or select a company before testing the execution engine.");
      return null;
    }
    setAdapterEnvLoading(true);
    setAdapterEnvError(null);
    try {
      const result = await agentsApi.testEnvironment(createdCompanyId, adapterType, {
        adapterConfig: buildAdapterConfig(cwdOverride, forceUnsetAnthropic),
      });
      setAdapterEnvResult(result);
      return result;
    } catch (err) {
      setAdapterEnvError(
        err instanceof Error ? err.message : "Adapter environment test failed"
      );
      return null;
    } finally {
      setAdapterEnvLoading(false);
    }
  }

  const hasAnthropicApiKeyOverrideCheck =
    adapterEnvResult?.checks.some(
      (check) =>
        check.code === "claude_anthropic_api_key_overrides_subscription"
    ) ?? false;
  const shouldSuggestUnsetAnthropicApiKey =
    adapterType === "claude_local" &&
    adapterEnvResult?.status === "fail" &&
    hasAnthropicApiKeyOverrideCheck;

  const teamBlueprintPreviewMutation = useMutation({
    mutationFn: (input: {
      companyId: string;
      blueprintKey: TeamBlueprintKey;
      request?: TeamBlueprintPreviewRequest;
    }) =>
      companiesApi.previewTeamBlueprint(input.companyId, input.blueprintKey, input.request),
    onSuccess: (result) => {
      setSelectedTeamBlueprintPreview(result);
      setTeamBlueprintApplyResult(null);
      setConfirmTeamBlueprintApply(false);
      setError(null);
    },
  });

  const teamBlueprintApplyMutation = useMutation({
    mutationFn: (input: {
      companyId: string;
      preview: TeamBlueprintPreviewResult;
    }) =>
      companiesApi.applyTeamBlueprint(input.companyId, input.preview.blueprint.key, {
        previewHash: input.preview.previewHash,
        ...input.preview.parameters,
      }),
    onSuccess: async (result, variables) => {
      setTeamBlueprintApplyResult(result);
      setError(null);
      setSelectedProjectId(result.projectResults[0]?.projectId ?? "");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.list(variables.companyId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.agents.list(variables.companyId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.companies.setupProgress(variables.companyId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.companies.rolePacks(variables.companyId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.companies.doctor(variables.companyId),
        }),
      ]);
    },
  });

  async function handleStep1Next() {
    setLoading(true);
    setError(null);
    try {
      const company = await companiesApi.create({ name: companyName.trim() });
      setCreatedCompanyId(company.id);
      setCreatedCompanyPrefix(company.issuePrefix);
      setSelectedCompanyId(company.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.companies.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.companies.setupProgress(company.id),
        }),
      ]);
      if (companyGoal.trim()) {
        await goalsApi.create(company.id, {
          title: companyGoal.trim(),
          level: "company",
          status: "active",
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.goals.list(company.id),
        });
      }
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create company");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateBlueprintPreview() {
    if (!createdCompanyId || !selectedTeamBlueprintKey) return;
    setError(null);
    try {
      await teamBlueprintPreviewMutation.mutateAsync({
        companyId: createdCompanyId,
        blueprintKey: selectedTeamBlueprintKey,
        request: selectedTeamBlueprintPreviewRequest,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to generate the blueprint preview"
      );
    }
  }

  async function handleApplyTeamBlueprint() {
    if (!createdCompanyId) return;
    if (!selectedTeamBlueprintPreview) {
      setError("Generate a blueprint preview before applying it.");
      return;
    }
    if (!confirmTeamBlueprintApply) {
      setError("Review the preview diff and confirm the apply action before continuing.");
      return;
    }
    setError(null);
    try {
      await teamBlueprintApplyMutation.mutateAsync({
        companyId: createdCompanyId,
        preview: selectedTeamBlueprintPreview,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to apply the team blueprint"
      );
    }
  }

  async function handleStep2Next() {
    if (!canContinueBlueprintStep) {
      setError(
        "Apply a PM-ready team blueprint, or continue only if this company is already squad-ready with an active PM lane."
      );
      return;
    }
    setError(null);
    setStep(3);
  }

  async function handleUnsetAnthropicApiKey() {
    if (!createdCompanyId || unsetAnthropicLoading) return;
    setUnsetAnthropicLoading(true);
    setError(null);
    setAdapterEnvError(null);
    setForceUnsetAnthropicApiKey(true);
    try {
      const result = await runAdapterEnvironmentTest(effectiveWorkspaceCwd, true);
      if (result?.status === "fail") {
        setError(
          "Retried with ANTHROPIC_API_KEY unset in adapter config, but the environment test is still failing."
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to unset ANTHROPIC_API_KEY and retry."
      );
    } finally {
      setUnsetAnthropicLoading(false);
    }
  }

  async function handleStep3Next() {
    if (!createdCompanyId || !currentProject) return;
    setLoading(true);
    setError(null);
    try {
      if (adapterType === "claude_local" || adapterType === "codex_local") {
        const result = adapterEnvResult ?? (await runAdapterEnvironmentTest());
        if (!result) return;
        if (result.status === "fail") {
          setError("Resolve the execution engine environment check before continuing.");
          return;
        }
      }

      let workspaceId = workspaceSelectionId;
      if (workspaceSelectionId === NEW_WORKSPACE_OPTION) {
        const name = workspaceName.trim() || `${currentProject.name} Workspace`;
        const cwd = workspaceCwd.trim() || null;
        const repoUrl = workspaceRepoUrl.trim() || null;
        if (!cwd && !repoUrl) {
          setError("Provide at least one of workspace path or repository URL.");
          return;
        }
        const workspace = await projectsApi.createWorkspace(
          currentProject.id,
          {
            name,
            cwd,
            repoUrl,
            isPrimary: true,
          },
          createdCompanyId
        );
        const persistedWorkspace = await waitForPersistedWorkspace({
          companyId: createdCompanyId,
          projectId: currentProject.id,
          workspaceId: workspace.id,
          cwd,
          repoUrl,
        });
        if (!persistedWorkspace) {
          setError(
            "Workspace was created, but Squadrail could not confirm the saved workspace record yet. Retry once more."
          );
          return;
        }
        workspaceId = persistedWorkspace.id;
        setWorkspaceSelectionId(persistedWorkspace.id);
      }

      await companiesApi.updateSetupProgress(createdCompanyId, {
        selectedEngine: adapterType,
        selectedWorkspaceId: workspaceId || null,
      });

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.list(createdCompanyId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.companies.setupProgress(createdCompanyId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.companies.doctor(createdCompanyId),
        }),
      ]);

      setStep(4);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect the workspace"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleStep4Next() {
    if (!createdCompanyId || !quickRequest.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const response = await issuesApi.createPmIntakeIssue(createdCompanyId, {
        title: quickRequestTitle.trim() || undefined,
        request: quickRequest.trim(),
        projectId: selectedProjectId || null,
        priority: quickRequestPriority,
      });
      await companiesApi.updateSetupProgress(createdCompanyId, {
        metadata: {
          firstIssueReady: true,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.issues.list(createdCompanyId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.companies.setupProgress(createdCompanyId),
        }),
      ]);
      const issueRef = response.issue.identifier ?? response.issue.id;
      const companyPrefix =
        createdCompanyPrefix ??
        companies.find((entry) => entry.id === createdCompanyId)?.issuePrefix ??
        null;
      reset();
      closeOnboarding();
      if (companyPrefix) {
        navigate(`/${companyPrefix}${appRoutes.work}/${issueRef}`);
        return;
      }
      navigate(appRoutes.overview);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create the quick request"
      );
      setLoading(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    if (step === 1 && companyName.trim()) {
      void handleStep1Next();
      return;
    }
    if (step === 2 && canContinueBlueprintStep) {
      void handleStep2Next();
      return;
    }
    if (step === 3 && currentProject) {
      void handleStep3Next();
      return;
    }
    if (step === 4 && quickRequest.trim()) {
      void handleStep4Next();
    }
  }

  if (!onboardingOpen) return null;

  const stepOrder: Step[] = [1, 2, 3, 4];
  const stepDetails: Record<
    Step,
    {
      eyebrow: string;
      title: string;
      description: string;
      note: string;
      icon: typeof Building2;
    }
  > = {
    1: {
      eyebrow: "Company setup",
      title: "Create the operating company",
      description:
        "Start with the tenant name and optional operating goal. The rest of the setup will build the initial delivery team around it.",
      note: "A short company name is enough. Blueprint, workspace, and quick request come next.",
      icon: Building2,
    },
    2: {
      eyebrow: "Team blueprint",
      title: "Select the starting team blueprint",
      description:
        "Choose the delivery team shape, preview the diff, and apply it before the first execution lane is used.",
      note: "Preview first, apply with confirmation, then continue into workspace wiring.",
      icon: Network,
    },
    3: {
      eyebrow: "Workspace connection",
      title: "Connect the primary execution workspace",
      description:
        "Pick the main execution engine, attach a primary project workspace, and run a live environment probe before the first quick request.",
      note: "This step anchors doctor checks, retrieval bootstrap, and future implementation runs.",
      icon: FolderOpen,
    },
    4: {
      eyebrow: "Quick request",
      title: "Launch the first quick request",
      description:
        "Start with a short but execution-ready request. PM structuring and clarification can take over from there.",
      note: "Prefer a concrete delivery goal over a generic placeholder task.",
      icon: ListChecks,
    },
  };

  const currentStepDetail = stepDetails[step];
  const CurrentStepIcon = currentStepDetail.icon;

  const contextWorkspaceLabel = isCreatingWorkspace
    ? `${currentProject?.name ?? "Project"} / ${workspaceName.trim() || "New workspace"}`
    : selectedWorkspace
      ? `${currentProject?.name ?? "Project"} / ${selectedWorkspace.name}`
      : "Connect later";

  return (
    <Dialog
      open={onboardingOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogPortal>
        <div className="fixed inset-0 z-50 bg-[radial-gradient(circle_at_top_left,rgba(64,126,255,0.14),transparent_34%),linear-gradient(180deg,color-mix(in_oklab,var(--background)_94%,white),color-mix(in_oklab,var(--accent)_22%,white))] backdrop-blur-[4px]" />
        <div className="fixed inset-0 z-50 p-3 md:p-6" onKeyDown={handleKeyDown}>
          <div className="mx-auto flex h-full max-w-[1280px] items-center justify-center">
            <div className="grid h-full max-h-[calc(100vh-1.5rem)] w-full overflow-hidden rounded-[2rem] border border-border/85 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_94%,white),color-mix(in_oklab,var(--background)_98%,white))] shadow-[0_32px_80px_rgba(15,23,42,0.16)] lg:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="hidden min-h-0 border-r border-border/80 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--sidebar)_92%,white),color-mix(in_oklab,var(--accent)_18%,white))] lg:flex lg:flex-col">
                <div className="border-b border-border/80 px-6 py-6">
                  <ProductWordmark />
                  <div className="mt-6 rounded-[1.5rem] border border-border/80 bg-card/82 p-4 shadow-card">
                    <div className="text-[11px] font-medium tracking-[0.1em] text-muted-foreground">
                      Studio setup
                    </div>
                    <div className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-foreground">
                      Build the first delivery company
                    </div>
                    <div className="mt-2 text-sm leading-6 text-muted-foreground">
                      Move from company creation to reusable team shape, workspace connection, and the first quick request in one guided flow.
                    </div>
                  </div>
                </div>

                <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
                  <div className="rounded-[1.45rem] border border-border/80 bg-card/84 p-4 shadow-card">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                          Progress
                        </div>
                        <div className="mt-1 text-base font-semibold text-foreground">
                          Step {step} of 4
                        </div>
                      </div>
                      <div className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
                        {Math.round((step / 4) * 100)}%
                      </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      {stepOrder.map((item) => (
                        <div
                          key={item}
                          className={cn(
                            "h-2 flex-1 rounded-full transition-colors",
                            item < step
                              ? "bg-emerald-500"
                              : item === step
                                ? "bg-primary"
                                : "bg-border"
                          )}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {stepOrder.map((item) => {
                      const detail = stepDetails[item];
                      const Icon = detail.icon;
                      const isCurrent = item === step;
                      const isDone = item < step;
                      return (
                        <div
                          key={item}
                          className={cn(
                            "rounded-[1.35rem] border px-4 py-4 transition-colors",
                            isCurrent
                              ? "border-primary/16 bg-[color-mix(in_oklab,var(--primary)_9%,white)]"
                              : isDone
                                ? "border-emerald-300/55 bg-emerald-50/60"
                                : "border-border/80 bg-card/76"
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={cn(
                                "rounded-[1rem] border p-2",
                                isCurrent
                                  ? "border-primary/12 bg-white text-primary"
                                  : isDone
                                    ? "border-emerald-300/55 bg-white text-emerald-700"
                                    : "border-border bg-background text-muted-foreground"
                              )}
                            >
                              {isDone ? (
                                <Check className="h-4 w-4" />
                              ) : (
                                <Icon className="h-4 w-4" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                Step {item}
                              </div>
                              <div className="mt-1 text-sm font-semibold text-foreground">
                                {detail.title}
                              </div>
                              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                                {detail.description}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-[1.45rem] border border-border/80 bg-card/84 p-4 shadow-card">
                    <div className="text-sm font-semibold text-foreground">Setup context</div>
                    <div className="mt-4 grid gap-3">
                      <div className="rounded-[1rem] border border-border bg-background/75 px-3 py-3">
                        <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                          Company
                        </div>
                        <div className="mt-1 text-sm font-semibold text-foreground">
                          {companyName.trim() || "New company"}
                        </div>
                      </div>
                      <div className="rounded-[1rem] border border-border bg-background/75 px-3 py-3">
                        <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                          Blueprint
                        </div>
                        <div className="mt-1 text-sm font-semibold text-foreground">
                          {selectedTeamBlueprint?.label ?? "Choose a starting team"}
                        </div>
                      </div>
                      <div className="rounded-[1rem] border border-border bg-background/75 px-3 py-3">
                        <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                          Workspace
                        </div>
                        <div className="mt-1 text-sm font-semibold text-foreground">
                          {contextWorkspaceLabel}
                        </div>
                      </div>
                      <div className="rounded-[1rem] border border-border bg-background/75 px-3 py-3">
                        <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                          Quick request
                        </div>
                        <div className="mt-1 text-sm font-semibold text-foreground">
                          {quickRequestTitle.trim() || "First quick request"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.45rem] border border-border/80 bg-card/84 p-4 shadow-card">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Operator note
                    </div>
                    <div className="mt-2 text-sm leading-6 text-muted-foreground">
                      {currentStepDetail.note}
                    </div>
                    <div className="mt-4 rounded-[1rem] border border-border bg-background/75 px-3 py-3 text-sm text-muted-foreground">
                      Use{" "}
                      <span className="font-['IBM_Plex_Mono'] text-[12px] text-foreground">
                        Cmd/Ctrl + Enter
                      </span>{" "}
                      to continue from the current step.
                    </div>
                  </div>
                </div>
              </aside>

              <section className="relative flex min-h-0 flex-col bg-[linear-gradient(180deg,color-mix(in_oklab,var(--background)_97%,white),color-mix(in_oklab,var(--card)_94%,white))]">
                <button
                  onClick={handleClose}
                  aria-label="Close setup"
                  className="absolute right-5 top-5 z-10 rounded-full border border-border bg-background/88 p-2 text-muted-foreground transition-colors hover:border-primary/16 hover:bg-card hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>

                <div className="border-b border-border/80 px-6 py-6 pr-16 md:px-8 md:py-7">
                  <div className="lg:hidden">
                    <ProductWordmark />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-primary/10 bg-primary/8 px-3 py-1 text-[11px] font-medium tracking-[0.1em] text-primary/84">
                      {currentStepDetail.eyebrow}
                    </span>
                    <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                      Step {step} of 4
                    </span>
                  </div>
                  <div className="mt-5 flex items-start gap-4">
                    <div className="rounded-[1.15rem] border border-primary/10 bg-primary/8 p-3 text-primary">
                      <CurrentStepIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-3xl font-semibold tracking-[-0.05em] text-foreground md:text-[2.4rem]">
                        {currentStepDetail.title}
                      </h2>
                      <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground md:text-[0.98rem]">
                        {currentStepDetail.description}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-8">
                  <div className="mx-auto max-w-3xl space-y-6 pb-6">
                    {step === 1 && (
                      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                        <section className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                          <div className="flex items-start gap-3">
                            <div className="rounded-[1rem] border border-primary/10 bg-primary/8 p-2 text-primary">
                              <Building2 className="h-5 w-5" />
                            </div>
                            <div>
                              <div className="text-lg font-semibold text-foreground">
                                Company identity
                              </div>
                              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                                Start with the tenant name and, if useful, a short operating goal that gives the first quick request context.
                              </div>
                            </div>
                          </div>

                          <div className="mt-5 space-y-4">
                            <div>
                              <label
                                htmlFor="onboarding-company-name"
                                className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground"
                              >
                                Company name
                              </label>
                              <input
                                id="onboarding-company-name"
                                className="w-full rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                placeholder="Acme Product"
                                value={companyName}
                                onChange={(event) => setCompanyName(event.target.value)}
                                autoFocus
                              />
                            </div>
                            <div>
                              <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                Operating goal
                              </label>
                              <textarea
                                className="min-h-[128px] w-full resize-none rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                placeholder="Optional: what should this company optimize for in the first setup pass?"
                                value={companyGoal}
                                onChange={(event) => setCompanyGoal(event.target.value)}
                              />
                            </div>
                          </div>
                        </section>

                        <section className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                          <div className="text-lg font-semibold text-foreground">
                            What this flow will do
                          </div>
                          <div className="mt-2 text-sm leading-6 text-muted-foreground">
                            The first-run experience now follows the actual product north star: shape the team first, attach a real workspace, then start from a quick request.
                          </div>
                          <div className="mt-5 grid gap-3">
                            <InfoCard
                              title="Reusable team shape"
                              description="The next step applies a generic delivery blueprint instead of hand-creating a CEO lane."
                            />
                            <InfoCard
                              title="Primary workspace"
                              description="Execution engine selection and workspace connection become explicit before any delivery issue is created."
                            />
                            <InfoCard
                              title="Quick request intake"
                              description="The first issue is a PM intake request, not a legacy placeholder implementation task."
                            />
                          </div>
                        </section>
                      </div>
                    )}

                    {step === 2 && (
                      <div className="space-y-6">
                        <section className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-lg font-semibold text-foreground">
                                Team blueprint catalog
                              </div>
                              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                                Preview and apply a reusable PM-ready starting team before wiring workspaces or creating the first quick request.
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-full"
                              disabled={
                                !selectedTeamBlueprint ||
                                teamBlueprintPreviewMutation.isPending ||
                                teamBlueprintApplyMutation.isPending
                              }
                              onClick={() => void handleGenerateBlueprintPreview()}
                            >
                              {teamBlueprintPreviewMutation.isPending
                                ? "Generating preview..."
                                : canonicalAbsorptionPrep &&
                                    selectedTeamBlueprint?.key === canonicalAbsorptionPrep.blueprintKey
                                  ? "Preview recommended mapping"
                                  : "Preview blueprint"}
                            </Button>
                          </div>

                          {canonicalAbsorptionPrep && selectedTeamBlueprint?.key === canonicalAbsorptionPrep.blueprintKey && (
                            <div className="mt-5 rounded-[1rem] border border-sky-300/70 bg-sky-50/80 px-4 py-4 text-sm text-sky-900">
                              <div className="font-semibold">Canonical absorption guidance</div>
                              <div className="mt-1 leading-6">
                                This company matches the legacy Swiftsight canonical org. Preview will use the recommended
                                blueprint expansion automatically: {canonicalAbsorptionPrep.previewRequest.projectCount ?? 0}
                                {" "}project slots and {canonicalAbsorptionPrep.previewRequest.engineerPairsPerProject ?? 0}
                                {" "}engineer pair(s) per project.
                              </div>
                              <ul className="mt-3 space-y-1 text-xs text-sky-800">
                                {canonicalAbsorptionPrep.projectMappings.map((mapping) => (
                                  <li key={mapping.canonicalProjectSlug}>
                                    • {mapping.canonicalProjectName} → {mapping.blueprintSlotKey}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {onboardingTeamBlueprints.length === 0 ? (
                            <div className="mt-5 rounded-[1rem] border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
                              No PM-ready blueprint is available yet. Use Company Settings to seed or repair the team catalog before onboarding the first quick request.
                            </div>
                          ) : (
                            <div className="mt-5 grid gap-3 md:grid-cols-3">
                              {onboardingTeamBlueprints.map((blueprint) => {
                                const active = blueprint.key === selectedTeamBlueprint?.key;
                                return (
                                  <button
                                    key={blueprint.key}
                                    type="button"
                                    onClick={() => {
                                      setSelectedTeamBlueprintKey(blueprint.key);
                                      setSelectedTeamBlueprintPreview(null);
                                      setTeamBlueprintApplyResult(null);
                                      setConfirmTeamBlueprintApply(false);
                                      setError(null);
                                    }}
                                    className={cn(
                                      "rounded-[1.25rem] border px-4 py-4 text-left transition-colors",
                                      active
                                        ? "border-primary/16 bg-[color-mix(in_oklab,var(--primary)_9%,white)]"
                                        : "border-border bg-background hover:border-primary/12 hover:bg-accent/32"
                                    )}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="text-sm font-semibold text-foreground">
                                        {blueprint.label}
                                      </div>
                                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                                        {blueprint.projects.length} project template(s)
                                      </span>
                                    </div>
                                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                      {blueprint.description}
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                      <span className="rounded-full border border-emerald-300/70 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                                        PM-ready
                                      </span>
                                      <span className="rounded-full border border-border px-2 py-0.5">
                                        default {blueprint.parameterHints.defaultProjectCount} project(s)
                                      </span>
                                      <span className="rounded-full border border-border px-2 py-0.5">
                                        {blueprint.roles.length} role template(s)
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </section>

                        {selectedTeamBlueprint && (
                          <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                            <div className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                              <div className="text-lg font-semibold text-foreground">
                                {selectedTeamBlueprint.label}
                              </div>
                              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                                {selectedTeamBlueprint.description}
                              </div>
                              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                                {selectedTeamBlueprint.projects.map((project) => (
                                  <InfoCard
                                    key={project.key}
                                    title={project.label}
                                    description={`${project.description ?? "Project slot"}${project.repositoryHint ? ` · ${project.repositoryHint}` : ""}`}
                                  />
                                ))}
                              </div>
                            </div>

                            <div className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                              <div className="text-lg font-semibold text-foreground">
                                Readiness expectations
                              </div>
                              <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                                <div>
                                  Required workspaces:{" "}
                                  <span className="font-medium text-foreground">
                                    {selectedTeamBlueprint.readiness.requiredWorkspaceCount}
                                  </span>
                                </div>
                                <div>
                                  Knowledge sources:{" "}
                                  <span className="font-medium text-foreground">
                                    {selectedTeamBlueprint.readiness.knowledgeSources.join(", ")}
                                  </span>
                                </div>
                                <div>
                                  Approval roles:{" "}
                                  <span className="font-medium text-foreground">
                                    {selectedTeamBlueprint.readiness.approvalRequiredRoleKeys.join(", ")}
                                  </span>
                                </div>
                              </div>
                              <div className="mt-4 rounded-[1rem] border border-border bg-background/75 px-4 py-4 text-sm text-muted-foreground">
                                Recommended first quick request:{" "}
                                <span className="font-medium text-foreground">
                                  {selectedTeamBlueprint.readiness.recommendedFirstQuickRequest}
                                </span>
                              </div>
                            </div>
                          </section>
                        )}

                        {quickRequestReadyFromExistingState && !teamBlueprintApplyResult && (
                          <section className="rounded-[1.35rem] border border-emerald-300/70 bg-emerald-50/70 px-4 py-4 text-sm text-emerald-900">
                            This company is already squad-ready with an active PM lane. You can continue with the existing team shape or preview and apply a new blueprint first.
                          </section>
                        )}

                        {setupReadyFromExistingState && !hasActivePmAgent && !teamBlueprintApplyResult && (
                          <section className="rounded-[1.35rem] border border-amber-300/70 bg-amber-50/80 px-4 py-4 text-sm text-amber-900">
                            This company is squad-ready, but it does not have an active PM lane for quick request intake yet. Apply a PM-ready blueprint before continuing.
                          </section>
                        )}

                        {selectedTeamBlueprintPreview && (
                          <section className="space-y-4 rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <div className="text-lg font-semibold text-foreground">
                                  Preview diff
                                </div>
                                <div className="mt-1 text-sm leading-6 text-muted-foreground">
                                  Review the project, role, and readiness diff before applying the blueprint to this company.
                                </div>
                              </div>
                              <div className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
                                hash {selectedTeamBlueprintPreview.previewHash.slice(0, 12)}...
                              </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-3">
                              <SummaryCard
                                label="Projects"
                                value={`${selectedTeamBlueprintPreview.summary.adoptedProjectCount} adopt / ${selectedTeamBlueprintPreview.summary.createProjectCount} create`}
                              />
                              <SummaryCard
                                label="Roles"
                                value={`${selectedTeamBlueprintPreview.summary.matchedRoleCount} matched / ${selectedTeamBlueprintPreview.summary.missingRoleCount} missing`}
                              />
                              <SummaryCard
                                label="Parameters"
                                value={`${selectedTeamBlueprintPreview.parameters.projectCount} project slot(s), ${selectedTeamBlueprintPreview.parameters.engineerPairsPerProject} engineer pair(s)`}
                              />
                            </div>

                            <div className="grid gap-4 lg:grid-cols-2">
                              <div className="space-y-2">
                                <div className="text-sm font-semibold text-foreground">
                                  Project diff
                                </div>
                                {selectedTeamBlueprintPreview.projectDiff.map((project) => (
                                  <div
                                    key={project.slotKey}
                                    className="rounded-[1rem] border border-border px-4 py-4 text-sm"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="font-medium text-foreground">
                                        {project.label}
                                      </div>
                                      <span
                                        className={cn(
                                          "rounded-full border px-2 py-0.5 text-[11px]",
                                          project.status === "adopt_existing"
                                            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                            : "border-amber-300 bg-amber-50 text-amber-700"
                                        )}
                                      >
                                        {project.status === "adopt_existing"
                                          ? "Adopt existing"
                                          : "Create new"}
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
                                <div className="text-sm font-semibold text-foreground">
                                  Role coverage
                                </div>
                                {selectedTeamBlueprintPreview.roleDiff.map((role) => (
                                  <div
                                    key={`${role.templateKey}-${role.label}`}
                                    className="rounded-[1rem] border border-border px-4 py-4 text-sm"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="font-medium text-foreground">
                                        {role.label}
                                      </div>
                                      <span
                                        className={cn(
                                          "rounded-full border px-2 py-0.5 text-[11px]",
                                          blueprintStatusTone(role.status)
                                        )}
                                      >
                                        {role.status}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {role.existingCount}/{role.requiredCount} matched
                                      {role.matchingAgentNames.length > 0
                                        ? ` · ${role.matchingAgentNames.join(", ")}`
                                        : ""}
                                    </div>
                                    {role.notes.length > 0 && (
                                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                                        {role.notes.map((note) => (
                                          <li key={note}>• {note}</li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <div className="text-sm font-semibold text-foreground">
                                Readiness checks
                              </div>
                              <div className="grid gap-2 md:grid-cols-2">
                                {selectedTeamBlueprintPreview.readinessChecks.map((check) => (
                                  <div
                                    key={check.key}
                                    className={cn(
                                      "rounded-[1rem] border px-4 py-4 text-sm",
                                      blueprintStatusTone(check.status)
                                    )}
                                  >
                                    <div className="font-medium">{check.label}</div>
                                    <div className="mt-1 text-xs">{check.detail}</div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {selectedTeamBlueprintPreview.warnings.length > 0 && (
                              <div className="rounded-[1rem] border border-amber-300/70 bg-amber-50/80 px-4 py-4">
                                <div className="text-sm font-semibold text-amber-900">
                                  Preview warnings
                                </div>
                                <ul className="mt-2 space-y-1 text-xs text-amber-800">
                                  {selectedTeamBlueprintPreview.warnings.map((warning) => (
                                    <li key={warning}>• {warning}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            <div className="rounded-[1rem] border border-border bg-background/75 px-4 py-4">
                              <label className="flex items-start gap-3 text-sm text-foreground">
                                <input
                                  type="checkbox"
                                  checked={confirmTeamBlueprintApply}
                                  onChange={(event) =>
                                    setConfirmTeamBlueprintApply(event.target.checked)
                                  }
                                  className="mt-0.5 h-4 w-4 rounded border-border"
                                />
                                <span>
                                  I reviewed this preview diff and want to apply the current team blueprint to this company.
                                </span>
                              </label>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  className="rounded-full"
                                  disabled={
                                    !confirmTeamBlueprintApply ||
                                    teamBlueprintApplyMutation.isPending
                                  }
                                  onClick={() => void handleApplyTeamBlueprint()}
                                >
                                  {teamBlueprintApplyMutation.isPending
                                    ? "Applying blueprint..."
                                    : "Apply team blueprint"}
                                </Button>
                                <span className="text-xs text-muted-foreground">
                                  Apply uses the current preview hash and will be rejected if company state drifts first.
                                </span>
                              </div>
                            </div>
                          </section>
                        )}

                        {teamBlueprintApplyResult && (
                          <section className="space-y-3 rounded-[1.35rem] border border-emerald-300/70 bg-emerald-50/80 px-4 py-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-sm font-semibold text-emerald-900">
                                  Team blueprint applied
                                </div>
                                <div className="text-xs text-emerald-800">
                                  Preview hash {teamBlueprintApplyResult.previewHash.slice(0, 12)}... applied successfully.
                                </div>
                              </div>
                              <span className="rounded-full border border-emerald-300 px-2 py-0.5 text-[11px] text-emerald-900">
                                {teamBlueprintApplyResult.blueprintKey}
                              </span>
                            </div>
                            <div className="grid gap-2 md:grid-cols-3">
                              <SummaryCard
                                label="Projects"
                                value={`${teamBlueprintApplyResult.summary.adoptedProjectCount} adopt / ${teamBlueprintApplyResult.summary.createdProjectCount} create`}
                                tone="success"
                              />
                              <SummaryCard
                                label="Agents"
                                value={`${teamBlueprintApplyResult.summary.adoptedAgentCount} adopt / ${teamBlueprintApplyResult.summary.createdAgentCount} create / ${teamBlueprintApplyResult.summary.updatedAgentCount} update`}
                                tone="success"
                              />
                              <SummaryCard
                                label="Role packs"
                                value={`${teamBlueprintApplyResult.summary.seededRolePackCount} seeded / ${teamBlueprintApplyResult.summary.existingRolePackCount} existing`}
                                tone="success"
                              />
                            </div>
                          </section>
                        )}
                      </div>
                    )}

                    {step === 3 && (
                      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                        <section className="space-y-6 rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                          <div>
                            <div className="text-lg font-semibold text-foreground">
                              Execution engine
                            </div>
                            <div className="mt-1 text-sm leading-6 text-muted-foreground">
                              Select the primary engine for this company and verify that the chosen workspace can run it cleanly.
                            </div>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            {ONBOARDING_ADAPTER_OPTIONS.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                  setAdapterType(option.value);
                                  if (option.value === "codex_local" && !model) {
                                    setModel(DEFAULT_CODEX_LOCAL_MODEL);
                                  }
                                }}
                                className={cn(
                                  "relative rounded-[1.2rem] border px-4 py-4 text-left transition-colors",
                                  adapterType === option.value
                                    ? "border-primary/16 bg-[color-mix(in_oklab,var(--primary)_9%,white)]"
                                    : "border-border bg-background hover:border-primary/12 hover:bg-accent/32"
                                )}
                              >
                                {option.recommended && (
                                  <span className="absolute right-3 top-3 rounded-full border border-emerald-300/60 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                    Recommended
                                  </span>
                                )}
                                <div className="w-fit rounded-[0.95rem] border border-primary/10 bg-primary/8 p-2 text-primary">
                                  <option.icon className="h-4 w-4" />
                                </div>
                                <div className="mt-3 text-sm font-semibold text-foreground">
                                  {option.label}
                                </div>
                                <div className="mt-1 text-sm text-muted-foreground">
                                  {option.desc}
                                </div>
                              </button>
                            ))}
                          </div>

                          <div>
                            <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                              Model
                            </label>
                            <Popover open={modelOpen} onOpenChange={setModelOpen}>
                              <PopoverTrigger asChild>
                                <button className="inline-flex w-full items-center justify-between gap-1.5 rounded-[1rem] border border-border bg-background px-4 py-3 text-sm transition-colors hover:bg-accent/32">
                                  <span className={cn(!model && "text-muted-foreground")}>
                                    {selectedModel ? selectedModel.label : model || "Default"}
                                  </span>
                                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-[var(--radix-popover-trigger-width)] rounded-[1rem] border-border p-1"
                                align="start"
                              >
                                <button
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded-[0.8rem] px-2.5 py-2 text-sm hover:bg-accent/50",
                                    !model && "bg-accent"
                                  )}
                                  onClick={() => {
                                    setModel("");
                                    setModelOpen(false);
                                  }}
                                >
                                  Default
                                </button>
                                {(adapterModels ?? []).map((entry) => (
                                  <button
                                    key={entry.id}
                                    className={cn(
                                      "flex w-full items-center justify-between rounded-[0.8rem] px-2.5 py-2 text-sm hover:bg-accent/50",
                                      entry.id === model && "bg-accent"
                                    )}
                                    onClick={() => {
                                      setModel(entry.id);
                                      setModelOpen(false);
                                    }}
                                  >
                                    <span>{entry.label}</span>
                                    <span className="font-mono text-xs text-muted-foreground">
                                      {entry.id}
                                    </span>
                                  </button>
                                ))}
                              </PopoverContent>
                            </Popover>
                          </div>

                          <div className="rounded-[1rem] border border-border bg-background/75 px-4 py-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-foreground">
                                  Adapter environment check
                                </div>
                                <div className="mt-1 text-sm leading-6 text-muted-foreground">
                                  Run a live probe with the selected engine and workspace path before the first request goes live.
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-full"
                                disabled={adapterEnvLoading}
                                onClick={() => void runAdapterEnvironmentTest()}
                              >
                                {adapterEnvLoading ? "Testing..." : "Test now"}
                              </Button>
                            </div>

                            <div className="mt-4 space-y-3">
                              {adapterEnvError && (
                                <div className="rounded-[1rem] border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                                  {adapterEnvError}
                                </div>
                              )}
                              {adapterEnvResult && (
                                <AdapterEnvironmentResult result={adapterEnvResult} />
                              )}
                              {shouldSuggestUnsetAnthropicApiKey && (
                                <div className="rounded-[1rem] border border-amber-300/60 bg-amber-50/55 px-4 py-4">
                                  <p className="text-sm leading-6 text-amber-900/90">
                                    Claude failed while{" "}
                                    <span className="font-mono">ANTHROPIC_API_KEY</span> is set.
                                    Clear it from this adapter config and retry the probe.
                                  </p>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-3 rounded-full"
                                    disabled={adapterEnvLoading || unsetAnthropicLoading}
                                    onClick={() => void handleUnsetAnthropicApiKey()}
                                  >
                                    {unsetAnthropicLoading
                                      ? "Retrying..."
                                      : "Unset ANTHROPIC_API_KEY"}
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        </section>

                        <section className="space-y-6 rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                          <div>
                            <div className="text-lg font-semibold text-foreground">
                              Primary workspace
                            </div>
                            <div className="mt-1 text-sm leading-6 text-muted-foreground">
                              Choose the project this company should start from, then connect the primary workspace used by doctor checks and future implementation runs.
                            </div>
                          </div>

                          {projects.length === 0 ? (
                            <div className="rounded-[1rem] border border-amber-300/60 bg-amber-50/70 px-4 py-4 text-sm text-amber-900">
                              Apply a team blueprint first so the onboarding flow has project slots to connect.
                            </div>
                          ) : (
                            <div className="space-y-4">
                              <div>
                                <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                  Project
                                </label>
                                <select
                                  className="w-full rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                  value={selectedProjectId}
                                  onChange={(event) => setSelectedProjectId(event.target.value)}
                                >
                                  <option value="">Select a project</option>
                                  {projects.map((project) => (
                                    <option key={project.id} value={project.id}>
                                      {project.name}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {currentProject && (
                                <>
                                  <div>
                                    <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                      Workspace target
                                    </label>
                                    <select
                                      className="w-full rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                      value={workspaceSelectionId}
                                      onChange={(event) =>
                                        setWorkspaceSelectionId(event.target.value)
                                      }
                                    >
                                      {currentProject.workspaces.map((workspace) => (
                                        <option key={workspace.id} value={workspace.id}>
                                          Use existing · {workspace.name}
                                        </option>
                                      ))}
                                      <option value={NEW_WORKSPACE_OPTION}>
                                        Create a new workspace
                                      </option>
                                    </select>
                                  </div>

                                  {isCreatingWorkspace ? (
                                    <div className="space-y-4 rounded-[1rem] border border-border bg-background/75 px-4 py-4">
                                      <div>
                                        <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                          Workspace name
                                        </label>
                                        <input
                                          className="w-full rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                          value={workspaceName}
                                          onChange={(event) => setWorkspaceName(event.target.value)}
                                          placeholder={`${currentProject.name} Workspace`}
                                        />
                                      </div>
                                      <div>
                                        <div className="mb-2 flex items-center gap-1.5">
                                          <label className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                            Working directory
                                          </label>
                                          <HintIcon text="Local filesystem path used for primary implementation runs. You can also leave this empty and connect the repository URL only." />
                                        </div>
                                        <div className="flex items-center gap-2 rounded-[1rem] border border-border bg-background px-3 py-2.5">
                                          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                                          <input
                                            className="w-full bg-transparent text-sm font-mono outline-none placeholder:text-muted-foreground/50"
                                            placeholder="/path/to/project"
                                            value={workspaceCwd}
                                            onChange={(event) => setWorkspaceCwd(event.target.value)}
                                          />
                                          <ChoosePathButton />
                                        </div>
                                      </div>
                                      <div>
                                        <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                          Repository URL
                                        </label>
                                        <input
                                          className="w-full rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                          placeholder="https://github.com/org/repo"
                                          value={workspaceRepoUrl}
                                          onChange={(event) =>
                                            setWorkspaceRepoUrl(event.target.value)
                                          }
                                        />
                                      </div>
                                    </div>
                                  ) : selectedWorkspace ? (
                                    <div className="rounded-[1rem] border border-border bg-background/75 px-4 py-4 text-sm text-muted-foreground">
                                      <div className="font-semibold text-foreground">
                                        {selectedWorkspace.name}
                                      </div>
                                      <div className="mt-2 space-y-1">
                                        <div>
                                          Path:{" "}
                                          <span className="font-mono text-xs text-foreground">
                                            {selectedWorkspace.cwd ?? "not set"}
                                          </span>
                                        </div>
                                        <div>
                                          Repo:{" "}
                                          <span className="font-mono text-xs text-foreground">
                                            {selectedWorkspace.repoUrl ?? "not set"}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </div>
                          )}
                        </section>
                      </div>
                    )}

                    {step === 4 && (
                      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                        <section className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                          <div>
                            <div className="text-lg font-semibold text-foreground">
                              First quick request
                            </div>
                            <div className="mt-1 text-sm leading-6 text-muted-foreground">
                              Keep the input short and execution-ready. PM structuring and clarification can expand it later.
                            </div>
                          </div>
                          <div className="mt-5 space-y-4">
                            <div>
                              <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                Optional title
                              </label>
                              <input
                                className="w-full rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                placeholder="Optional: concise operating title"
                                value={quickRequestTitle}
                                onChange={(event) => setQuickRequestTitle(event.target.value)}
                                autoFocus
                              />
                            </div>
                            <div>
                              <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                Request
                              </label>
                              <textarea
                                ref={quickRequestRef}
                                className="min-h-[220px] max-h-[360px] w-full resize-none overflow-y-auto rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                placeholder="Describe the goal, why it matters, and any obvious constraints."
                                value={quickRequest}
                                onChange={(event) => {
                                  setQuickRequest(event.target.value);
                                  setQuickRequestTouched(true);
                                }}
                              />
                            </div>
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                  Priority
                                </label>
                                <select
                                  className="w-full rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                  value={quickRequestPriority}
                                  onChange={(event) =>
                                    setQuickRequestPriority(event.target.value as IssuePriority)
                                  }
                                >
                                  {QUICK_REQUEST_PRIORITY_OPTIONS.map((priority) => (
                                    <option key={priority} value={priority}>
                                      {titleCasePriority(priority)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                  Target project
                                </label>
                                <div className="rounded-[1rem] border border-border bg-background px-4 py-3 text-sm text-foreground">
                                  {currentProject?.name ?? "No project selected"}
                                </div>
                              </div>
                            </div>
                          </div>
                        </section>

                        <section className="space-y-6 rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                          <div>
                            <div className="text-lg font-semibold text-foreground">
                              Input contract
                            </div>
                            <div className="mt-1 text-sm leading-6 text-muted-foreground">
                              The first request should be short, but still meaningful enough for PM structuring to route and decompose.
                            </div>
                          </div>
                          <div className="grid gap-3">
                            <InfoCard
                              title="Say what matters"
                              description="Include the goal, why it matters now, and the rough delivery boundary."
                            />
                            <InfoCard
                              title="Leave room for clarification"
                              description="Do not overfit the input. If the team needs more information, it should come back with a targeted question."
                            />
                            <InfoCard
                              title="Keep it real"
                              description="Treat this like the first real request you would hand to a PM or lead, not a demo task."
                            />
                          </div>
                          <div className="rounded-[1rem] border border-border bg-background/75 px-4 py-4 text-sm text-muted-foreground">
                            Recommended starting point:{" "}
                            <span className="font-medium text-foreground">
                              {selectedTeamBlueprint?.readiness.recommendedFirstQuickRequest ??
                                "Start with a concrete product or platform delivery request."}
                            </span>
                          </div>
                          <div className="rounded-[1rem] border border-border bg-background/75 px-4 py-4 text-sm text-muted-foreground">
                            Connected workspace:{" "}
                            <span className="font-medium text-foreground">
                              {contextWorkspaceLabel}
                            </span>
                            <br />
                            Selected engine:{" "}
                            <span className="font-medium text-foreground">
                              {getUIAdapter(adapterType).label}
                            </span>
                          </div>
                        </section>
                      </div>
                    )}

                    {error && (
                      <div className="rounded-[1rem] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {error}
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-border/80 px-6 py-4 md:px-8">
                  <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
                    <div>
                      {step > 1 && step > (onboardingOptions.initialStep ?? 1) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-full"
                          onClick={() => setStep((step - 1) as Step)}
                          disabled={loading || teamBlueprintApplyMutation.isPending}
                        >
                          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                          Back
                        </Button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {step === 1 && (
                        <Button
                          size="sm"
                          className="rounded-full"
                          disabled={!companyName.trim() || loading}
                          onClick={handleStep1Next}
                        >
                          {loading ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          {loading ? "Creating..." : "Continue"}
                        </Button>
                      )}
                      {step === 2 && (
                        <Button
                          size="sm"
                          className="rounded-full"
                          disabled={
                            !canContinueBlueprintStep ||
                            loading ||
                            teamBlueprintPreviewMutation.isPending ||
                            teamBlueprintApplyMutation.isPending
                          }
                          onClick={() => void handleStep2Next()}
                        >
                          <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                          Continue
                        </Button>
                      )}
                      {step === 3 && (
                        <Button
                          size="sm"
                          className="rounded-full"
                          disabled={
                            !currentProject ||
                            loading ||
                            adapterEnvLoading ||
                            teamBlueprintApplyMutation.isPending
                          }
                          onClick={() => void handleStep3Next()}
                        >
                          {loading ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          {loading ? "Saving..." : "Continue"}
                        </Button>
                      )}
                      {step === 4 && (
                        <Button
                          size="sm"
                          className="rounded-full"
                          disabled={!quickRequest.trim() || loading}
                          onClick={() => void handleStep4Next()}
                        >
                          {loading ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <GitBranch className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          {loading ? "Creating..." : "Create quick request"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </DialogPortal>
    </Dialog>
  );
}

function InfoCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[1rem] border border-border bg-background/76 px-4 py-4">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-1 text-sm leading-6 text-muted-foreground">
        {description}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success";
}) {
  return (
    <div
      className={cn(
        "rounded-[1rem] border px-3 py-3 text-sm",
        tone === "success"
          ? "border-emerald-200 bg-white/70"
          : "border-border"
      )}
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 font-medium text-foreground">{value}</div>
    </div>
  );
}

function AdapterEnvironmentResult({
  result,
}: {
  result: AdapterEnvironmentTestResult;
}) {
  const statusLabel =
    result.status === "pass"
      ? "Passed"
      : result.status === "warn"
        ? "Warnings"
        : "Failed";
  const statusClass =
    result.status === "pass"
      ? "text-green-700 dark:text-green-300 border-green-300 dark:border-green-500/40 bg-green-50 dark:bg-green-500/10"
      : result.status === "warn"
        ? "text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10"
        : "text-red-700 dark:text-red-300 border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10";

  return (
    <div className={`rounded-md border px-2.5 py-2 text-[11px] ${statusClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{statusLabel}</span>
        <span className="opacity-80">
          {new Date(result.testedAt).toLocaleTimeString()}
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        {result.checks.map((check, idx) => (
          <div
            key={`${check.code}-${idx}`}
            className="leading-relaxed break-words"
          >
            <span className="font-medium uppercase tracking-wide opacity-80">
              {check.level}
            </span>
            <span className="mx-1 opacity-60">·</span>
            <span>{check.message}</span>
            {check.detail && (
              <span className="block opacity-75 break-all">
                ({check.detail})
              </span>
            )}
            {check.hint && (
              <span className="block opacity-90 break-words">
                Hint: {check.hint}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
