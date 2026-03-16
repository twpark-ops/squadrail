import { useEffect, useDeferredValue, useMemo, useState, useCallback, useRef } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { groupBy } from "../lib/groupBy";
import { formatDate, cn } from "../lib/utils";
import { StatusIcon } from "./StatusIcon";
import { PriorityIcon } from "./PriorityIcon";
import { EmptyState } from "./EmptyState";
import { Identity } from "./Identity";
import { AgentRoleBadge } from "./agent-presence-primitives";
import { PageSkeleton } from "./PageSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { CircleDot, Plus, Filter, ArrowUpDown, Layers, Check, X, ChevronRight, List, Columns3, User, Search } from "lucide-react";
import { KanbanBoard } from "./KanbanBoard";
import { SubtaskProgressBar } from "./SubtaskProgressBar";
import type { Issue } from "@squadrail/shared";
import { readJsonStorageAlias, writeJsonStorageAlias } from "../lib/storage-aliases";
import { workIssuePath } from "../lib/appRoutes";

/* ── Helpers ── */

const statusOrder = ["in_progress", "todo", "backlog", "in_review", "blocked", "done", "cancelled"];
const priorityOrder = ["critical", "high", "medium", "low"];

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── View state ── */

export type IssueViewState = {
  statuses: string[];
  priorities: string[];
  assignees: string[];
  labels: string[];
  sortField: "status" | "priority" | "title" | "created" | "updated";
  sortDir: "asc" | "desc";
  groupBy: "status" | "priority" | "assignee" | "none";
  viewMode: "list" | "board";
  collapsedGroups: string[];
  collapsedParents: string[];
};

const defaultViewState: IssueViewState = {
  statuses: [],
  priorities: [],
  assignees: [],
  labels: [],
  sortField: "updated",
  sortDir: "desc",
  groupBy: "none",
  viewMode: "list",
  collapsedGroups: [],
  collapsedParents: [],
};

const quickFilterPresets = [
  { label: "All", statuses: [] as string[] },
  { label: "Active", statuses: ["todo", "in_progress", "in_review", "blocked"] },
  { label: "Backlog", statuses: ["backlog"] },
  { label: "Done", statuses: ["done", "cancelled"] },
];

function getViewState(key: string, legacyKey?: string): IssueViewState {
  try {
    return { ...defaultViewState, ...readJsonStorageAlias<Record<string, unknown>>(key, legacyKey, {}) };
  } catch { /* ignore */ }
  return { ...defaultViewState };
}

function saveViewState(key: string, state: IssueViewState, legacyKey?: string) {
  writeJsonStorageAlias(key, legacyKey, state);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function toggleInArray(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function applyFilters(issues: Issue[], state: IssueViewState): Issue[] {
  let result = issues;
  if (state.statuses.length > 0) result = result.filter((i) => state.statuses.includes(i.status));
  if (state.priorities.length > 0) result = result.filter((i) => state.priorities.includes(i.priority));
  if (state.assignees.length > 0) result = result.filter((i) => i.assigneeAgentId != null && state.assignees.includes(i.assigneeAgentId));
  if (state.labels.length > 0) result = result.filter((i) => (i.labelIds ?? []).some((id) => state.labels.includes(id)));
  return result;
}

function sortIssues(issues: Issue[], state: IssueViewState): Issue[] {
  const sorted = [...issues];
  const dir = state.sortDir === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    switch (state.sortField) {
      case "status":
        return dir * (statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));
      case "priority":
        return dir * (priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority));
      case "title":
        return dir * a.title.localeCompare(b.title);
      case "created":
        return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case "updated":
        return dir * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
      default:
        return 0;
    }
  });
  return sorted;
}

/** Build a tree: root issues first, children nested under their parent. */
function buildIssueTree(issues: Issue[]): Array<{ issue: Issue; children: Issue[] }> {
  const childMap = new Map<string, Issue[]>();
  const roots: Issue[] = [];
  const issueById = new Map(issues.map((i) => [i.id, i]));

  for (const issue of issues) {
    if (issue.parentId && issueById.has(issue.parentId)) {
      const siblings = childMap.get(issue.parentId) ?? [];
      siblings.push(issue);
      childMap.set(issue.parentId, siblings);
    } else {
      roots.push(issue);
    }
  }

  return roots.map((root) => ({
    issue: root,
    children: childMap.get(root.id) ?? [],
  }));
}

