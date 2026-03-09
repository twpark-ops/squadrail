import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ISSUE_PROTOCOL_MESSAGE_TYPES,
  ISSUE_PROTOCOL_WORKFLOW_STATES,
  ROLE_PACK_FILE_NAMES,
  type IssueProtocolMessageType,
  type IssueProtocolWorkflowState,
  type RolePackFileName,
  type RolePackRoleKey,
  type RolePackSimulationResult,
} from "@squadrail/shared";
import { Button } from "@/components/ui/button";
import { companiesApi } from "../api/companies";

function formatValue(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function defaultMessageType(roleKey: RolePackRoleKey): IssueProtocolMessageType {
  switch (roleKey) {
    case "tech_lead":
      return "ASSIGN_TASK";
    case "engineer":
      return "START_IMPLEMENTATION";
    case "reviewer":
      return "START_REVIEW";
    default:
      return "NOTE";
  }
}

function defaultWorkflowState(roleKey: RolePackRoleKey): IssueProtocolWorkflowState {
  switch (roleKey) {
    case "tech_lead":
      return "backlog";
    case "engineer":
      return "implementing";
    case "reviewer":
      return "submitted_for_review";
    default:
      return "backlog";
  }
}

function defaultIssueSummary(roleKey: RolePackRoleKey) {
  switch (roleKey) {
    case "tech_lead":
      return "Define the next delivery slice, assign ownership, and lock reviewer expectations.";
    case "engineer":
      return "Implement the assigned slice with explicit evidence for review.";
    case "reviewer":
      return "Evaluate correctness, regression risk, and evidence completeness before approval.";
    default:
      return "Simulate how this role should behave for the selected workflow event.";
  }
}

export function RoleSimulationConsole(props: {
  companyId: string;
  rolePackSetId: string;
  roleKey: RolePackRoleKey;
  draftFiles: Record<RolePackFileName, string>;
}) {
  const [workflowState, setWorkflowState] = useState<IssueProtocolWorkflowState>(defaultWorkflowState(props.roleKey));
  const [messageType, setMessageType] = useState<IssueProtocolMessageType>(defaultMessageType(props.roleKey));
  const [issueTitle, setIssueTitle] = useState("Simulated delivery slice");
  const [issueSummary, setIssueSummary] = useState(defaultIssueSummary(props.roleKey));
  const [taskBrief, setTaskBrief] = useState("Focus on the smallest reversible slice with explicit reviewer ownership.");
  const [retrievalSummary, setRetrievalSummary] = useState("Relevant code and design references have already been gathered.");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("Evidence attached\nScope unchanged\nNext owner is clear");
  const [changedFiles, setChangedFiles] = useState("server/src/services/issue-retrieval.ts\nui/src/pages/Dashboard.tsx");
  const [reviewFindings, setReviewFindings] = useState("");
  const [blockerCode, setBlockerCode] = useState("");

  const simulationMutation = useMutation({
    mutationFn: () =>
      companiesApi.simulateRolePack(props.companyId, props.rolePackSetId, {
        scenario: {
          workflowState,
          messageType,
          issueTitle: issueTitle.trim(),
          issueSummary: issueSummary.trim(),
          taskBrief: taskBrief.trim() || null,
          retrievalSummary: retrievalSummary.trim() || null,
          acceptanceCriteria: acceptanceCriteria.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          changedFiles: changedFiles.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          reviewFindings: reviewFindings.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          blockerCode: blockerCode.trim() || null,
        },
        draftFiles: ROLE_PACK_FILE_NAMES.map((filename) => ({
          filename,
          content: props.draftFiles[filename] ?? "",
        })),
      }),
  });

  const runtimeSummary = useMemo(() => simulationMutation.data?.runtimePrompt ?? "", [simulationMutation.data]);

  return (
    <div className="rounded-lg border border-border bg-background/70 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Role Simulation</div>
          <p className="text-xs text-muted-foreground">
            Run a deterministic prompt composition preview against the current draft before publishing.
          </p>
        </div>
        <div className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
          {formatValue(props.roleKey)}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="block">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Workflow state</div>
          <select
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
            value={workflowState}
            onChange={(event) => setWorkflowState(event.target.value as IssueProtocolWorkflowState)}
          >
            {ISSUE_PROTOCOL_WORKFLOW_STATES.map((value) => (
              <option key={value} value={value}>{formatValue(value)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Trigger message</div>
          <select
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
            value={messageType}
            onChange={(event) => setMessageType(event.target.value as IssueProtocolMessageType)}
          >
            {ISSUE_PROTOCOL_MESSAGE_TYPES.map((value) => (
              <option key={value} value={value}>{formatValue(value)}</option>
            ))}
          </select>
        </label>
        <label className="block md:col-span-2">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Issue title</div>
          <input
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
            value={issueTitle}
            onChange={(event) => setIssueTitle(event.target.value)}
          />
        </label>
        <label className="block md:col-span-2">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Issue summary</div>
          <textarea
            className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
            value={issueSummary}
            onChange={(event) => setIssueSummary(event.target.value)}
          />
        </label>
        <label className="block">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Task brief</div>
          <textarea
            className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
            value={taskBrief}
            onChange={(event) => setTaskBrief(event.target.value)}
          />
        </label>
        <label className="block">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Retrieval summary</div>
          <textarea
            className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
            value={retrievalSummary}
            onChange={(event) => setRetrievalSummary(event.target.value)}
          />
        </label>
        <label className="block">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Acceptance criteria</div>
          <textarea
            className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
            value={acceptanceCriteria}
            onChange={(event) => setAcceptanceCriteria(event.target.value)}
          />
        </label>
        <label className="block">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Changed files</div>
          <textarea
            className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 font-mono text-sm outline-none"
            value={changedFiles}
            onChange={(event) => setChangedFiles(event.target.value)}
          />
        </label>
        <label className="block">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Review findings</div>
          <textarea
            className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
            value={reviewFindings}
            onChange={(event) => setReviewFindings(event.target.value)}
          />
        </label>
        <label className="block">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Blocker code</div>
          <input
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
            value={blockerCode}
            onChange={(event) => setBlockerCode(event.target.value)}
            placeholder="Optional"
          />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => simulationMutation.mutate()}
          disabled={simulationMutation.isPending || issueTitle.trim().length === 0 || issueSummary.trim().length === 0}
        >
          {simulationMutation.isPending ? "Simulating..." : "Run simulation"}
        </Button>
        {simulationMutation.isError && (
          <span className="text-xs text-destructive">
            {simulationMutation.error instanceof Error ? simulationMutation.error.message : "Simulation failed"}
          </span>
        )}
      </div>

      {simulationMutation.data && (
        <SimulationResultView result={simulationMutation.data} runtimePrompt={runtimeSummary} />
      )}
    </div>
  );
}

function SimulationResultView(props: { result: RolePackSimulationResult; runtimePrompt: string }) {
  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Suggested messages</div>
          <div className="mt-2 space-y-2">
            {props.result.suggestedMessages.map((message) => (
              <div key={`${message.messageType}-${message.summaryTemplate}`} className="rounded-md border border-border bg-background px-3 py-3">
                <div className="text-xs font-semibold text-foreground">{formatValue(message.messageType)}</div>
                <div className="mt-1 text-sm text-foreground">{message.summaryTemplate}</div>
                <div className="mt-1 text-xs text-muted-foreground">{message.reason}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Checklist</div>
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            {props.result.checklist.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Guardrails</div>
          {props.result.guardrails.length === 0 ? (
            <div className="mt-2 text-sm text-muted-foreground">No explicit hard-stop bullets were detected in the current draft.</div>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-foreground">
              {props.result.guardrails.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Compiled runtime prompt</div>
        <pre className="mt-2 max-h-[720px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-3 text-xs text-foreground">
          {props.runtimePrompt}
        </pre>
      </div>
    </div>
  );
}
