import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import { appRoutes, workIssuePath } from "../lib/appRoutes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  CircleDot,
  Bot,
  Hexagon,
  LayoutDashboard,
  SquarePen,
  Plus,
  Workflow,
  GitBranch,
  Users,
  Database,
  MessageSquare,
  ClipboardList,
  Scale,
  ArrowLeft,
  Building2,
  FolderKanban,
} from "lucide-react";
import { Identity } from "./Identity";
import { agentUrl, projectUrl, cn } from "../lib/utils";
import type { CommandComposerMode } from "@squadrail/shared";

// ---------------------------------------------------------------------------
// Mode descriptors
// ---------------------------------------------------------------------------

interface ModeDescriptor {
  key: CommandComposerMode;
  icon: typeof MessageSquare;
  emoji: string;
  label: string;
  description: string;
  shortcut: string;
}

const MODE_DESCRIPTORS: ModeDescriptor[] = [
  {
    key: "ask",
    icon: MessageSquare,
    emoji: "\uD83D\uDCAC",
    label: "Ask",
    description: "Quick request, clarification answer, or operator note",
    shortcut: "/ask",
  },
  {
    key: "task",
    icon: ClipboardList,
    emoji: "\uD83D\uDCCB",
    label: "Task",
    description: "Create issue or internal work item",
    shortcut: "/task",
  },
  {
    key: "decision",
    icon: Scale,
    emoji: "\u2696\uFE0F",
    label: "Decision",
    description: "Approve, reject, close, reassign, or merge gate",
    shortcut: "/decision",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract project id from current route if on a project-scoped page. */
function useCurrentProjectId(
  projects: Array<{ id: string; name: string }>,
): string | null {
  const location = useLocation();
  // Route pattern: /:companyPrefix/work/:issueRef — not project-scoped
  // We check for project pages or sidebar context in future;
  // for now return null (company scope default).
  void location;
  void projects;
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [composerMode, setComposerMode] = useState<CommandComposerMode | null>(
    null,
  );
  // Task mode state
  const [taskProjectId, setTaskProjectId] = useState<string | null>(null);

  const navigate = useNavigate();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { openNewIssue, openNewAgent } = useDialog();
  const searchQuery = query.trim();

  // -----------------------------------------------------------------------
  // Keyboard: Cmd+K opens palette
  // -----------------------------------------------------------------------

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Reset state when closed
  useEffect(() => {
    if (!open) {
      setQuery("");
      setComposerMode(null);
      setTaskProjectId(null);
    }
  }, [open]);

  // -----------------------------------------------------------------------
  // Slash-command detection: /ask, /task, /decision
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (composerMode !== null) return; // already in a mode
    const trimmed = query.trim().toLowerCase();
    for (const md of MODE_DESCRIPTORS) {
      if (trimmed === md.shortcut) {
        setComposerMode(md.key);
        setQuery("");
        return;
      }
    }
  }, [query, composerMode]);

  // -----------------------------------------------------------------------
  // Data queries
  // -----------------------------------------------------------------------

  const { data: issues = [] } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && open,
  });

  const { data: searchedIssues = [] } = useQuery({
    queryKey: queryKeys.issues.search(selectedCompanyId!, searchQuery),
    queryFn: () => issuesApi.list(selectedCompanyId!, { q: searchQuery }),
    enabled: !!selectedCompanyId && open && searchQuery.length > 0,
  });

  const { data: agents = [] } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && open,
  });

  const { data: projects = [] } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && open,
  });

  const currentProjectId = useCurrentProjectId(projects);

  // -----------------------------------------------------------------------
  // Navigation helper
  // -----------------------------------------------------------------------

  const go = useCallback(
    (path: string) => {
      setOpen(false);
      navigate(path);
    },
    [navigate],
  );

  const agentName = useCallback(
    (id: string | null) => {
      if (!id) return null;
      return agents.find((a) => a.id === id)?.name ?? null;
    },
    [agents],
  );

  const visibleIssues = useMemo(
    () => (searchQuery.length > 0 ? searchedIssues : issues),
    [issues, searchedIssues, searchQuery],
  );

  // Decision mode: filter issues by search query
  const decisionIssues = useMemo(() => {
    const source = searchQuery.length > 0 ? searchedIssues : issues;
    // Show issues that are actively in progress or awaiting decision
    return source.slice(0, 15);
  }, [issues, searchedIssues, searchQuery]);

  // -----------------------------------------------------------------------
  // Mode action handlers
  // -----------------------------------------------------------------------

  const handleBackToModeSelection = useCallback(() => {
    setComposerMode(null);
    setQuery("");
    setTaskProjectId(null);
  }, []);

  const handleAskSubmit = useCallback(() => {
    setOpen(false);
    openNewIssue(
      currentProjectId ? { projectId: currentProjectId } : {},
    );
  }, [openNewIssue, currentProjectId]);

  const handleTaskCreate = useCallback(() => {
    setOpen(false);
    openNewIssue({
      ...(taskProjectId ? { projectId: taskProjectId } : {}),
    });
  }, [openNewIssue, taskProjectId]);

  const handleDecisionSelect = useCallback(
    (issueIdentifier: string) => {
      go(workIssuePath(issueIdentifier));
    },
    [go],
  );

  // -----------------------------------------------------------------------
  // Scope badge
  // -----------------------------------------------------------------------

  const scopeLabel = useMemo(() => {
    if (composerMode === "decision") return "Issue scope";
    if (taskProjectId) {
      const proj = projects.find((p) => p.id === taskProjectId);
      return proj ? proj.name : "Project";
    }
    if (currentProjectId) {
      const proj = projects.find((p) => p.id === currentProjectId);
      return proj ? proj.name : "Project";
    }
    return selectedCompany?.name ?? "Company";
  }, [composerMode, taskProjectId, currentProjectId, projects, selectedCompany]);

  // -----------------------------------------------------------------------
  // Render: mode cards
  // -----------------------------------------------------------------------

  function renderModeCards() {
    return (
      <CommandGroup heading="Command Composer">
        {MODE_DESCRIPTORS.map((md) => (
          <CommandItem
            key={md.key}
            value={`mode-${md.key}`}
            onSelect={() => {
              setComposerMode(md.key);
              setQuery("");
            }}
          >
            <div className="flex items-center gap-3 w-full">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm",
                  md.key === "ask" && "bg-blue-500/10 text-blue-600",
                  md.key === "task" && "bg-emerald-500/10 text-emerald-600",
                  md.key === "decision" && "bg-amber-500/10 text-amber-600",
                )}
              >
                <md.icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{md.label}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {md.description}
                </div>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {md.shortcut}
              </span>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Ask mode
  // -----------------------------------------------------------------------

  function renderAskMode() {
    return (
      <>
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <button
            type="button"
            onClick={handleBackToModeSelection}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
          <div className="flex items-center gap-1.5">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-blue-500/10">
              <MessageSquare className="h-3 w-3 text-blue-600" />
            </div>
            <span className="text-xs font-medium">Ask</span>
          </div>
          <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1">
            {currentProjectId ? (
              <FolderKanban className="h-3 w-3" />
            ) : (
              <Building2 className="h-3 w-3" />
            )}
            {scopeLabel}
          </span>
        </div>
        <CommandList>
          <CommandGroup heading="Create a quick request">
            <CommandItem onSelect={handleAskSubmit}>
              <SquarePen className="mr-2 h-4 w-4" />
              <div className="flex-1">
                <div className="text-sm">Open new issue dialog</div>
                <div className="text-xs text-muted-foreground">
                  Submit a quick request, clarification, or operator note
                </div>
              </div>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Task mode
  // -----------------------------------------------------------------------

  function renderTaskMode() {
    return (
      <>
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <button
            type="button"
            onClick={handleBackToModeSelection}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
          <div className="flex items-center gap-1.5">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-emerald-500/10">
              <ClipboardList className="h-3 w-3 text-emerald-600" />
            </div>
            <span className="text-xs font-medium">Task</span>
          </div>
          <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1">
            {taskProjectId ? (
              <FolderKanban className="h-3 w-3" />
            ) : (
              <Building2 className="h-3 w-3" />
            )}
            {scopeLabel}
          </span>
        </div>
        <CommandList>
          {/* Project selector when multiple projects exist */}
          {projects.length > 0 && !taskProjectId && (
            <CommandGroup heading="Select project (optional)">
              <CommandItem
                value="task-no-project"
                onSelect={handleTaskCreate}
              >
                <Building2 className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>Company-level issue (no project)</span>
              </CommandItem>
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`task-project-${project.name}`}
                  onSelect={() => setTaskProjectId(project.id)}
                >
                  <Hexagon className="mr-2 h-4 w-4" />
                  {project.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* After project is selected (or when no projects), show create action */}
          {(taskProjectId || projects.length === 0) && (
            <CommandGroup heading="Create work item">
              <CommandItem onSelect={handleTaskCreate}>
                <SquarePen className="mr-2 h-4 w-4" />
                <div className="flex-1">
                  <div className="text-sm">
                    Create new issue
                    {taskProjectId
                      ? ` in ${projects.find((p) => p.id === taskProjectId)?.name ?? "project"}`
                      : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Opens the full issue creation dialog
                  </div>
                </div>
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Decision mode
  // -----------------------------------------------------------------------

  function renderDecisionMode() {
    return (
      <>
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <button
            type="button"
            onClick={handleBackToModeSelection}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
          <div className="flex items-center gap-1.5">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-amber-500/10">
              <Scale className="h-3 w-3 text-amber-600" />
            </div>
            <span className="text-xs font-medium">Decision</span>
          </div>
          <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1">
            <CircleDot className="h-3 w-3" />
            {scopeLabel}
          </span>
        </div>
        <CommandInput
          placeholder="Search issues to navigate to..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No issues found.</CommandEmpty>
          {decisionIssues.length > 0 && (
            <CommandGroup heading="Select issue to open">
              {decisionIssues.map((issue) => (
                <CommandItem
                  key={issue.id}
                  value={
                    searchQuery.length > 0
                      ? `${searchQuery} ${issue.identifier ?? ""} ${issue.title}`
                      : `decision ${issue.identifier ?? ""} ${issue.title}`
                  }
                  onSelect={() =>
                    handleDecisionSelect(issue.identifier ?? issue.id)
                  }
                >
                  <CircleDot className="mr-2 h-4 w-4" />
                  <span className="text-muted-foreground mr-2 font-mono text-xs">
                    {issue.identifier ?? issue.id.slice(0, 8)}
                  </span>
                  <span className="flex-1 truncate">{issue.title}</span>
                  {issue.assigneeAgentId &&
                    (() => {
                      const name = agentName(issue.assigneeAgentId);
                      return name ? (
                        <Identity name={name} size="sm" className="ml-2" />
                      ) : null;
                    })()}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Default palette (search + mode cards)
  // -----------------------------------------------------------------------

  function renderDefaultPalette() {
    return (
      <>
        <CommandInput
          placeholder="Search or type /ask, /task, /decision..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {/* Mode cards — shown when query is empty or doesn't match search */}
          {searchQuery.length === 0 && renderModeCards()}

          {searchQuery.length === 0 && <CommandSeparator />}

          <CommandGroup heading="Actions">
            <CommandItem
              onSelect={() => {
                setOpen(false);
                openNewIssue();
              }}
            >
              <SquarePen className="mr-2 h-4 w-4" />
              Create new issue
              <span className="ml-auto text-xs text-muted-foreground">C</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setOpen(false);
                openNewAgent();
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create new agent
            </CommandItem>
            <CommandItem onSelect={() => go("/projects")}>
              <Plus className="mr-2 h-4 w-4" />
              Create new project
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Pages">
            <CommandItem onSelect={() => go(appRoutes.overview)}>
              <LayoutDashboard className="mr-2 h-4 w-4" />
              Overview
            </CommandItem>
            <CommandItem onSelect={() => go(appRoutes.work)}>
              <Workflow className="mr-2 h-4 w-4" />
              Work
            </CommandItem>
            <CommandItem onSelect={() => go(appRoutes.changes)}>
              <GitBranch className="mr-2 h-4 w-4" />
              Changes
            </CommandItem>
            <CommandItem onSelect={() => go(appRoutes.runs)}>
              <Bot className="mr-2 h-4 w-4" />
              Runs
            </CommandItem>
            <CommandItem onSelect={() => go(appRoutes.team)}>
              <Users className="mr-2 h-4 w-4" />
              Team
            </CommandItem>
            <CommandItem onSelect={() => go(appRoutes.knowledge)}>
              <Database className="mr-2 h-4 w-4" />
              Knowledge
            </CommandItem>
          </CommandGroup>

          {visibleIssues.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Issues">
                {visibleIssues.slice(0, 10).map((issue) => (
                  <CommandItem
                    key={issue.id}
                    value={
                      searchQuery.length > 0
                        ? `${searchQuery} ${issue.identifier ?? ""} ${issue.title}`
                        : undefined
                    }
                    onSelect={() =>
                      go(workIssuePath(issue.identifier ?? issue.id))
                    }
                  >
                    <CircleDot className="mr-2 h-4 w-4" />
                    <span className="text-muted-foreground mr-2 font-mono text-xs">
                      {issue.identifier ?? issue.id.slice(0, 8)}
                    </span>
                    <span className="flex-1 truncate">{issue.title}</span>
                    {issue.assigneeAgentId &&
                      (() => {
                        const name = agentName(issue.assigneeAgentId);
                        return name ? (
                          <Identity name={name} size="sm" className="ml-2" />
                        ) : null;
                      })()}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {agents.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Agents">
                {agents.slice(0, 10).map((agent) => (
                  <CommandItem
                    key={agent.id}
                    onSelect={() => go(agentUrl(agent))}
                  >
                    <Bot className="mr-2 h-4 w-4" />
                    {agent.name}
                    <span className="text-xs text-muted-foreground ml-2">
                      {agent.role}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {projects.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Projects">
                {projects.slice(0, 10).map((project) => (
                  <CommandItem
                    key={project.id}
                    onSelect={() => go(projectUrl(project))}
                  >
                    <Hexagon className="mr-2 h-4 w-4" />
                    {project.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </>
    );
  }

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command Composer"
      description="Search, navigate, or use /ask, /task, /decision to switch modes"
    >
      {composerMode === null && renderDefaultPalette()}
      {composerMode === "ask" && renderAskMode()}
      {composerMode === "task" && renderTaskMode()}
      {composerMode === "decision" && renderDecisionMode()}
    </CommandDialog>
  );
}
