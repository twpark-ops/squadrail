import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdapterEnvironmentTestResult, RolePackPresetDescriptor, RolePackPresetKey } from "@squadrail/shared";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { companiesApi } from "../api/companies";
import { goalsApi } from "../api/goals";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { knowledgeApi } from "../api/knowledge";
import { queryKeys } from "../lib/queryKeys";
import { appRoutes } from "../lib/appRoutes";
import { Dialog, DialogPortal } from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";
import { getUIAdapter } from "../adapters";
import { defaultCreateValues } from "./agent-config-defaults";
import {
  DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
  DEFAULT_CODEX_LOCAL_MODEL
} from "@squadrail/adapter-codex-local";
import { ChoosePathButton } from "./PathInstructionsModal";
import { HintIcon } from "./agent-config-primitives";
import { ProductWordmark } from "./ProductWordmark";
import {
  Building2,
  Bot,
  Code,
  ListTodo,
  Rocket,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Check,
  Loader2,
  FolderOpen,
  ChevronDown,
  X
} from "lucide-react";

type Step = 1 | 2 | 3 | 4;
type AdapterType =
  | "claude_local"
  | "codex_local";

const DEFAULT_ROLE_PACK_PRESET_KEY: RolePackPresetKey = "squadrail_default_v1";
const DEFAULT_TASK_TITLE = "Review squad setup and prepare the first delivery plan";
const DEFAULT_TASK_DESCRIPTION = [
  "Review the seeded Tech Lead, Engineer, and Reviewer role packs for this company.",
  "Confirm the selected execution engine and working directory are ready for real implementation work.",
  "Then write the first implementation plan with explicit acceptance criteria, reviewer ownership, and blockers.",
].join("\n\n");

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
    icon: Code,
    desc: "Primary local execution engine",
    recommended: false,
  },
];

