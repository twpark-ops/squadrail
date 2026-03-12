import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Agent, Issue, Project } from "@squadrail/shared";
import { issuesApi } from "../api/issues";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { issueUrl } from "../lib/utils";
import { InlineEntitySelector, type InlineEntityOption } from "./InlineEntitySelector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "../lib/utils";

interface InternalWorkItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: Issue;
  agents: Agent[];
  projects: Project[];
  defaultReviewerAgentId?: string | null;
  defaultQaAgentId?: string | null;
}

const KIND_OPTIONS = [
  { value: "implementation", label: "Implementation" },
  { value: "review", label: "Review" },
  { value: "plan", label: "Plan" },
  { value: "qa", label: "QA" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "critical", label: "Critical" },
] as const;

function parseLineList(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function InternalWorkItemDialog({
  open,
  onOpenChange,
  issue,
  agents,
  projects,
  defaultReviewerAgentId,
  defaultQaAgentId,
}: InternalWorkItemDialogProps) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<(typeof KIND_OPTIONS)[number]["value"]>("implementation");
  const [priority, setPriority] = useState<"critical" | "high" | "medium" | "low">("medium");
  const [projectId, setProjectId] = useState("");
  const [assigneeAgentId, setAssigneeAgentId] = useState("");
  const [reviewerAgentId, setReviewerAgentId] = useState("");
  const [qaAgentId, setQaAgentId] = useState("");
  const [goal, setGoal] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("- Ship the requested work item safely");
  const [definitionOfDone, setDefinitionOfDone] = useState("- Reviewer can verify the work from artifacts and notes");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setKind("implementation");
    setPriority(issue.priority);
    setProjectId(issue.projectId ?? "");
    setAssigneeAgentId("");
    setReviewerAgentId(defaultReviewerAgentId ?? "");
    setQaAgentId(defaultQaAgentId ?? "");
    setGoal("");
    setAcceptanceCriteria("- Ship the requested work item safely");
    setDefinitionOfDone("- Reviewer can verify the work from artifacts and notes");
  }, [defaultQaAgentId, defaultReviewerAgentId, issue.priority, issue.projectId, open]);

  const activeAgents = useMemo(
    () =>
      [...agents]
        .filter((agent) => agent.status !== "terminated")
        .sort((left, right) => left.name.localeCompare(right.name)),
    [agents],
  );
  const agentOptions = useMemo<InlineEntityOption[]>(
    () =>
      activeAgents.map((agent) => ({
        id: agent.id,
        label: agent.name,
        searchText: `${agent.name} ${agent.role} ${agent.title ?? ""}`,
      })),
    [activeAgents],
  );
  const projectOptions = useMemo<InlineEntityOption[]>(
    () =>
      projects.map((project) => ({
        id: project.id,
        label: project.name,
        searchText: project.description ?? "",
      })),
    [projects],
  );

  const createWorkItem = useMutation({
    mutationFn: async () =>
      issuesApi.createInternalWorkItem(issue.id, {
        title: title.trim(),
        description: description.trim() || null,
        kind,
        projectId: projectId || null,
        priority,
        assigneeAgentId,
        reviewerAgentId,
        qaAgentId: qaAgentId || null,
        goal: goal.trim() || undefined,
        acceptanceCriteria: parseLineList(acceptanceCriteria),
        definitionOfDone: parseLineList(definitionOfDone),
        watchLead: true,
        watchReviewer: true,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issue.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(issue.companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardTeamSupervision(issue.companyId, 12) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardProtocolQueue(issue.companyId, 20) });
      pushToast({
        dedupeKey: `activity:internal-work-item.created:${result.issue.id}`,
        title: `${result.issue.identifier ?? "Work item"} created`,
        body: result.issue.title,
        tone: "success",
        action: {
          label: `Open ${result.issue.identifier ?? "work item"}`,
          href: issueUrl(result.issue),
        },
      });
      onOpenChange(false);
    },
  });

  const canSubmit =
    title.trim().length > 0
    && assigneeAgentId.length > 0
    && reviewerAgentId.length > 0
    && parseLineList(acceptanceCriteria).length > 0
    && parseLineList(definitionOfDone).length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Internal Work Item</DialogTitle>
          <DialogDescription>
            Create a hidden child issue under {issue.identifier ?? issue.id.slice(0, 8)} and immediately assign the
            execution lane.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Title</label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Implement API retry policy" />
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kind</label>
              <div className="flex flex-wrap gap-2">
                {KIND_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      "rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent/50",
                      kind === option.value && "bg-accent text-foreground",
                    )}
                    onClick={() => setKind(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Priority</label>
              <div className="flex flex-wrap gap-2">
                {PRIORITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      "rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent/50",
                      priority === option.value && "bg-accent text-foreground",
                    )}
                    onClick={() => setPriority(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Project</label>
              <InlineEntitySelector
                value={projectId}
                options={projectOptions}
                placeholder="Project"
                noneLabel="Same as root issue"
                searchPlaceholder="Search projects..."
                emptyMessage="No projects found."
                onChange={setProjectId}
              />
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assignee</label>
              <InlineEntitySelector
                value={assigneeAgentId}
                options={agentOptions}
                placeholder="Engineer"
                noneLabel="No assignee"
                searchPlaceholder="Search agents..."
                emptyMessage="No agents found."
                onChange={setAssigneeAgentId}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reviewer</label>
              <InlineEntitySelector
                value={reviewerAgentId}
                options={agentOptions}
                placeholder="Reviewer"
                noneLabel="No reviewer"
                searchPlaceholder="Search agents..."
                emptyMessage="No agents found."
                onChange={setReviewerAgentId}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">QA Gate</label>
              <InlineEntitySelector
                value={qaAgentId}
                options={agentOptions}
                placeholder="Optional QA"
                noneLabel="No QA gate"
                searchPlaceholder="Search agents..."
                emptyMessage="No agents found."
                onChange={setQaAgentId}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Goal</label>
            <Input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Optional work item goal" />
          </div>

          <div className="grid gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              placeholder="Context, implementation notes, or review expectations"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Acceptance Criteria
              </label>
              <Textarea
                value={acceptanceCriteria}
                onChange={(event) => setAcceptanceCriteria(event.target.value)}
                rows={5}
                placeholder="- API retries recover from 429 responses"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Definition Of Done
              </label>
              <Textarea
                value={definitionOfDone}
                onChange={(event) => setDefinitionOfDone(event.target.value)}
                rows={5}
                placeholder="- Focused tests pass and reviewer evidence is attached"
              />
            </div>
          </div>

          {createWorkItem.isError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {createWorkItem.error instanceof Error ? createWorkItem.error.message : "Failed to create internal work item"}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => createWorkItem.mutate()} disabled={!canSubmit || createWorkItem.isPending}>
            {createWorkItem.isPending ? "Creating..." : "Create work item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
