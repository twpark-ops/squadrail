import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Agent, Issue, Project } from "@squadrail/shared";
import { issuesApi } from "../api/issues";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
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

interface PmIntakeProjectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: Issue;
  agents: Agent[];
  projects: Project[];
}

function parseLineList(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function canReview(agent: Agent) {
  if (agent.role === "qa") return true;
  return /tech lead/i.test(agent.title ?? "") || agent.role === "cto";
}

function isTechLead(agent: Agent) {
  return agent.role === "cto" || /tech lead/i.test(agent.title ?? "");
}

function activeAgents(agents: Agent[]) {
  return [...agents]
    .filter((agent) => agent.status !== "terminated")
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function PmIntakeProjectionDialog({
  open,
  onOpenChange,
  issue,
  agents,
  projects,
}: PmIntakeProjectionDialogProps) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [structuredTitle, setStructuredTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState<"critical" | "high" | "medium" | "low">("medium");
  const [techLeadAgentId, setTechLeadAgentId] = useState("");
  const [reviewerAgentId, setReviewerAgentId] = useState("");
  const [qaAgentId, setQaAgentId] = useState("");
  const [executionSummary, setExecutionSummary] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("- Clarify scope and ship the first delivery slice");
  const [definitionOfDone, setDefinitionOfDone] = useState("- Root issue is re-routed and child execution is underway");
  const [risks, setRisks] = useState("");
  const [openQuestions, setOpenQuestions] = useState("");
  const [documentationDebt, setDocumentationDebt] = useState("");
  const [createInitialWorkItem, setCreateInitialWorkItem] = useState(true);
  const [workItemTitle, setWorkItemTitle] = useState("");
  const [workItemDescription, setWorkItemDescription] = useState("");
  const [workItemAssigneeAgentId, setWorkItemAssigneeAgentId] = useState("");
  const [workItemKind, setWorkItemKind] = useState<"implementation" | "plan" | "review" | "qa">("implementation");

  const active = useMemo(() => activeAgents(agents), [agents]);
  const techLeadCandidates = useMemo(() => active.filter(isTechLead), [active]);
  const reviewerCandidates = useMemo(() => active.filter(canReview), [active]);
  const engineerCandidates = useMemo(
    () =>
      active.filter(
        (agent) =>
          agent.role === "engineer" ||
          agent.role === "designer" ||
          agent.role === "devops" ||
          agent.role === "researcher",
      ),
    [active],
  );

  const agentOptions = useMemo<InlineEntityOption[]>(
    () =>
      active.map((agent) => ({
        id: agent.id,
        label: agent.name,
        searchText: `${agent.name} ${agent.role} ${agent.title ?? ""}`,
      })),
    [active],
  );
  const techLeadOptions = useMemo<InlineEntityOption[]>(
    () =>
      techLeadCandidates.map((agent) => ({
        id: agent.id,
        label: agent.name,
        searchText: `${agent.name} ${agent.role} ${agent.title ?? ""}`,
      })),
    [techLeadCandidates],
  );
  const reviewerOptions = useMemo<InlineEntityOption[]>(
    () =>
      reviewerCandidates.map((agent) => ({
        id: agent.id,
        label: agent.name,
        searchText: `${agent.name} ${agent.role} ${agent.title ?? ""}`,
      })),
    [reviewerCandidates],
  );
  const engineerOptions = useMemo<InlineEntityOption[]>(
    () =>
      engineerCandidates.map((agent) => ({
        id: agent.id,
        label: agent.name,
        searchText: `${agent.name} ${agent.role} ${agent.title ?? ""}`,
      })),
    [engineerCandidates],
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

  useEffect(() => {
    if (!open) return;
    const initialLead = techLeadCandidates[0]?.id ?? "";
    const initialReviewer =
      reviewerCandidates.find((agent) => agent.id !== initialLead)?.id
      ?? reviewerCandidates[0]?.id
      ?? "";
    const initialEngineer =
      engineerCandidates.find((agent) => agent.id !== initialLead && agent.id !== initialReviewer)?.id
      ?? engineerCandidates[0]?.id
      ?? "";

    setStructuredTitle(issue.title);
    setProjectId(issue.projectId ?? "");
    setPriority(issue.priority);
    setTechLeadAgentId(initialLead);
    setReviewerAgentId(initialReviewer);
    setQaAgentId("");
    setExecutionSummary("");
    setAcceptanceCriteria("- Clarify scope and ship the first delivery slice");
    setDefinitionOfDone("- Root issue is re-routed and child execution is underway");
    setRisks("");
    setOpenQuestions("");
    setDocumentationDebt("");
    setCreateInitialWorkItem(true);
    setWorkItemTitle(`Deliver: ${issue.title}`);
    setWorkItemDescription("");
    setWorkItemAssigneeAgentId(initialEngineer);
    setWorkItemKind("implementation");
  }, [engineerCandidates, issue.priority, issue.projectId, issue.title, open, reviewerCandidates, techLeadCandidates]);

  const projectIssue = useMutation({
    mutationFn: async () =>
      issuesApi.createPmIntakeProjection(issue.id, {
        reason: "Project human intake into a delivery-ready team execution flow",
        techLeadAgentId,
        reviewerAgentId,
        qaAgentId: qaAgentId || null,
        coordinationOnly: !createInitialWorkItem,
        root: {
          structuredTitle: structuredTitle.trim() || undefined,
          projectId: projectId || null,
          priority,
          executionSummary: executionSummary.trim(),
          acceptanceCriteria: parseLineList(acceptanceCriteria),
          definitionOfDone: parseLineList(definitionOfDone),
          risks: parseLineList(risks),
          openQuestions: parseLineList(openQuestions),
          documentationDebt: parseLineList(documentationDebt),
        },
        workItems: createInitialWorkItem
          ? [{
              title: workItemTitle.trim(),
              description: workItemDescription.trim() || null,
              kind: workItemKind,
              projectId: projectId || null,
              priority,
              assigneeAgentId: workItemAssigneeAgentId,
              reviewerAgentId,
              qaAgentId: qaAgentId || null,
              acceptanceCriteria: parseLineList(acceptanceCriteria),
              definitionOfDone: parseLineList(definitionOfDone),
              watchLead: true,
              watchReviewer: true,
            }]
          : [],
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issue.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.protocolState(issue.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(issue.companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardTeamSupervision(issue.companyId, 12) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardProtocolQueue(issue.companyId, 20) });
      pushToast({
        dedupeKey: `activity:intake.projection:${issue.id}`,
        title: "Intake projected to delivery",
        body: createInitialWorkItem
          ? `${result.projectedWorkItems.length} subtask created`
          : "Root issue was re-routed without child work items",
        tone: "success",
      });
      onOpenChange(false);
    },
  });

  const canSubmit =
    techLeadAgentId.length > 0
    && reviewerAgentId.length > 0
    && executionSummary.trim().length > 0
    && parseLineList(acceptanceCriteria).length > 0
    && parseLineList(definitionOfDone).length > 0
    && (!createInitialWorkItem || (workItemTitle.trim().length > 0 && workItemAssigneeAgentId.length > 0));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Project Intake To Delivery</DialogTitle>
          <DialogDescription>
            Turn this human request into a routed delivery issue with TL ownership and an optional initial child work item.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2 md:grid-cols-3">
            <div className="grid gap-2 md:col-span-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Structured Title</label>
              <Input value={structuredTitle} onChange={(event) => setStructuredTitle(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Project</label>
              <InlineEntitySelector
                value={projectId}
                options={projectOptions}
                placeholder="Project"
                noneLabel="Keep current project"
                searchPlaceholder="Search projects..."
                emptyMessage="No projects found."
                onChange={setProjectId}
              />
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-4">
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tech Lead</label>
              <InlineEntitySelector
                value={techLeadAgentId}
                options={techLeadOptions}
                placeholder="Tech lead"
                noneLabel="No tech lead"
                searchPlaceholder="Search TLs..."
                emptyMessage="No tech leads found."
                onChange={setTechLeadAgentId}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reviewer</label>
              <InlineEntitySelector
                value={reviewerAgentId}
                options={reviewerOptions}
                placeholder="Reviewer"
                noneLabel="No reviewer"
                searchPlaceholder="Search reviewers..."
                emptyMessage="No reviewers found."
                onChange={setReviewerAgentId}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">QA Gate</label>
              <InlineEntitySelector
                value={qaAgentId}
                options={reviewerOptions}
                placeholder="Optional QA"
                noneLabel="No QA gate"
                searchPlaceholder="Search QA..."
                emptyMessage="No QA agents found."
                onChange={setQaAgentId}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Priority</label>
              <div className="flex flex-wrap gap-2">
                {(["critical", "high", "medium", "low"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={cn(
                      "rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent/50",
                      priority === value && "bg-accent text-foreground",
                    )}
                    onClick={() => setPriority(value)}
                  >
                    {value.replace(/\b\w/g, (char) => char.toUpperCase())}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Execution Summary</label>
            <Textarea
              value={executionSummary}
              onChange={(event) => setExecutionSummary(event.target.value)}
              rows={4}
              placeholder="Summarize what the delivery issue should produce and how the TL lane should route it."
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
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Risks</label>
              <Textarea value={risks} onChange={(event) => setRisks(event.target.value)} rows={4} />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Open Questions</label>
              <Textarea value={openQuestions} onChange={(event) => setOpenQuestions(event.target.value)} rows={4} />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Documentation Debt</label>
              <Textarea
                value={documentationDebt}
                onChange={(event) => setDocumentationDebt(event.target.value)}
                rows={4}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={createInitialWorkItem}
                onChange={(event) => setCreateInitialWorkItem(event.target.checked)}
              />
              Create initial child work item now
            </label>

            {createInitialWorkItem && (
              <div className="mt-4 grid gap-4">
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="grid gap-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Work Item Title</label>
                    <Input value={workItemTitle} onChange={(event) => setWorkItemTitle(event.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assignee</label>
                    <InlineEntitySelector
                      value={workItemAssigneeAgentId}
                      options={engineerOptions.length > 0 ? engineerOptions : agentOptions}
                      placeholder="Engineer"
                      noneLabel="No assignee"
                      searchPlaceholder="Search agents..."
                      emptyMessage="No agents found."
                      onChange={setWorkItemAssigneeAgentId}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Work Item Kind</label>
                  <div className="flex flex-wrap gap-2">
                    {(["implementation", "plan", "review", "qa"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={cn(
                          "rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent/50",
                          workItemKind === value && "bg-accent text-foreground",
                        )}
                        onClick={() => setWorkItemKind(value)}
                      >
                        {value.replace(/\b\w/g, (char) => char.toUpperCase())}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Work Item Description</label>
                  <Textarea
                    value={workItemDescription}
                    onChange={(event) => setWorkItemDescription(event.target.value)}
                    rows={3}
                    placeholder="Optional delivery slice notes"
                  />
                </div>
              </div>
            )}
          </div>

          {projectIssue.isError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {projectIssue.error instanceof Error ? projectIssue.error.message : "Failed to project intake issue"}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => projectIssue.mutate()} disabled={!canSubmit || projectIssue.isPending}>
            {projectIssue.isPending ? "Projecting..." : "Project to delivery"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