export function OnboardingWizard() {
  const { onboardingOpen, onboardingOptions, closeOnboarding } = useDialog();
  const { companies, setSelectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const initialStep = onboardingOptions.initialStep ?? 1;
  const existingCompanyId = onboardingOptions.companyId;

  const [step, setStep] = useState<Step>(initialStep);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);

  // Step 1
  const [companyName, setCompanyName] = useState("");
  const [companyGoal, setCompanyGoal] = useState("");

  // Step 2
  const [agentName, setAgentName] = useState("CEO");
  const [adapterType, setAdapterType] = useState<AdapterType>("claude_local");
  const [cwd, setCwd] = useState("");
  const [model, setModel] = useState("");
  const [setupWorkspaceId, setSetupWorkspaceId] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [adapterEnvResult, setAdapterEnvResult] =
    useState<AdapterEnvironmentTestResult | null>(null);
  const [adapterEnvError, setAdapterEnvError] = useState<string | null>(null);
  const [adapterEnvLoading, setAdapterEnvLoading] = useState(false);
  const [forceUnsetAnthropicApiKey, setForceUnsetAnthropicApiKey] =
    useState(false);
  const [unsetAnthropicLoading, setUnsetAnthropicLoading] = useState(false);
  const [selectedRolePackPresetKey, setSelectedRolePackPresetKey] = useState<RolePackPresetKey>(DEFAULT_ROLE_PACK_PRESET_KEY);

  // Step 3
  const [taskTitle, setTaskTitle] = useState(DEFAULT_TASK_TITLE);
  const [taskDescription, setTaskDescription] = useState(DEFAULT_TASK_DESCRIPTION);

  // Auto-grow textarea for task description
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, []);

  // Created entity IDs — pre-populate from existing company when skipping step 1
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(
    existingCompanyId ?? null
  );
  const [createdCompanyPrefix, setCreatedCompanyPrefix] = useState<
    string | null
  >(null);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [createdIssueRef, setCreatedIssueRef] = useState<string | null>(null);

  // Sync step and company when onboarding opens with options.
  // Keep this independent from company-list refreshes so Step 1 completion
  // doesn't get reset after creating a company.
  useEffect(() => {
    if (!onboardingOpen) return;
    const cId = onboardingOptions.companyId ?? null;
    setStep(onboardingOptions.initialStep ?? 1);
    setCreatedCompanyId(cId);
    setCreatedCompanyPrefix(null);
    setSelectedRolePackPresetKey(DEFAULT_ROLE_PACK_PRESET_KEY);
  }, [
    onboardingOpen,
    onboardingOptions.companyId,
    onboardingOptions.initialStep
  ]);

  // Backfill issue prefix for an existing company once companies are loaded.
  useEffect(() => {
    if (!onboardingOpen || !createdCompanyId || createdCompanyPrefix) return;
    const company = companies.find((c) => c.id === createdCompanyId);
    if (company) {
      setCreatedCompanyPrefix(company.issuePrefix);
      if (!companyName.trim()) setCompanyName(company.name);
    }
  }, [onboardingOpen, createdCompanyId, createdCompanyPrefix, companies]);

  // Resize textarea when step 3 is shown or description changes
  useEffect(() => {
    if (step === 3) autoResizeTextarea();
  }, [step, taskDescription, autoResizeTextarea]);

  const { data: adapterModels } = useQuery({
    queryKey: ["adapter-models", adapterType],
    queryFn: () => agentsApi.adapterModels(adapterType),
    enabled: onboardingOpen && step === 2
  });
  const { data: setupProgress } = useQuery({
    queryKey: createdCompanyId
      ? queryKeys.companies.setupProgress(createdCompanyId)
      : ["companies", "__none__", "setup-progress"],
    queryFn: () => companiesApi.getSetupProgress(createdCompanyId!),
    enabled: onboardingOpen && Boolean(createdCompanyId),
  });
  const { data: rolePackPresets = [] } = useQuery({
    queryKey: queryKeys.companies.rolePackPresets,
    queryFn: () => companiesApi.listRolePackPresets(),
    enabled: onboardingOpen,
  });
  const { data: rolePacks = [] } = useQuery({
    queryKey: createdCompanyId
      ? queryKeys.companies.rolePacks(createdCompanyId)
      : ["companies", "__none__", "role-packs"],
    queryFn: () => companiesApi.listRolePacks(createdCompanyId!),
    enabled: onboardingOpen && Boolean(createdCompanyId),
  });
  const { data: projects = [] } = useQuery({
    queryKey: createdCompanyId
      ? queryKeys.projects.list(createdCompanyId)
      : ["projects", "__none__"],
    queryFn: () => projectsApi.list(createdCompanyId!),
    enabled: onboardingOpen && step === 2 && Boolean(createdCompanyId),
  });
  const { data: doctorReport, refetch: refetchDoctor } = useQuery({
    queryKey: createdCompanyId
      ? queryKeys.companies.doctor(
          createdCompanyId,
          false,
          setupProgress?.selectedWorkspaceId ?? undefined
        )
      : ["companies", "__none__", "doctor"],
    queryFn: () =>
      companiesApi.getDoctorReport(createdCompanyId!, {
        workspaceId: setupProgress?.selectedWorkspaceId ?? undefined,
      }),
    enabled: onboardingOpen && step === 4 && Boolean(createdCompanyId),
  });
  const workspaces = useMemo(
    () =>
      projects.flatMap((project) =>
        project.workspaces.map((workspace) => ({
          ...workspace,
          projectId: project.id,
          projectName: project.name,
        }))
      ),
    [projects]
  );
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === setupWorkspaceId) ??
    workspaces.find((workspace) => workspace.id === setupProgress?.selectedWorkspaceId) ??
    null;
  const isLocalAdapter =
    adapterType === "claude_local" || adapterType === "codex_local";
  const effectiveAdapterCommand =
    command.trim() ||
    (adapterType === "codex_local" ? "codex" : "claude");

  useEffect(() => {
    if (step !== 2) return;
    setAdapterEnvResult(null);
    setAdapterEnvError(null);
  }, [step, adapterType, cwd, model, command, args, url]);

  useEffect(() => {
    if (!setupProgress) return;
    if (!setupWorkspaceId && setupProgress.selectedWorkspaceId) {
      setSetupWorkspaceId(setupProgress.selectedWorkspaceId);
    }
    if (!setupProgress.selectedEngine) return;
    if (setupProgress.selectedEngine === "claude_local" || setupProgress.selectedEngine === "codex_local") {
      setAdapterType(setupProgress.selectedEngine);
    }
  }, [setupProgress, setupWorkspaceId]);

  const selectedModel = (adapterModels ?? []).find((m) => m.id === model);
  const hasAnthropicApiKeyOverrideCheck =
    adapterEnvResult?.checks.some(
      (check) =>
        check.code === "claude_anthropic_api_key_overrides_subscription"
    ) ?? false;
  const shouldSuggestUnsetAnthropicApiKey =
    adapterType === "claude_local" &&
    adapterEnvResult?.status === "fail" &&
    hasAnthropicApiKeyOverrideCheck;
  const selectedRolePackPreset =
    rolePackPresets.find((preset) => preset.key === selectedRolePackPresetKey) ??
    ({
      key: DEFAULT_ROLE_PACK_PRESET_KEY,
      label: "Squadrail Default",
      description: "General-purpose delivery squad for protocol-first planning, implementation, and review.",
      recommended: true,
      starterTaskTitle: DEFAULT_TASK_TITLE,
      starterTaskDescription: DEFAULT_TASK_DESCRIPTION,
    } satisfies RolePackPresetDescriptor);
  const workspaceImport = useMutation({
    mutationFn: async () => {
      if (!selectedWorkspace) {
        throw new Error("Select a primary workspace before importing knowledge.");
      }
      return knowledgeApi.importProjectWorkspace(selectedWorkspace.projectId, {
        workspaceId: selectedWorkspace.id,
      });
    },
    onSuccess: async () => {
      if (!createdCompanyId) return;
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.setupProgress(createdCompanyId),
      });
      await queryClient.invalidateQueries({
        queryKey: ["companies", createdCompanyId, "doctor"],
      });
    },
  });

  function reset() {
    setStep(1);
    setLoading(false);
    setError(null);
    setCompanyName("");
    setCompanyGoal("");
    setAgentName("CEO");
    setAdapterType("claude_local");
    setCwd("");
    setModel("");
    setSetupWorkspaceId("");
    setCommand("");
    setArgs("");
    setUrl("");
    setAdapterEnvResult(null);
    setAdapterEnvError(null);
    setAdapterEnvLoading(false);
    setForceUnsetAnthropicApiKey(false);
    setUnsetAnthropicLoading(false);
    setSelectedRolePackPresetKey(DEFAULT_ROLE_PACK_PRESET_KEY);
    setTaskTitle(DEFAULT_TASK_TITLE);
    setTaskDescription(DEFAULT_TASK_DESCRIPTION);
    setCreatedCompanyId(null);
    setCreatedCompanyPrefix(null);
    setCreatedAgentId(null);
    setCreatedIssueRef(null);
  }

  function handleClose() {
    reset();
    closeOnboarding();
  }

  function buildAdapterConfig(): Record<string, unknown> {
    const adapter = getUIAdapter(adapterType);
    const config = adapter.buildAdapterConfig({
      ...defaultCreateValues,
      adapterType,
      cwd,
      model: adapterType === "codex_local" ? model || DEFAULT_CODEX_LOCAL_MODEL : model,
      command,
      args,
      url,
      dangerouslySkipPermissions: adapterType === "claude_local",
      dangerouslyBypassSandbox:
        adapterType === "codex_local"
          ? DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX
          : defaultCreateValues.dangerouslyBypassSandbox
    });
    if (adapterType === "claude_local" && forceUnsetAnthropicApiKey) {
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
    adapterConfigOverride?: Record<string, unknown>
  ): Promise<AdapterEnvironmentTestResult | null> {
    if (!createdCompanyId) {
      setAdapterEnvError(
        "Create or select a company before testing adapter environment."
      );
      return null;
    }
    setAdapterEnvLoading(true);
    setAdapterEnvError(null);
    try {
      const result = await agentsApi.testEnvironment(
        createdCompanyId,
        adapterType,
        {
          adapterConfig: adapterConfigOverride ?? buildAdapterConfig()
        }
      );
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

  async function handleStep1Next() {
    setLoading(true);
    setError(null);
    try {
      const company = await companiesApi.create({ name: companyName.trim() });
      setCreatedCompanyId(company.id);
      setCreatedCompanyPrefix(company.issuePrefix);
      setSelectedCompanyId(company.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.companies.setupProgress(company.id)
      });

      if (companyGoal.trim()) {
        await goalsApi.create(company.id, {
          title: companyGoal.trim(),
          level: "company",
          status: "active"
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.goals.list(company.id)
        });
      }

      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create company");
    } finally {
      setLoading(false);
    }
  }

  async function handleStep2Next() {
    if (!createdCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      if (isLocalAdapter) {
        const result = adapterEnvResult ?? (await runAdapterEnvironmentTest());
        if (!result) return;
      }

      if (!setupProgress?.steps.squadReady) {
        await companiesApi.seedDefaultRolePacks(createdCompanyId, {
          force: false,
          presetKey: selectedRolePackPresetKey,
        });
      }

      if (taskTitle === DEFAULT_TASK_TITLE && taskDescription === DEFAULT_TASK_DESCRIPTION) {
        setTaskTitle(selectedRolePackPreset.starterTaskTitle);
        setTaskDescription(selectedRolePackPreset.starterTaskDescription);
      }

      await companiesApi.updateSetupProgress(createdCompanyId, {
        selectedEngine:
          adapterType === "claude_local" || adapterType === "codex_local"
            ? adapterType
            : null,
        selectedWorkspaceId: setupWorkspaceId || null
      });

      const agent = await agentsApi.create(createdCompanyId, {
        name: agentName.trim(),
        role: "ceo",
        adapterType,
        adapterConfig: buildAdapterConfig(),
        runtimeConfig: {
          heartbeat: {
            enabled: true,
            intervalSec: 3600,
            wakeOnDemand: true,
            cooldownSec: 10,
            maxConcurrentRuns: 1
          }
        }
      });
      setCreatedAgentId(agent.id);
      queryClient.invalidateQueries({
        queryKey: queryKeys.agents.list(createdCompanyId)
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.companies.setupProgress(createdCompanyId)
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.companies.rolePacks(createdCompanyId)
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.companies.doctor(createdCompanyId)
      });
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnsetAnthropicApiKey() {
    if (!createdCompanyId || unsetAnthropicLoading) return;
    setUnsetAnthropicLoading(true);
    setError(null);
    setAdapterEnvError(null);
    setForceUnsetAnthropicApiKey(true);

    const configWithUnset = (() => {
      const config = buildAdapterConfig();
      const env =
        typeof config.env === "object" &&
        config.env !== null &&
        !Array.isArray(config.env)
          ? { ...(config.env as Record<string, unknown>) }
          : {};
      env.ANTHROPIC_API_KEY = { type: "plain", value: "" };
      config.env = env;
      return config;
    })();

    try {
      if (createdAgentId) {
        await agentsApi.update(
          createdAgentId,
          { adapterConfig: configWithUnset },
          createdCompanyId
        );
        queryClient.invalidateQueries({
          queryKey: queryKeys.agents.list(createdCompanyId)
        });
      }

      const result = await runAdapterEnvironmentTest(configWithUnset);
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
    if (!createdCompanyId || !createdAgentId) return;
    setLoading(true);
    setError(null);
    try {
      const issue = await issuesApi.create(createdCompanyId, {
        title: taskTitle.trim(),
        ...(taskDescription.trim()
          ? { description: taskDescription.trim() }
          : {}),
        assigneeAgentId: createdAgentId,
        status: "todo"
      });
      setCreatedIssueRef(issue.identifier ?? issue.id);
      queryClient.invalidateQueries({
        queryKey: queryKeys.issues.list(createdCompanyId)
      });
      await companiesApi.updateSetupProgress(createdCompanyId, {
        metadata: {
          firstIssueReady: true,
        },
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.companies.setupProgress(createdCompanyId)
      });
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setLoading(false);
    }
  }

  async function handleLaunch() {
    if (!createdAgentId) return;
    setLoading(true);
    setError(null);
    setLoading(false);
    reset();
    closeOnboarding();
    if (createdCompanyPrefix && createdIssueRef) {
      navigate(`/${createdCompanyPrefix}${appRoutes.work}/${createdIssueRef}`);
      return;
    }
    if (createdCompanyPrefix) {
      navigate(`/${createdCompanyPrefix}${appRoutes.overview}`);
      return;
    }
    navigate(appRoutes.overview);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (step === 1 && companyName.trim()) handleStep1Next();
      else if (step === 2 && agentName.trim()) handleStep2Next();
      else if (step === 3 && taskTitle.trim()) handleStep3Next();
      else if (step === 4) handleLaunch();
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
      icon: typeof Building2;
      note: string;
    }
  > = {
    1: {
      eyebrow: "Company setup",
      title: "Create the operating company",
      description: "Name the tenant, anchor the mission, and create the workspace that all delivery lanes will route through.",
      icon: Building2,
      note: "A short company name is enough. You can refine strategy and goals after setup.",
    },
    2: {
      eyebrow: "Execution engine",
      title: "Configure the first execution lane",
      description: "Pick the engine, connect a workspace, and seed the squad preset that will own the first real delivery flow.",
      icon: Bot,
      note: "You can revise engine, model, and workspace details later from company settings without rerunning setup.",
    },
    3: {
      eyebrow: "First delivery brief",
      title: "Launch the first squad task",
      description: "Start with a tight task that makes ownership, acceptance criteria, and reviewer expectations explicit.",
      icon: ListTodo,
      note: "Keep the first task narrow so the queue stays readable after the wizard closes.",
    },
    4: {
      eyebrow: "Readiness check",
      title: "Review the studio before launch",
      description: "Confirm company, agent, task, and doctor status before jumping into the issue or setup console.",
      icon: Rocket,
      note: "If knowledge import or doctor checks are still pending, this is the last place to catch it quickly.",
    },
  };

  const currentStepDetail = stepDetails[step];
  const CurrentStepIcon = currentStepDetail.icon;

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
                    <div className="text-[11px] font-medium tracking-[0.1em] text-muted-foreground">Studio setup</div>
                    <div className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-foreground">Create a new operating company</div>
                    <div className="mt-2 text-sm leading-6 text-muted-foreground">
                      Move from tenant creation to first delivery issue without leaving the current shell.
                    </div>
                  </div>
                </div>

                <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
                  <div className="rounded-[1.45rem] border border-border/80 bg-card/84 p-4 shadow-card">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Progress</div>
                        <div className="mt-1 text-base font-semibold text-foreground">Step {step} of 4</div>
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
                              {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0">
                              <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Step {item}</div>
                              <div className="mt-1 text-sm font-semibold text-foreground">{detail.title}</div>
                              <div className="mt-1 text-sm leading-6 text-muted-foreground">{detail.description}</div>
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
                        <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Company</div>
                        <div className="mt-1 text-sm font-semibold text-foreground">{companyName.trim() || "New company"}</div>
                      </div>
                      <div className="rounded-[1rem] border border-border bg-background/75 px-3 py-3">
                        <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Engine</div>
                        <div className="mt-1 text-sm font-semibold text-foreground">{getUIAdapter(adapterType).label}</div>
                      </div>
                      <div className="rounded-[1rem] border border-border bg-background/75 px-3 py-3">
                        <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Primary workspace</div>
                        <div className="mt-1 text-sm font-semibold text-foreground">
                          {selectedWorkspace ? `${selectedWorkspace.projectName} / ${selectedWorkspace.name}` : "Connect later"}
                        </div>
                      </div>
                      <div className="rounded-[1rem] border border-border bg-background/75 px-3 py-3">
                        <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Kickoff task</div>
                        <div className="mt-1 text-sm font-semibold text-foreground">{taskTitle.trim() || "First delivery brief"}</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.45rem] border border-border/80 bg-card/84 p-4 shadow-card">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Operator note
                    </div>
                    <div className="mt-2 text-sm leading-6 text-muted-foreground">{currentStepDetail.note}</div>
                    <div className="mt-4 rounded-[1rem] border border-border bg-background/75 px-3 py-3 text-sm text-muted-foreground">
                      Use <span className="font-['IBM_Plex_Mono'] text-[12px] text-foreground">Cmd/Ctrl + Enter</span> to continue from the current step.
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
                              <div className="text-lg font-semibold text-foreground">Company identity</div>
                              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                                Start with the tenant name and, if useful, a short operating goal for the first setup pass.
                              </div>
                            </div>
                          </div>

                          <div className="mt-5 space-y-4">
                            <div>
                              <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                Company name
                              </label>
                              <input
                                className="w-full rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                placeholder="Acme Corp"
                                value={companyName}
                                onChange={(e) => setCompanyName(e.target.value)}
                                autoFocus
                              />
                            </div>
                            <div>
                              <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                Mission / goal
                              </label>
                              <textarea
                                className="min-h-[128px] w-full resize-none rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                placeholder="What is this company trying to achieve?"
                                value={companyGoal}
                                onChange={(e) => setCompanyGoal(e.target.value)}
                              />
                            </div>
                          </div>
                        </section>

                        <section className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                          <div className="text-lg font-semibold text-foreground">What gets created now</div>
                          <div className="mt-2 text-sm leading-6 text-muted-foreground">
                            This wizard creates the company, prepares the execution lane, and moves straight into the first work item.
                          </div>
                          <div className="mt-5 grid gap-3">
                            <div className="rounded-[1rem] border border-border bg-background/76 px-4 py-4">
                              <div className="text-sm font-semibold text-foreground">Tenant and prefix</div>
                              <div className="mt-1 text-sm text-muted-foreground">A company record with a short issue prefix for route-scoped navigation.</div>
                            </div>
                            <div className="rounded-[1rem] border border-border bg-background/76 px-4 py-4">
                              <div className="text-sm font-semibold text-foreground">Initial operating goal</div>
                              <div className="mt-1 text-sm text-muted-foreground">Optional context that can be turned into higher-level planning later.</div>
                            </div>
                            <div className="rounded-[1rem] border border-border bg-background/76 px-4 py-4">
                              <div className="text-sm font-semibold text-foreground">Next step</div>
                              <div className="mt-1 text-sm text-muted-foreground">Configure the first execution agent and workspace so the queue can become real immediately.</div>
                            </div>
                          </div>
                        </section>
                      </div>
                    )}

                    {step === 2 && (
                      <div className="space-y-6">
                        <section className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                          <div className="text-lg font-semibold text-foreground">Squad preset</div>
                          <div className="mt-2 text-sm leading-6 text-muted-foreground">
                            Seed the default role pack you want this company to start from. This keeps the first queue and review lanes coherent.
                          </div>
                          <div className="mt-5 grid gap-3">
                            {rolePackPresets.map((preset) => (
                              <button
                                key={preset.key}
                                className={cn(
                                  "flex items-start justify-between gap-3 rounded-[1.2rem] border px-4 py-4 text-left transition-colors",
                                  selectedRolePackPresetKey === preset.key
                                    ? "border-primary/16 bg-[color-mix(in_oklab,var(--primary)_9%,white)]"
                                    : "border-border bg-background hover:border-primary/12 hover:bg-accent/32"
                                )}
                                onClick={() => setSelectedRolePackPresetKey(preset.key)}
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-semibold text-foreground">{preset.label}</span>
                                    {preset.recommended && (
                                      <span className="rounded-full border border-emerald-300/60 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                        Recommended
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-2 text-sm leading-6 text-muted-foreground">{preset.description}</div>
                                </div>
                                {selectedRolePackPresetKey === preset.key && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                              </button>
                            ))}
                          </div>
                        </section>

                        <section className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                          <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
                            <div className="space-y-4">
                              <div>
                                <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                  Agent name
                                </label>
                                <input
                                  className="w-full rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                  placeholder="CEO"
                                  value={agentName}
                                  onChange={(e) => setAgentName(e.target.value)}
                                  autoFocus
                                />
                              </div>

                              <div>
                                <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                  Adapter type
                                </label>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                  {ONBOARDING_ADAPTER_OPTIONS.map((opt) => (
                                    <button
                                      key={opt.value}
                                      className={cn(
                                        "relative rounded-[1.2rem] border px-4 py-4 text-left transition-colors",
                                        adapterType === opt.value
                                          ? "border-primary/16 bg-[color-mix(in_oklab,var(--primary)_9%,white)]"
                                          : "border-border bg-background hover:border-primary/12 hover:bg-accent/32"
                                      )}
                                      onClick={() => {
                                        const nextType = opt.value as AdapterType;
                                        setAdapterType(nextType);
                                        if (nextType === "codex_local" && !model) {
                                          setModel(DEFAULT_CODEX_LOCAL_MODEL);
                                        }
                                      }}
                                    >
                                      {opt.recommended && (
                                        <span className="absolute right-3 top-3 rounded-full border border-emerald-300/60 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                          Recommended
                                        </span>
                                      )}
                                      <div className="rounded-[0.95rem] border border-primary/10 bg-primary/8 p-2 text-primary w-fit">
                                        <opt.icon className="h-4 w-4" />
                                      </div>
                                      <div className="mt-3 text-sm font-semibold text-foreground">{opt.label}</div>
                                      <div className="mt-1 text-sm text-muted-foreground">{opt.desc}</div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {(adapterType === "claude_local" || adapterType === "codex_local") && (
                              <div className="space-y-4">
                                <div>
                                  <div className="mb-2 flex items-center gap-1.5">
                                    <label className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                      Working directory
                                    </label>
                                    <HintIcon text="Squadrail works best when each squad or workspace has a dedicated folder for memory, logs, and local execution state. Create a folder and put the path here." />
                                  </div>
                                  <div className="flex items-center gap-2 rounded-[1rem] border border-border bg-background px-3 py-2.5">
                                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    <input
                                      className="w-full bg-transparent text-sm font-mono outline-none placeholder:text-muted-foreground/50"
                                      placeholder="/path/to/project"
                                      value={cwd}
                                      onChange={(e) => setCwd(e.target.value)}
                                    />
                                    <ChoosePathButton />
                                  </div>
                                </div>

                                <div>
                                  <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                    Primary workspace
                                  </label>
                                  <select
                                    className="w-full rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                    value={setupWorkspaceId}
                                    onChange={(event) => setSetupWorkspaceId(event.target.value)}
                                  >
                                    <option value="">Select a workspace later</option>
                                    {workspaces.map((workspace) => (
                                      <option key={workspace.id} value={workspace.id}>
                                        {workspace.projectName} / {workspace.name}
                                      </option>
                                    ))}
                                  </select>
                                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                                    The primary workspace is reused by doctor, import, and retrieval bootstrap.
                                  </p>
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
                                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] rounded-[1rem] border-border p-1" align="start">
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
                                      {(adapterModels ?? []).map((m) => (
                                        <button
                                          key={m.id}
                                          className={cn(
                                            "flex w-full items-center justify-between rounded-[0.8rem] px-2.5 py-2 text-sm hover:bg-accent/50",
                                            m.id === model && "bg-accent"
                                          )}
                                          onClick={() => {
                                            setModel(m.id);
                                            setModelOpen(false);
                                          }}
                                        >
                                          <span>{m.label}</span>
                                          <span className="font-mono text-xs text-muted-foreground">{m.id}</span>
                                        </button>
                                      ))}
                                    </PopoverContent>
                                  </Popover>
                                </div>
                              </div>
                            )}
                          </div>
                        </section>

                        {isLocalAdapter && (
                          <section className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-lg font-semibold text-foreground">Adapter environment check</div>
                                <div className="mt-1 text-sm leading-6 text-muted-foreground">
                                  Run a live probe before the first agent is created so command, auth, and workspace wiring are visible early.
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

                            <div className="mt-5 space-y-3">
                              {adapterEnvError && (
                                <div className="rounded-[1rem] border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                                  {adapterEnvError}
                                </div>
                              )}

                              {adapterEnvResult && <AdapterEnvironmentResult result={adapterEnvResult} />}

                              {shouldSuggestUnsetAnthropicApiKey && (
                                <div className="rounded-[1rem] border border-amber-300/60 bg-amber-50/55 px-4 py-4">
                                  <p className="text-sm leading-6 text-amber-900/90">
                                    Claude failed while <span className="font-mono">ANTHROPIC_API_KEY</span> is set.
                                    Clear it from this adapter config and retry the probe in one click.
                                  </p>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-3 rounded-full"
                                    disabled={adapterEnvLoading || unsetAnthropicLoading}
                                    onClick={() => void handleUnsetAnthropicApiKey()}
                                  >
                                    {unsetAnthropicLoading ? "Retrying..." : "Unset ANTHROPIC_API_KEY"}
                                  </Button>
                                </div>
                              )}

                              <div className="rounded-[1rem] border border-border bg-background/78 px-4 py-4 text-sm text-muted-foreground">
                                <div className="font-semibold text-foreground">Manual debug</div>
                                <div className="mt-2 font-mono text-[12px] break-all text-muted-foreground">
                                  {adapterType === "codex_local"
                                    ? `${effectiveAdapterCommand} exec --json -`
                                    : `${effectiveAdapterCommand} --print - --output-format stream-json --verbose`}
                                </div>
                                <div className="mt-2 leading-6">
                                  Prompt: <span className="font-mono text-foreground">Respond with hello.</span>
                                </div>
                                <div className="mt-2 leading-6">
                                  {adapterType === "codex_local"
                                    ? "If auth fails, set OPENAI_API_KEY in env or run codex login."
                                    : "If login is required, run claude login and retry."}
                                </div>
                              </div>
                            </div>
                          </section>
                        )}

                        <section className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-lg font-semibold text-foreground">Role pack seed</div>
                              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                                Default Tech Lead, Engineer, and Reviewer packs are seeded automatically if missing.
                              </div>
                            </div>
                            <div className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
                              {setupProgress?.steps.squadReady || rolePacks.length > 0
                                ? `${Math.max(rolePacks.length, 3)} ready`
                                : "pending"}
                            </div>
                          </div>
                          <div className="mt-4 rounded-[1rem] border border-border bg-background/78 px-4 py-4 text-sm leading-6 text-muted-foreground">
                            <span className="font-semibold text-foreground">{selectedRolePackPreset.label}</span>
                            {" "}
                            will be used as the initial lane template for this company.
                          </div>
                        </section>
                      </div>
                    )}

                    {step === 3 && (
                      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                        <section className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                          <div className="text-lg font-semibold text-foreground">Kickoff task</div>
                          <div className="mt-2 text-sm leading-6 text-muted-foreground">
                            Keep the first issue narrow enough that queue state and reviewer handoff stay readable after setup.
                          </div>
                          <div className="mt-5 space-y-4">
                            <div>
                              <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                Task title
                              </label>
                              <input
                                className="w-full rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                placeholder="e.g. Research competitor pricing"
                                value={taskTitle}
                                onChange={(e) => setTaskTitle(e.target.value)}
                                autoFocus
                              />
                            </div>
                            <div>
                              <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                Description
                              </label>
                              <textarea
                                ref={textareaRef}
                                className="min-h-[220px] max-h-[360px] w-full resize-none overflow-y-auto rounded-[1rem] border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/18 focus:bg-white"
                                placeholder="Add more detail about what the agent should do..."
                                value={taskDescription}
                                onChange={(e) => setTaskDescription(e.target.value)}
                              />
                            </div>
                          </div>
                        </section>

                        <section className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                          <div className="text-lg font-semibold text-foreground">Brief guidance</div>
                          <div className="mt-2 text-sm leading-6 text-muted-foreground">
                            The first issue should behave like a real delivery brief, not a placeholder task.
                          </div>
                          <div className="mt-5 grid gap-3">
                            <div className="rounded-[1rem] border border-border bg-background/76 px-4 py-4">
                              <div className="text-sm font-semibold text-foreground">Be explicit</div>
                              <div className="mt-1 text-sm text-muted-foreground">Include expected outcome, scope, and any obvious blockers or approval boundaries.</div>
                            </div>
                            <div className="rounded-[1rem] border border-border bg-background/76 px-4 py-4">
                              <div className="text-sm font-semibold text-foreground">Prefer delivery work</div>
                              <div className="mt-1 text-sm text-muted-foreground">A narrow implementation or review task is better than a broad brainstorming brief.</div>
                            </div>
                            <div className="rounded-[1rem] border border-border bg-background/76 px-4 py-4">
                              <div className="text-sm font-semibold text-foreground">Design for handoff</div>
                              <div className="mt-1 text-sm text-muted-foreground">The reviewer should understand what success looks like without rewriting the issue later.</div>
                            </div>
                          </div>
                        </section>
                      </div>
                    )}

                    {step === 4 && (
                      <div className="space-y-6">
                        <section className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                          <div className="text-lg font-semibold text-foreground">Launch summary</div>
                          <div className="mt-2 text-sm leading-6 text-muted-foreground">
                            Review the objects created by the wizard before entering the issue or setup console.
                          </div>
                          <div className="mt-5 divide-y divide-border rounded-[1.1rem] border border-border bg-background/76">
                            <div className="flex items-center gap-3 px-4 py-4">
                              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-foreground">{companyName}</div>
                                <div className="text-xs text-muted-foreground">Company</div>
                              </div>
                              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                            </div>
                            <div className="flex items-center gap-3 px-4 py-4">
                              <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-foreground">{agentName}</div>
                                <div className="text-xs text-muted-foreground">{getUIAdapter(adapterType).label}</div>
                              </div>
                              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                            </div>
                            <div className="flex items-center gap-3 px-4 py-4">
                              <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-foreground">{taskTitle}</div>
                                <div className="text-xs text-muted-foreground">Kickoff task</div>
                              </div>
                              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                            </div>
                          </div>
                        </section>

                        {setupProgress && (
                          <section className="rounded-[1.7rem] border border-border bg-card/92 p-5 shadow-card">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-lg font-semibold text-foreground">Setup readiness</div>
                                <div className="mt-1 text-sm leading-6 text-muted-foreground">Current setup status: {setupProgress.status}</div>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-full"
                                onClick={() => void refetchDoctor()}
                              >
                                Refresh doctor
                              </Button>
                            </div>

                            <div className="mt-5 space-y-4">
                              {selectedWorkspace && !setupProgress.steps.knowledgeSeeded && (
                                <div className="flex flex-wrap items-center gap-3 rounded-[1rem] border border-border bg-background/76 p-4">
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold text-foreground">Import workspace knowledge</div>
                                    <div className="mt-1 text-sm text-muted-foreground">
                                      Use {selectedWorkspace.projectName} / {selectedWorkspace.name} as the first retrieval knowledge source.
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="rounded-full"
                                    disabled={workspaceImport.isPending}
                                    onClick={() => workspaceImport.mutate()}
                                  >
                                    {workspaceImport.isPending ? "Importing..." : "Import workspace"}
                                  </Button>
                                </div>
                              )}

                              {workspaceImport.isError && (
                                <div className="rounded-[1rem] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                                  {workspaceImport.error instanceof Error ? workspaceImport.error.message : "Workspace import failed"}
                                </div>
                              )}

                              {workspaceImport.data && (
                                <div className="rounded-[1rem] border border-emerald-300/70 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
                                  Imported {workspaceImport.data.importedFiles} files from {workspaceImport.data.workspaceName}. Scanned {workspaceImport.data.scannedFiles} and created {workspaceImport.data.documents.length} knowledge documents.
                                </div>
                              )}

                              <div className="grid gap-3 sm:grid-cols-2">
                                {Object.entries(setupProgress.steps).map(([key, done]) => (
                                  <div
                                    key={key}
                                    className={cn(
                                      "rounded-[1rem] border px-4 py-4 text-sm",
                                      done
                                        ? "border-emerald-300/65 bg-emerald-50/65 text-emerald-800"
                                        : "border-border bg-background/78 text-muted-foreground"
                                    )}
                                  >
                                    <div className="font-semibold capitalize text-foreground">
                                      {key.replace(/([a-z])([A-Z])/g, "$1 $2")}
                                    </div>
                                    <div className="mt-1 text-xs">{done ? "Ready" : "Pending"}</div>
                                  </div>
                                ))}
                              </div>

                              {doctorReport && (
                                <div className="rounded-[1rem] border border-border bg-background/76 p-4">
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="text-sm font-semibold text-foreground">Doctor: {doctorReport.status.toUpperCase()}</div>
                                    <div className="text-xs text-muted-foreground">
                                      pass {doctorReport.summary.pass} / warn {doctorReport.summary.warn} / fail {doctorReport.summary.fail}
                                    </div>
                                  </div>
                                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                                    {doctorReport.checks
                                      .filter((check) => check.status !== "pass")
                                      .slice(0, 3)
                                      .map((check) => (
                                        <div key={check.code}>
                                          <span className="font-semibold text-foreground">{check.label}</span>
                                          {" · "}
                                          {check.message}
                                        </div>
                                      ))}
                                    {doctorReport.checks.every((check) => check.status === "pass") && (
                                      <div>Core readiness checks are passing for the selected setup.</div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {!setupProgress.steps.workspaceConnected && (
                                <div className="rounded-[1rem] border border-amber-300/60 bg-amber-50/50 px-4 py-3 text-sm text-amber-900/90">
                                  Connect a primary workspace in Company Settings to unlock import, retrieval bootstrap, and higher-confidence task briefs.
                                </div>
                              )}
                            </div>
                          </section>
                        )}
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
                          disabled={loading}
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
                          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="mr-1.5 h-3.5 w-3.5" />}
                          {loading ? "Creating..." : "Continue"}
                        </Button>
                      )}
                      {step === 2 && (
                        <Button
                          size="sm"
                          className="rounded-full"
                          disabled={!agentName.trim() || loading || adapterEnvLoading}
                          onClick={handleStep2Next}
                        >
                          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="mr-1.5 h-3.5 w-3.5" />}
                          {loading ? "Creating..." : "Continue"}
                        </Button>
                      )}
                      {step === 3 && (
                        <Button
                          size="sm"
                          className="rounded-full"
                          disabled={!taskTitle.trim() || loading}
                          onClick={handleStep3Next}
                        >
                          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="mr-1.5 h-3.5 w-3.5" />}
                          {loading ? "Creating..." : "Continue"}
                        </Button>
                      )}
                      {step === 4 && (
                        <>
                          {createdCompanyPrefix && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-full"
                              onClick={() => navigate(`/${createdCompanyPrefix}${appRoutes.settings}`)}
                            >
                              Open setup console
                            </Button>
                          )}
                          <Button size="sm" className="rounded-full" disabled={loading} onClick={handleLaunch}>
                            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="mr-1.5 h-3.5 w-3.5" />}
                            {loading ? "Opening..." : "Open issue"}
                          </Button>
                        </>
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

function AdapterEnvironmentResult({
  result
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