function countActiveFilters(state: IssueViewState): number {
  let count = 0;
  if (state.statuses.length > 0) count++;
  if (state.priorities.length > 0) count++;
  if (state.assignees.length > 0) count++;
  if (state.labels.length > 0) count++;
  return count;
}

/* ── Component ── */

interface Agent {
  id: string;
  name: string;
  role?: string;
  title?: string | null;
  icon?: string | null;
}

type IssueSignalTone = "default" | "warning" | "danger" | "info";

function signalToneClassName(tone: IssueSignalTone) {
  switch (tone) {
    case "warning":
      return "border-amber-300/70 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200";
    case "danger":
      return "border-red-300/70 bg-red-500/10 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-200";
    case "info":
      return "border-sky-300/70 bg-sky-500/10 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

function buildIssueSignals(issue: Issue): Array<{ label: string; tone: IssueSignalTone }> {
  const signals: Array<{ label: string; tone: IssueSignalTone }> = [
    { label: statusLabel(issue.status), tone: issue.status === "blocked" ? "danger" : issue.status === "in_review" ? "warning" : "default" },
  ];

  if (issue.priority === "critical" || issue.priority === "high") {
    signals.push({
      label: `${statusLabel(issue.priority)} priority`,
      tone: issue.priority === "critical" ? "danger" : "warning",
    });
  }

  if (issue.internalWorkItemSummary?.total) {
    const { total, done, blocked, inReview } = issue.internalWorkItemSummary;
    const parts = [`${done}/${total} done`];
    let tone: IssueSignalTone = "info";
    if (blocked) {
      parts.push(`${blocked} blocked`);
      tone = "danger";
    } else if (inReview) {
      parts.push(`${inReview} review`);
      tone = "warning";
    }
    signals.push({
      label: parts.join(" · "),
      tone,
    });
  } else if (
    issue.status === "in_review" ||
    issue.internalWorkItemSummary?.reviewRequestedIssueId
  ) {
    signals.push({
      label: "review pending",
      tone: "warning",
    });
  }

  return signals;
}

interface IssuesListProps {
  issues: Issue[];
  isLoading?: boolean;
  error?: Error | null;
  agents?: Agent[];
  liveIssueIds?: Set<string>;
  projectId?: string;
  viewStateKey: string;
  legacyViewStateKey?: string;
  initialAssignees?: string[];
  viewMode?: "list" | "board";
  onUpdateIssue: (id: string, data: Record<string, unknown>) => void;
}

export function IssuesList({
  issues,
  isLoading,
  error,
  agents,
  liveIssueIds,
  projectId,
  viewStateKey,
  legacyViewStateKey,
  initialAssignees,
  viewMode: viewModeProp,
  onUpdateIssue,
}: IssuesListProps) {
  const { selectedCompanyId } = useCompany();
  const { openNewIssue } = useDialog();

  // Scope the storage key per company so folding/view state is independent across companies.
  const scopedKey = selectedCompanyId ? `${viewStateKey}:${selectedCompanyId}` : viewStateKey;
  const scopedLegacyKey =
    legacyViewStateKey ? (selectedCompanyId ? `${legacyViewStateKey}:${selectedCompanyId}` : legacyViewStateKey) : undefined;

  const [viewState, setViewState] = useState<IssueViewState>(() => {
    if (initialAssignees) {
      return { ...defaultViewState, assignees: initialAssignees, statuses: [] };
    }
    return getViewState(scopedKey, scopedLegacyKey);
  });
  const effectiveViewMode = viewModeProp ?? viewState.viewMode;
  const [assigneePickerIssueId, setAssigneePickerIssueId] = useState<string | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [issueSearch, setIssueSearch] = useState("");
  const deferredIssueSearch = useDeferredValue(issueSearch);
  const normalizedIssueSearch = deferredIssueSearch.trim();

  // Reload view state from localStorage when company changes (scopedKey changes).
  const prevScopedKey = useRef(scopedKey);
  useEffect(() => {
    if (prevScopedKey.current !== scopedKey) {
      prevScopedKey.current = scopedKey;
      setViewState(initialAssignees
        ? { ...defaultViewState, assignees: initialAssignees, statuses: [] }
        : getViewState(scopedKey, scopedLegacyKey));
    }
  }, [scopedKey, scopedLegacyKey, initialAssignees]);

  const updateView = useCallback((patch: Partial<IssueViewState>) => {
    setViewState((prev) => {
      const next = { ...prev, ...patch };
      saveViewState(scopedKey, next, scopedLegacyKey);
      return next;
    });
  }, [scopedKey, scopedLegacyKey]);

  const { data: searchedIssues = [] } = useQuery({
    queryKey: queryKeys.issues.search(selectedCompanyId!, normalizedIssueSearch, projectId),
    queryFn: () => issuesApi.list(selectedCompanyId!, { q: normalizedIssueSearch, projectId }),
    enabled: !!selectedCompanyId && normalizedIssueSearch.length > 0,
  });

  const agentName = useCallback((id: string | null) => {
    if (!id || !agents) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  }, [agents]);

  const filtered = useMemo(() => {
    const sourceIssues = normalizedIssueSearch.length > 0 ? searchedIssues : issues;
    const filteredByControls = applyFilters(sourceIssues, viewState);
    return sortIssues(filteredByControls, viewState);
  }, [issues, searchedIssues, viewState, normalizedIssueSearch]);

  const { data: labels } = useQuery({
    queryKey: queryKeys.issues.labels(selectedCompanyId!),
    queryFn: () => issuesApi.listLabels(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const activeFilterCount = countActiveFilters(viewState);
  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents ?? []) {
      map.set(agent.id, agent);
    }
    return map;
  }, [agents]);

  const groupedContent = useMemo(() => {
    if (viewState.groupBy === "none") {
      return [{ key: "__all", label: null as string | null, items: filtered }];
    }
    if (viewState.groupBy === "status") {
      const groups = groupBy(filtered, (i) => i.status);
      return statusOrder
        .filter((s) => groups[s]?.length)
        .map((s) => ({ key: s, label: statusLabel(s), items: groups[s]! }));
    }
    if (viewState.groupBy === "priority") {
      const groups = groupBy(filtered, (i) => i.priority);
      return priorityOrder
        .filter((p) => groups[p]?.length)
        .map((p) => ({ key: p, label: statusLabel(p), items: groups[p]! }));
    }
    // assignee
    const groups = groupBy(filtered, (i) => i.assigneeAgentId ?? "__unassigned");
    return Object.keys(groups).map((key) => ({
      key,
      label: key === "__unassigned" ? "Unassigned" : (agentName(key) ?? key.slice(0, 8)),
      items: groups[key]!,
    }));
  }, [filtered, viewState.groupBy, agents]); // eslint-disable-line react-hooks/exhaustive-deps

  const newIssueDefaults = (groupKey?: string) => {
    const defaults: Record<string, string> = {};
    if (projectId) defaults.projectId = projectId;
    if (groupKey) {
      if (viewState.groupBy === "status") defaults.status = groupKey;
      else if (viewState.groupBy === "priority") defaults.priority = groupKey;
      else if (viewState.groupBy === "assignee" && groupKey !== "__unassigned") defaults.assigneeAgentId = groupKey;
    }
    return defaults;
  };

  const assignIssue = (issueId: string, assigneeAgentId: string | null) => {
    onUpdateIssue(issueId, { assigneeAgentId, assigneeUserId: null });
    setAssigneePickerIssueId(null);
    setAssigneeSearch("");
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-[1.6rem] border border-border bg-background/72 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Button size="sm" onClick={() => openNewIssue(newIssueDefaults())}>
            <Plus className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">New Issue</span>
          </Button>
          <div className="relative w-48 sm:w-64 md:w-80">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={issueSearch}
              onChange={(e) => setIssueSearch(e.target.value)}
              placeholder="Search issues..."
              className="pl-7 text-xs sm:text-sm"
              aria-label="Search issues"
            />
          </div>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          {/* View mode toggle — hidden when controlled externally via viewMode prop */}
          {!viewModeProp && (
            <div className="flex items-center border border-border rounded-md overflow-hidden mr-1">
              <button
                className={`p-1.5 transition-colors ${effectiveViewMode === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => updateView({ viewMode: "list" })}
                title="List view"
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                className={`p-1.5 transition-colors ${effectiveViewMode === "board" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => updateView({ viewMode: "board" })}
                title="Board view"
              >
                <Columns3 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className={`text-xs ${activeFilterCount > 0 ? "text-blue-600 dark:text-blue-400" : ""}`}>
                <Filter className="h-3.5 w-3.5 sm:h-3 sm:w-3 sm:mr-1" />
                <span className="hidden sm:inline">{activeFilterCount > 0 ? `Filters: ${activeFilterCount}` : "Filter"}</span>
                {activeFilterCount > 0 && (
                  <span className="sm:hidden text-[10px] font-medium ml-0.5">{activeFilterCount}</span>
                )}
                {activeFilterCount > 0 && (
                  <X
                    className="h-3 w-3 ml-1 hidden sm:block"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateView({ statuses: [], priorities: [], assignees: [], labels: [] });
                    }}
                  />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(480px,calc(100vw-2rem))] p-0">
              <div className="p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Filters</span>
                  {activeFilterCount > 0 && (
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => updateView({ statuses: [], priorities: [], assignees: [], labels: [] })}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Quick filters */}
                <div className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">Quick filters</span>
                  <div className="flex flex-wrap gap-1.5">
                    {quickFilterPresets.map((preset) => {
                      const isActive = arraysEqual(viewState.statuses, preset.statuses);
                      return (
                        <button
                          key={preset.label}
                          className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                            isActive
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                          }`}
                          onClick={() => updateView({ statuses: isActive ? [] : [...preset.statuses] })}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-border" />

                {/* Multi-column filter sections */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                  {/* Status */}
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Status</span>
                    <div className="space-y-0.5">
                      {statusOrder.map((s) => (
                        <label key={s} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer">
                          <Checkbox
                            checked={viewState.statuses.includes(s)}
                            onCheckedChange={() => updateView({ statuses: toggleInArray(viewState.statuses, s) })}
                          />
                          <StatusIcon status={s} />
                          <span className="text-sm">{statusLabel(s)}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Priority + Assignee stacked in right column */}
                  <div className="space-y-3">
                    {/* Priority */}
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Priority</span>
                      <div className="space-y-0.5">
                        {priorityOrder.map((p) => (
                          <label key={p} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer">
                            <Checkbox
                              checked={viewState.priorities.includes(p)}
                              onCheckedChange={() => updateView({ priorities: toggleInArray(viewState.priorities, p) })}
                            />
                            <PriorityIcon priority={p} />
                            <span className="text-sm">{statusLabel(p)}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Assignee */}
                    {agents && agents.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Assignee</span>
                        <div className="space-y-0.5 max-h-32 overflow-y-auto">
                          {agents.map((agent) => (
                            <label key={agent.id} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer">
                              <Checkbox
                                checked={viewState.assignees.includes(agent.id)}
                                onCheckedChange={() => updateView({ assignees: toggleInArray(viewState.assignees, agent.id) })}
                              />
                              <span className="text-sm">{agent.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {labels && labels.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Labels</span>
                        <div className="space-y-0.5 max-h-32 overflow-y-auto">
                          {labels.map((label) => (
                            <label key={label.id} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer">
                              <Checkbox
                                checked={viewState.labels.includes(label.id)}
                                onCheckedChange={() => updateView({ labels: toggleInArray(viewState.labels, label.id) })}
                              />
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label.color }} />
                              <span className="text-sm">{label.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Sort (list view only) */}
          {effectiveViewMode === "list" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs">
                  <ArrowUpDown className="h-3.5 w-3.5 sm:h-3 sm:w-3 sm:mr-1" />
                  <span className="hidden sm:inline">Sort</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-0">
                <div className="p-2 space-y-0.5">
                  {([
                    ["status", "Status"],
                    ["priority", "Priority"],
                    ["title", "Title"],
                    ["created", "Created"],
                    ["updated", "Updated"],
                  ] as const).map(([field, label]) => (
                    <button
                      key={field}
                      className={`flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-sm ${
                        viewState.sortField === field ? "bg-accent/50 text-foreground" : "hover:bg-accent/50 text-muted-foreground"
                      }`}
                      onClick={() => {
                        if (viewState.sortField === field) {
                          updateView({ sortDir: viewState.sortDir === "asc" ? "desc" : "asc" });
                        } else {
                          updateView({ sortField: field, sortDir: "asc" });
                        }
                      }}
                    >
                      <span>{label}</span>
                      {viewState.sortField === field && (
                        <span className="text-xs text-muted-foreground">
                          {viewState.sortDir === "asc" ? "\u2191" : "\u2193"}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Group (list view only) */}
          {effectiveViewMode === "list" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs">
                  <Layers className="h-3.5 w-3.5 sm:h-3 sm:w-3 sm:mr-1" />
                  <span className="hidden sm:inline">Group</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-0">
                <div className="p-2 space-y-0.5">
                  {([
                    ["status", "Status"],
                    ["priority", "Priority"],
                    ["assignee", "Assignee"],
                    ["none", "None"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      className={`flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-sm ${
                        viewState.groupBy === value ? "bg-accent/50 text-foreground" : "hover:bg-accent/50 text-muted-foreground"
                      }`}
                      onClick={() => updateView({ groupBy: value })}
                    >
                      <span>{label}</span>
                      {viewState.groupBy === value && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {isLoading && <PageSkeleton variant="issues-list" />}
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {!isLoading && filtered.length === 0 && effectiveViewMode === "list" && (
        <EmptyState
          icon={CircleDot}
          message="No issues match the current filters or search."
          action="Create Issue"
          onAction={() => openNewIssue(newIssueDefaults())}
        />
      )}

      {effectiveViewMode === "board" ? (
        <KanbanBoard
          issues={filtered}
          agents={agents}
          liveIssueIds={liveIssueIds}
          onUpdateIssue={onUpdateIssue}
        />
      ) : (
        groupedContent.map((group) => (
          <Collapsible
            key={group.key}
            open={!viewState.collapsedGroups.includes(group.key)}
            onOpenChange={(open) => {
              updateView({
                collapsedGroups: open
                  ? viewState.collapsedGroups.filter((k) => k !== group.key)
                  : [...viewState.collapsedGroups, group.key],
              });
            }}
          >
            {group.label && (
              <div className="flex items-center rounded-[1.1rem] bg-background/72 py-2 pl-3 pr-3">
                <CollapsibleTrigger className="flex items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-90" />
                  <span className="text-sm font-semibold uppercase tracking-[0.16em]">
                    {group.label}
                  </span>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto text-muted-foreground"
                  onClick={() => openNewIssue(newIssueDefaults(group.key))}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            )}
            <CollapsibleContent>
              {buildIssueTree(group.items).map(({ issue, children }) => (
                <div key={issue.id}>
                <Link
                  to={workIssuePath(issue.identifier ?? issue.id)}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 border-b border-border/85 py-3 pl-3 pr-4 text-sm text-inherit no-underline transition-colors last:border-b-0 hover:bg-accent/50",
                    children.length > 0 && "bg-muted/20",
                  )}
                >
                  {children.length > 0 ? (
                    <button
                      className="hidden w-3.5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground sm:flex"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        updateView({
                          collapsedParents: viewState.collapsedParents.includes(issue.id)
                            ? viewState.collapsedParents.filter((id) => id !== issue.id)
                            : [...viewState.collapsedParents, issue.id],
                        });
                      }}
                    >
                      <ChevronRight className={cn("h-3 w-3 transition-transform", !viewState.collapsedParents.includes(issue.id) && "rotate-90")} />
                    </button>
                  ) : (
                    <div className="w-3.5 shrink-0 hidden sm:block" />
                  )}
                  <div className="shrink-0" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                    <StatusIcon
                      status={issue.status}
                      onChange={(s) => onUpdateIssue(issue.id, { status: s })}
                    />
                  </div>
                  <span className="text-sm text-muted-foreground font-mono shrink-0">
                    {issue.identifier ?? issue.id.slice(0, 8)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">{issue.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {buildIssueSignals(issue).map((signal) => (
                        <span
                          key={`${issue.id}:${signal.label}`}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                            signalToneClassName(signal.tone),
                          )}
                        >
                          {signal.label}
                        </span>
                      ))}
                      {issue.assigneeAgentId && agentMap.get(issue.assigneeAgentId)?.role ? (
                        <AgentRoleBadge
                          role={agentMap.get(issue.assigneeAgentId)?.role ?? "general"}
                          title={agentMap.get(issue.assigneeAgentId)?.title ?? null}
                        />
                      ) : null}
                      {(issue.labels ?? []).slice(0, 2).map((label) => (
                        <span
                          key={label.id}
                          className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                          style={{
                            borderColor: label.color,
                            color: label.color,
                            backgroundColor: `${label.color}1f`,
                          }}
                        >
                          {label.name}
                        </span>
                      ))}
                      {(issue.labels ?? []).length > 2 && (
                        <span className="text-[10px] text-muted-foreground">+{(issue.labels ?? []).length - 2} labels</span>
                      )}
                    </div>
                    {issue.internalWorkItemSummary && issue.internalWorkItemSummary.total > 0 && (
                      <SubtaskProgressBar
                        summary={issue.internalWorkItemSummary}
                        mode={children.length > 0 ? "full" : "compact"}
                        className="mt-1.5"
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto">
                    {children.length > 0 && issue.internalWorkItemSummary?.activeAssigneeAgentIds && issue.internalWorkItemSummary.activeAssigneeAgentIds.length > 0 && (
                      <div className="hidden items-center -space-x-1.5 sm:flex">
                        {issue.internalWorkItemSummary.activeAssigneeAgentIds.slice(0, 3).map((agentId) => {
                          const name = agentName(agentId);
                          return name ? <Identity key={agentId} name={name} size="xs" /> : null;
                        })}
                        {issue.internalWorkItemSummary.activeAssigneeAgentIds.length > 3 && (
                          <span className="pl-2 text-[10px] text-muted-foreground">
                            +{issue.internalWorkItemSummary.activeAssigneeAgentIds.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                    {liveIssueIds?.has(issue.id) && (
                      <span className="inline-flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 rounded-full bg-blue-500/10">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                        </span>
                        <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hidden sm:inline">Live</span>
                      </span>
                    )}
                    <div className="hidden sm:block">
                      <Popover
                        open={assigneePickerIssueId === issue.id}
                        onOpenChange={(open) => {
                          setAssigneePickerIssueId(open ? issue.id : null);
                          if (!open) setAssigneeSearch("");
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            className="flex w-[180px] shrink-0 items-center rounded-md px-2 py-1 hover:bg-accent/50 transition-colors"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                          >
                            {issue.assigneeAgentId && agentName(issue.assigneeAgentId) ? (
                              <div className="flex min-w-0 items-center gap-2">
                                <Identity name={agentName(issue.assigneeAgentId)!} size="sm" />
                                {agentMap.get(issue.assigneeAgentId)?.role ? (
                                  <span className="hidden md:inline">
                                    <AgentRoleBadge
                                      role={agentMap.get(issue.assigneeAgentId)?.role ?? "general"}
                                      title={agentMap.get(issue.assigneeAgentId)?.title ?? null}
                                    />
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/35 bg-muted/30">
                                  <User className="h-3 w-3" />
                                </span>
                                Assignee
                              </span>
                            )}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-56 p-1"
                          align="end"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDownOutside={() => setAssigneeSearch("")}
                        >
                          <input
                            className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border-b border-border mb-1 placeholder:text-muted-foreground/50"
                            placeholder="Search agents..."
                            value={assigneeSearch}
                            onChange={(e) => setAssigneeSearch(e.target.value)}
                            autoFocus
                          />
                          <div className="max-h-48 overflow-y-auto overscroll-contain">
                            <button
                              className={cn(
                                "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                                !issue.assigneeAgentId && "bg-accent"
                              )}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                assignIssue(issue.id, null);
                              }}
                            >
                              No assignee
                            </button>
                            {(agents ?? [])
                              .filter((agent) => {
                                if (!assigneeSearch.trim()) return true;
                                return agent.name.toLowerCase().includes(assigneeSearch.toLowerCase());
                              })
                              .map((agent) => (
                                <button
                                  key={agent.id}
                                  className={cn(
                                    "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 text-left",
                                    issue.assigneeAgentId === agent.id && "bg-accent"
                                  )}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    assignIssue(issue.id, agent.id);
                                  }}
                                >
                                  <Identity name={agent.name} size="sm" className="min-w-0" />
                                </button>
                              ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {formatDate(issue.createdAt)}
                    </span>
                  </div>
                </Link>
                {children.length > 0 && !viewState.collapsedParents.includes(issue.id) && (
                  <div className="border-b border-border/85 last:border-b-0">
                    {children.map((child) => (
                      <Link
                        key={child.id}
                        to={workIssuePath(child.identifier ?? child.id)}
                        className="flex cursor-pointer items-start gap-2 py-2.5 pl-10 pr-4 text-sm text-inherit no-underline transition-colors hover:bg-accent/50 border-l-2 border-primary/20 ml-6"
                      >
                        <div className="shrink-0" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                          <StatusIcon
                            status={child.status}
                            onChange={(s) => onUpdateIssue(child.id, { status: s })}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground font-mono shrink-0">
                          {child.identifier ?? child.id.slice(0, 8)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-foreground/85">{child.title}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            {buildIssueSignals(child).map((signal) => (
                              <span
                                key={`${child.id}:${signal.label}`}
                                className={cn(
                                  "rounded-full border px-1.5 py-0.5 text-[9px] font-medium",
                                  signalToneClassName(signal.tone),
                                )}
                              >
                                {signal.label}
                              </span>
                            ))}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground hidden sm:inline shrink-0">
                          {formatDate(child.createdAt)}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        ))
      )}
    </div>
  );
}
