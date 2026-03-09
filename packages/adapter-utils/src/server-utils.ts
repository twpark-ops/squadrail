import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { resolveProtocolRunRequirement, type ProtocolRunRequirement } from "@squadrail/shared";

export interface RunProcessResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

interface RunningProcess {
  child: ChildProcess;
  graceSec: number;
}

type ChildProcessWithEvents = ChildProcess & {
  on(event: "error", listener: (err: Error) => void): ChildProcess;
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): ChildProcess;
};

export const runningProcesses = new Map<string, RunningProcess>();
export const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
export const MAX_EXCERPT_BYTES = 32 * 1024;
const SENSITIVE_ENV_KEY = /(key|token|secret|password|passwd|authorization|cookie)/i;

export function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function parseJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function appendWithCap(prev: string, chunk: string, cap = MAX_CAPTURE_BYTES) {
  const combined = prev + chunk;
  return combined.length > cap ? combined.slice(combined.length - cap) : combined;
}

export function resolvePathValue(obj: Record<string, unknown>, dottedPath: string) {
  const parts = dottedPath.split(".");
  let cursor: unknown = obj;

  for (const part of parts) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
      return "";
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }

  if (cursor === null || cursor === undefined) return "";
  if (typeof cursor === "string") return cursor;
  if (typeof cursor === "number" || typeof cursor === "boolean") return String(cursor);

  try {
    return JSON.stringify(cursor);
  } catch {
    return "";
  }
}

export function renderTemplate(template: string, data: Record<string, unknown>) {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_, path) => resolvePathValue(data, path));
}

export function redactEnvForLogs(env: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    redacted[key] = SENSITIVE_ENV_KEY.test(key) ? "***REDACTED***" : value;
  }
  return redacted;
}

export function buildSquadrailEnv(agent: { id: string; companyId: string }): Record<string, string> {
  const resolveHostForUrl = (rawHost: string): string => {
    const host = rawHost.trim();
    if (!host || host === "0.0.0.0" || host === "::") return "localhost";
    if (host.includes(":") && !host.startsWith("[") && !host.endsWith("]")) return `[${host}]`;
    return host;
  };
  const vars: Record<string, string> = {
    SQUADRAIL_AGENT_ID: agent.id,
    SQUADRAIL_COMPANY_ID: agent.companyId,
  };
  const runtimeHost = resolveHostForUrl(
    process.env.SQUADRAIL_LISTEN_HOST ?? process.env.HOST ?? "localhost",
  );
  const runtimePort = process.env.SQUADRAIL_LISTEN_PORT ?? process.env.PORT ?? "3100";
  const apiUrl = process.env.SQUADRAIL_API_URL ?? `http://${runtimeHost}:${runtimePort}`;
  vars.SQUADRAIL_API_URL = apiUrl;
  return vars;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function buildProtocolTransportSnippet(exampleJson: string) {
  return [
    "python - <<'PY'",
    "import json, os, urllib.request",
    `payload = json.loads(r'''${exampleJson}''')`,
    "req = urllib.request.Request(",
    "    os.environ['SQUADRAIL_API_URL'] + f\"/api/issues/{os.environ['SQUADRAIL_TASK_ID']}/protocol/messages\",",
    "    data=json.dumps(payload).encode(),",
    "    headers={",
    "        'Content-Type': 'application/json',",
    "        'Authorization': f\"Bearer {os.environ['SQUADRAIL_API_KEY']}\",",
    "    },",
    "    method='POST',",
    ")",
    "with urllib.request.urlopen(req) as response:",
    "    print(response.read().decode())",
    "PY",
  ].join("\n");
}

function buildProtocolExampleBodies(requirement: ProtocolRunRequirement) {
  const sender = {
    actorType: "agent",
    actorId: "$SQUADRAIL_AGENT_ID",
    role: requirement.recipientRole,
  };
  const recipients = [
    {
      recipientType: "agent",
      recipientId: "$SQUADRAIL_AGENT_ID",
      role: requirement.recipientRole,
    },
  ];

  switch (requirement.key) {
    case "assignment_engineer":
    case "reassignment_engineer":
      return [
        {
          label: "Minimal ACK_ASSIGNMENT example",
          body: {
            messageType: "ACK_ASSIGNMENT",
            sender,
            recipients,
            workflowStateBefore: "assigned",
            workflowStateAfter: "accepted",
            summary: "Accepted the assignment and confirmed scope.",
            payload: {
              accepted: true,
              understoodScope: "Resolve build-info based service.version behavior in the observability package with focused tests.",
              initialRisks: [
                "Build metadata may be unavailable outside stamped builds and needs a deterministic fallback.",
              ],
            },
            artifacts: [],
          },
        },
        {
          label: "Follow-up START_IMPLEMENTATION example",
          body: {
            messageType: "START_IMPLEMENTATION",
            sender,
            recipients,
            workflowStateBefore: "accepted",
            workflowStateAfter: "implementing",
            summary: "Starting the targeted implementation after accepting scope.",
            payload: {
              implementationMode: "direct",
              activeHypotheses: [
                "runtime/debug build info can provide a version string before falling back to a deterministic default.",
              ],
            },
            artifacts: [],
          },
        },
      ];
    case "implementation_engineer":
      return [
        {
          label: "Minimal REPORT_PROGRESS example",
          body: {
            messageType: "REPORT_PROGRESS",
            sender,
            recipients,
            workflowStateBefore: "implementing",
            workflowStateAfter: "implementing",
            summary: "Progress update with current file targets and remaining validation.",
            payload: {
              progressPercent: 50,
              completedItems: [
                "Scoped the target files and confirmed the fallback behavior to implement.",
              ],
              nextSteps: [
                "Apply the implementation patch.",
                "Run focused observability tests.",
              ],
              risks: [
                "Build-info availability differs between stamped and local builds.",
              ],
              changedFiles: [
                "internal/observability/tracing.go",
                "internal/observability/tracing_test.go",
              ],
              testSummary: null,
            },
            artifacts: [],
          },
        },
        {
          label: "Minimal SUBMIT_FOR_REVIEW example",
          body: {
            messageType: "SUBMIT_FOR_REVIEW",
            sender,
            recipients,
            workflowStateBefore: "implementing",
            workflowStateAfter: "submitted_for_review",
            summary: "Implementation is ready for review with focused validation evidence.",
            payload: {
              implementationSummary: "Removed the hard-coded version and resolved service.version from build info with a deterministic fallback.",
              evidence: [
                "createResource now resolves service.version through a helper before constructing the resource.",
              ],
              reviewChecklist: [
                "Version resolution uses build info before fallback.",
                "Tests cover both resolved and fallback behavior.",
              ],
              changedFiles: [
                "internal/observability/tracing.go",
                "internal/observability/tracing_test.go",
              ],
              testResults: [
                "go test ./internal/observability -count=1",
              ],
              residualRisks: [
                "Fallback remains necessary when build stamping is absent in local builds.",
              ],
              diffSummary: "Added a build-info version helper and regression coverage for fallback behavior.",
            },
            artifacts: [],
          },
        },
      ];
    case "change_request_engineer":
      return [
        {
          label: "Minimal ACK_CHANGE_REQUEST example",
          body: {
            messageType: "ACK_CHANGE_REQUEST",
            sender,
            recipients,
            workflowStateBefore: "changes_requested",
            workflowStateAfter: "implementing",
            summary: "Acknowledged the change request and resumed implementation.",
            payload: {
              acknowledged: true,
              changeRequestIds: [
                "review-item-1",
              ],
              plannedFixOrder: [
                "Address the failing review point first.",
              ],
            },
            artifacts: [],
          },
        },
      ];
    case "review_reviewer":
      return [
        {
          label: "Minimal START_REVIEW example",
          body: {
            messageType: "START_REVIEW",
            sender,
            recipients,
            workflowStateBefore: "submitted_for_review",
            workflowStateAfter: "under_review",
            summary: "Started review on the submitted implementation.",
            payload: {
              reviewCycle: 1,
              reviewFocus: [
                "Acceptance criteria coverage",
                "Focused test evidence",
              ],
              blockingReview: false,
            },
            artifacts: [],
          },
        },
        {
          label: "Minimal APPROVE_IMPLEMENTATION example",
          body: {
            messageType: "APPROVE_IMPLEMENTATION",
            sender,
            recipients,
            workflowStateBefore: "under_review",
            workflowStateAfter: "approved",
            summary: "Implementation satisfies the requested scope and evidence bar.",
            payload: {
              approvalSummary: "Reviewed the patch, focused tests, and residual risks; approval is granted.",
              approvalMode: "agent_review",
              approvalChecklist: [
                "Acceptance criteria are covered.",
                "Focused validation evidence is present.",
              ],
              verifiedEvidence: [
                "Focused test command passed.",
              ],
              residualRisks: [
                "Fallback path remains relevant when build stamping is missing.",
              ],
            },
            artifacts: [],
          },
        },
      ];
    case "approval_tech_lead":
      return [
        {
          label: "Minimal CLOSE_TASK example",
          body: {
            messageType: "CLOSE_TASK",
            sender,
            recipients,
            workflowStateBefore: "approved",
            workflowStateAfter: "done",
            summary: "Closed the task after reviewer approval and verification review.",
            payload: {
              closeReason: "completed",
              closureSummary: "Shipped the requested implementation and completed the review loop.",
              verificationSummary: "Focused tests passed and reviewer approval was recorded before closure.",
              rollbackPlan: "Revert the implementation commit or restore the previous resource version helper.",
              finalArtifacts: [
                "diff artifact attached",
                "test_run artifact attached",
                "approval recorded in protocol",
              ],
              finalTestStatus: "passed",
              mergeStatus: "merge_not_required",
              remainingRisks: [
                "Build metadata still depends on stamping configuration outside local builds.",
              ],
            },
            artifacts: [],
          },
        },
      ];
    default:
      return [];
  }
}

export function renderSquadrailRuntimeNote(input: {
  env: Record<string, string>;
  context: Record<string, unknown>;
}) {
  const runtimeKeys = Object.keys(input.env)
    .filter((key) => key.startsWith("SQUADRAIL_"))
    .sort();

  const issueId = nonEmptyString(input.context.issueId) ?? nonEmptyString(input.context.taskId);
  const wakeReason = nonEmptyString(input.context.wakeReason);
  const protocolMessageType = nonEmptyString(input.context.protocolMessageType);
  const workflowBefore = nonEmptyString(input.context.protocolWorkflowStateBefore);
  const workflowAfter = nonEmptyString(input.context.protocolWorkflowStateAfter);
  const protocolSummary = nonEmptyString(input.context.protocolSummary);
  const protocolRecipientRole = nonEmptyString(input.context.protocolRecipientRole);
  const protocolSenderRole = nonEmptyString(input.context.protocolSenderRole);
  const protocolRequiredRetryCount =
    typeof input.context.protocolRequiredRetryCount === "number"
    && Number.isFinite(input.context.protocolRequiredRetryCount)
      ? input.context.protocolRequiredRetryCount
      : 0;
  const protocolRequiredPreviousRunId = nonEmptyString(input.context.protocolRequiredPreviousRunId);
  const timeoutCode = nonEmptyString(input.context.timeoutCode);
  const reminderCode = nonEmptyString(input.context.reminderCode);
  const latestBriefId = nonEmptyString(input.context.latestBriefId);
  const latestBriefScope = nonEmptyString(input.context.latestBriefScope);
  const retrievalRunId = nonEmptyString(input.context.retrievalRunId);
  const workspaceContext = parseObject(input.context.squadrailWorkspace);
  const workspaceUsage = nonEmptyString(workspaceContext.workspaceUsage);
  const workspaceSource = nonEmptyString(workspaceContext.source);
  const workspaceBranchName = nonEmptyString(workspaceContext.branchName);
  const protocolPayload = parseObject(input.context.protocolPayload);
  const protocolPayloadKeys = Object.keys(protocolPayload).sort();
  const reviewSubmission = parseObject(input.context.reviewSubmission);
  const reviewSubmissionChangedFiles = asStringArray(reviewSubmission.changedFiles);
  const reviewSubmissionChecklist = asStringArray(reviewSubmission.reviewChecklist);
  const reviewSubmissionEvidence = asStringArray(reviewSubmission.evidence);
  const reviewSubmissionTestResults = asStringArray(reviewSubmission.testResults);
  const reviewSubmissionResidualRisks = asStringArray(reviewSubmission.residualRisks);
  const reviewSubmissionImplementationSummary = nonEmptyString(reviewSubmission.implementationSummary);
  const reviewSubmissionDiffSummary = nonEmptyString(reviewSubmission.diffSummary);
  const reviewSubmissionWorkspace = parseObject(reviewSubmission.implementationWorkspace);
  const reviewSubmissionWorkspaceCwd = nonEmptyString(reviewSubmissionWorkspace.cwd);
  const reviewSubmissionDiffArtifact = parseObject(reviewSubmission.diffArtifact);
  const reviewSubmissionDiffLabel = nonEmptyString(reviewSubmissionDiffArtifact.label);
  const reviewSubmissionVerificationArtifacts = parseArray(reviewSubmission.verificationArtifacts)
    .map((item) => parseObject(item))
    .filter((item) => Object.keys(item).length > 0);
  const taskBrief = parseObject(input.context.taskBrief);
  const taskBriefScope = nonEmptyString(taskBrief.scope);
  const taskBriefContent = nonEmptyString(taskBrief.contentMarkdown);
  const taskBriefEvidence = parseArray(taskBrief.evidence)
    .map((item) => parseObject(item))
    .filter((item) => Object.keys(item).length > 0);

  const protocolRequirement = resolveProtocolRunRequirement({
    protocolMessageType,
    protocolRecipientRole,
  });
  const requiredActionLines = (() => {
    if (!protocolRequirement) return [] as string[];

    const requiredMessageTypes = protocolRequirement.requiredMessageTypes.join(", ");
    const firstActionMessageTypes = protocolRequirement.firstActionMessageTypes.join(", ");
    const lines = [
      `- REQUIRED WORKFLOW GATE: this wake expects ${protocolRequirement.description}.`,
      `- The first protocol action before repository work must be one of: ${firstActionMessageTypes}.`,
      `- Before ending this run, you must persist at least one of: ${requiredMessageTypes}.`,
      "- Plain analysis text is not sufficient, and repo inspection does not count as protocol progress.",
      "- If this run ends without the required protocol message, Squadrail will mark the run failed.",
      "- If you are not using a higher-level Squadrail skill, use Bash or curl with `$SQUADRAIL_API_URL`, `Authorization: Bearer $SQUADRAIL_API_KEY`, and `/api/issues/$SQUADRAIL_TASK_ID/protocol/messages`.",
    ];

    if (
      protocolRequirement.key === "assignment_engineer"
      || protocolRequirement.key === "reassignment_engineer"
    ) {
      lines.splice(3, 0, "- Do not start file reads, design notes, or implementation planning before the first protocol action is sent.");
      lines.push("- If you accept and can continue immediately, follow `ACK_ASSIGNMENT` with `START_IMPLEMENTATION` in the same run.");
      lines.push("- After `START_IMPLEMENTATION`, stop this run unless the current workspace is already an isolated implementation workspace.");
      lines.push("- Do not edit files in a shared or analysis workspace after sending `START_IMPLEMENTATION`; wait for the follow-up implementation wake.");
    }

    if (protocolRequirement.key === "implementation_engineer") {
      lines.push("- Work only inside the isolated implementation workspace and finish with review handoff or explicit progress.");
      lines.push("- Stay inside the assigned issue scope. Do not make opportunistic cleanup, refactors, or warning-only fixes outside the requested acceptance criteria.");
      lines.push("- Only run commands that are explicitly required by the issue or directly necessary to make the requested tests pass.");
      lines.push("- Do not run golangci-lint, repo-wide lint, or unrelated validation unless the assignment explicitly requires it.");
      lines.push("- Once the required edits are complete and the named acceptance tests pass, submit for review immediately instead of continuing with extra tooling.");
      lines.push("- If a non-required command fails after the acceptance criteria are already satisfied, do not widen scope chasing it; hand off with the exact required evidence.");
      lines.push("- For `SUBMIT_FOR_REVIEW`, use `workflowStateAfter: \"submitted_for_review\"` exactly.");
      lines.push("- `SUBMIT_FOR_REVIEW.recipients` must include the assigned reviewer agent with role `reviewer`. Reuse the reviewer from the assignment payload or current protocol state.");
      lines.push("- `SUBMIT_FOR_REVIEW.payload` must stay flat. Use only: `implementationSummary`, `evidence[]`, `diffSummary`, `changedFiles[]`, `testResults[]`, `reviewChecklist[]`, `residualRisks[]`.");
      lines.push("- `changedFiles` must be a string array of file paths. Do not send objects inside `changedFiles`.");
      lines.push("- Do not invent nested objects such as `testEvidence`, structured `diffSummary`, `acceptanceCriteriaMet`, or custom residual-risk objects.");
      lines.push("- Prefer leaving `artifacts` empty unless you have a real `diff` or `commit` artifact URI. Squadrail auto-captures `run`, `test_run`, and `build_run` context.");
    }

    if (protocolRequirement.key === "change_request_engineer") {
      lines.push("- Read the full change request details from `protocolPayload.changeRequests[]`, `protocolPayload.reviewSummary`, and `protocolPayload.requiredEvidence[]` before touching code.");
      lines.push("- Treat each requested file target and required evidence item as mandatory scope for the follow-up patch.");
      lines.push("- If you complete the requested fixes in this run, finish with `SUBMIT_FOR_REVIEW` instead of plain text.");
    }

    if (protocolRequirement.key === "review_reviewer") {
      lines.push("- Start review with `START_REVIEW`, then conclude with `APPROVE_IMPLEMENTATION`, `REQUEST_CHANGES`, or `REQUEST_HUMAN_DECISION`.");
      lines.push("- Review artifacts first. The shared review workspace may still reflect base HEAD and can differ from the isolated implementation workspace.");
      lines.push("- Do not reject solely because the shared workspace file still shows the pre-change content; verify against the submitted diff, changed files, evidence, and implementation workspace binding.");
      lines.push("- If you need to inspect exact implementation files, use the implementation workspace path from the review submission context rather than assuming the shared workspace contains the patch.");
      lines.push("- For `REQUEST_CHANGES`, keep `payload` flat and use only `severity`, `reviewSummary`, `changeRequests[]`, `requiredEvidence[]`, and `mustFixBeforeApprove`.");
      lines.push("- For `APPROVE_IMPLEMENTATION`, keep `payload` flat and use only `approvalSummary`, `approvalMode`, `approvalChecklist[]`, `verifiedEvidence[]`, and `residualRisks[]`.");
    }

    if (protocolRequirement.key === "approval_tech_lead") {
      lines.push("- Approval wakes are not complete until a closing decision is recorded in protocol.");
      lines.push("- For `CLOSE_TASK.payload.mergeStatus`, use exactly one of: `merged`, `merge_not_required`, `pending_external_merge`.");
      lines.push("- Never invent aliases such as `merge_pending`, `merge_required`, or free-form merge labels.");
      lines.push("- If code is approved but merge has not happened yet, use `pending_external_merge` and explain the external merge owner in `remainingRisks[]`.");
    }

    if (protocolRequiredRetryCount > 0) {
      lines.unshift(
        `- RETRY WARNING: previous run ${protocolRequiredPreviousRunId ?? "unknown"} ended without required protocol progress.`,
      );
      lines.unshift("- RETRY MODE: complete the required protocol action first. Repeating repository inspection without protocol will fail again.");
    }

    return lines;
  })();
  const protocolExamples = protocolRequirement ? buildProtocolExampleBodies(protocolRequirement) : [];

  if (
    runtimeKeys.length === 0
    && !issueId
    && !wakeReason
    && !protocolMessageType
    && !workflowBefore
    && !workflowAfter
    && !protocolSummary
    && !protocolRecipientRole
    && !protocolSenderRole
    && !timeoutCode
    && !reminderCode
    && !latestBriefId
    && !latestBriefScope
    && !retrievalRunId
    && !taskBriefContent
    && !workspaceUsage
    && !workspaceSource
    && !workspaceBranchName
    && protocolPayloadKeys.length === 0
  ) {
    return "";
  }

  const lines = ["Squadrail runtime note:"];
  if (runtimeKeys.length > 0) {
    lines.push(`Available Squadrail-compatible environment variables: ${runtimeKeys.join(", ")}`);
  }

  const structuredLines: string[] = [];
  if (issueId) structuredLines.push(`- issueId: ${issueId}`);
  if (wakeReason) structuredLines.push(`- wakeReason: ${wakeReason}`);
  if (protocolMessageType) structuredLines.push(`- protocolMessageType: ${protocolMessageType}`);
  if (workflowBefore || workflowAfter) {
    structuredLines.push(`- protocolWorkflow: ${workflowBefore ?? "unknown"} -> ${workflowAfter ?? "unknown"}`);
  }
  if (protocolRecipientRole) structuredLines.push(`- protocolRecipientRole: ${protocolRecipientRole}`);
  if (protocolSenderRole) structuredLines.push(`- protocolSenderRole: ${protocolSenderRole}`);
  if (protocolSummary) structuredLines.push(`- protocolSummary: ${protocolSummary}`);
  if (timeoutCode) structuredLines.push(`- timeoutCode: ${timeoutCode}`);
  if (reminderCode) structuredLines.push(`- reminderCode: ${reminderCode}`);
  if (latestBriefScope) structuredLines.push(`- latestBriefScope: ${latestBriefScope}`);
  if (latestBriefId) structuredLines.push(`- latestBriefId: ${latestBriefId}`);
  if (retrievalRunId) structuredLines.push(`- retrievalRunId: ${retrievalRunId}`);
  if (taskBriefScope) structuredLines.push(`- taskBriefScope: ${taskBriefScope}`);
  if (workspaceSource) structuredLines.push(`- workspaceSource: ${workspaceSource}`);
  if (workspaceUsage) structuredLines.push(`- workspaceUsage: ${workspaceUsage}`);
  if (workspaceBranchName) structuredLines.push(`- workspaceBranchName: ${workspaceBranchName}`);
  if (protocolPayloadKeys.length > 0) {
    structuredLines.push(`- protocolPayloadKeys: ${protocolPayloadKeys.join(", ")}`);
  }
  if (requiredActionLines.length > 0) {
    lines.push("Mandatory protocol gate:");
    lines.push(...requiredActionLines);
    lines.push("");
    lines.push("Use Bash with Python stdlib for protocol POSTs. Avoid curl/wget and avoid permission-gated MCP helpers.");
    for (const example of protocolExamples) {
      const exampleJson = JSON.stringify(example.body, null, 2);
      lines.push("");
      lines.push(`${example.label}:`);
      lines.push("Copy this JSON shape exactly; replace values, do not rename fields or introduce nested substitutes.");
      lines.push("```json");
      lines.push(JSON.stringify(example.body, null, 2));
      lines.push("```");
      lines.push("Python transport example:");
      lines.push("```bash");
      lines.push(buildProtocolTransportSnippet(exampleJson));
      lines.push("```");
    }
    lines.push("");
  }

  if (
    workspaceUsage
    && workspaceUsage !== "implementation"
    && (protocolRequirement?.key === "assignment_engineer" || protocolRequirement?.key === "reassignment_engineer")
  ) {
    lines.push("Workspace guardrail:");
    lines.push(`- Current workspaceUsage is \`${workspaceUsage}\`, so this run is not the final implementation workspace.`);
    lines.push("- You may acknowledge or start implementation in protocol, but do not modify repository files in this run.");
    lines.push("- Wait for the follow-up implementation wake that resolves an isolated workspace before editing code.");
    lines.push("");
  }

  if (structuredLines.length > 0) {
    lines.push("Structured wake context:");
    lines.push(...structuredLines);
  }

  if (protocolRequirement?.key === "change_request_engineer" && Object.keys(protocolPayload).length > 0) {
    const reviewSummary = nonEmptyString(protocolPayload.reviewSummary);
    const changeRequests = parseArray(protocolPayload.changeRequests)
      .map((item) => parseObject(item))
      .filter((item) => Object.keys(item).length > 0);
    const requiredEvidence = asStringArray(protocolPayload.requiredEvidence);
    lines.push("");
    lines.push("Requested review changes:");
    if (reviewSummary) {
      lines.push(`- reviewSummary: ${reviewSummary}`);
    }
    for (const changeRequest of changeRequests.slice(0, 6)) {
      const title = nonEmptyString(changeRequest.title) ?? "Untitled change request";
      const reason = nonEmptyString(changeRequest.reason);
      const affectedFiles = asStringArray(changeRequest.affectedFiles);
      const suggestedAction = nonEmptyString(changeRequest.suggestedAction);
      lines.push(`- ${title}`);
      if (reason) lines.push(`  reason: ${reason}`);
      if (affectedFiles.length > 0) lines.push(`  affectedFiles: ${affectedFiles.join(", ")}`);
      if (suggestedAction) lines.push(`  suggestedAction: ${suggestedAction}`);
    }
    if (requiredEvidence.length > 0) {
      lines.push("- requiredEvidence:");
      for (const entry of requiredEvidence.slice(0, 8)) {
        lines.push(`  - ${entry}`);
      }
    }
  }

  if (protocolRequirement?.key === "review_reviewer" && Object.keys(reviewSubmission).length > 0) {
    lines.push("");
    lines.push("Review submission context:");
    if (reviewSubmissionImplementationSummary) {
      lines.push(`- implementationSummary: ${reviewSubmissionImplementationSummary}`);
    }
    if (reviewSubmissionDiffSummary) {
      lines.push(`- diffSummary: ${reviewSubmissionDiffSummary}`);
    }
    if (reviewSubmissionChangedFiles.length > 0) {
      lines.push(`- changedFiles: ${reviewSubmissionChangedFiles.join(", ")}`);
    }
    if (reviewSubmissionWorkspaceCwd) {
      lines.push(`- implementationWorkspace: ${reviewSubmissionWorkspaceCwd}`);
    }
    if (reviewSubmissionDiffLabel) {
      lines.push(`- diffArtifact: ${reviewSubmissionDiffLabel}`);
    }
    if (reviewSubmissionChecklist.length > 0) {
      lines.push("- reviewChecklist:");
      for (const entry of reviewSubmissionChecklist.slice(0, 8)) {
        lines.push(`  - ${entry}`);
      }
    }
    if (reviewSubmissionEvidence.length > 0) {
      lines.push("- implementationEvidence:");
      for (const entry of reviewSubmissionEvidence.slice(0, 8)) {
        lines.push(`  - ${entry}`);
      }
    }
    if (reviewSubmissionTestResults.length > 0) {
      lines.push("- submittedTestResults:");
      for (const entry of reviewSubmissionTestResults.slice(0, 8)) {
        lines.push(`  - ${entry}`);
      }
    }
    if (reviewSubmissionVerificationArtifacts.length > 0) {
      lines.push("- verificationArtifacts:");
      for (const artifact of reviewSubmissionVerificationArtifacts.slice(0, 6)) {
        const kind = nonEmptyString(artifact.kind) ?? "artifact";
        const label = nonEmptyString(artifact.label);
        const observedStatus = nonEmptyString(artifact.observedStatus) ?? nonEmptyString(artifact.confidence);
        const parts = [kind];
        if (label) parts.push(label);
        if (observedStatus) parts.push(observedStatus);
        lines.push(`  - ${parts.join(" | ")}`);
      }
    }
    if (reviewSubmissionResidualRisks.length > 0) {
      lines.push("- submittedResidualRisks:");
      for (const entry of reviewSubmissionResidualRisks.slice(0, 6)) {
        lines.push(`  - ${entry}`);
      }
    }
  }

  if (taskBriefContent) {
    lines.push("");
    lines.push("Task brief (auto-generated from Squadrail knowledge):");
    lines.push(taskBriefContent);
  }

  if (taskBriefEvidence.length > 0) {
    lines.push("");
    lines.push("Task brief evidence summary:");
    for (const evidence of taskBriefEvidence.slice(0, 6)) {
      const rank = typeof evidence.rank === "number" ? `#${evidence.rank}` : "#?";
      const sourceType = nonEmptyString(evidence.sourceType) ?? "unknown";
      const pathValue = nonEmptyString(evidence.path);
      const titleValue = nonEmptyString(evidence.title);
      const symbolName = nonEmptyString(evidence.symbolName);
      const fusedScore =
        typeof evidence.fusedScore === "number" && Number.isFinite(evidence.fusedScore)
          ? evidence.fusedScore.toFixed(3)
          : null;
      const parts = [rank, sourceType];
      if (pathValue) parts.push(pathValue);
      else if (titleValue) parts.push(titleValue);
      if (symbolName) parts.push(`symbol=${symbolName}`);
      if (fusedScore) parts.push(`score=${fusedScore}`);
      lines.push(`- ${parts.join(" | ")}`);
    }
  }

  lines.push(
    "Treat structured protocol wakes as workflow events. Respect your assigned role, use the Squadrail API/env when needed, and avoid inventing status changes outside the protocol.",
    "",
    "",
  );

  return lines.join("\n");
}

export function defaultPathForPlatform() {
  if (process.platform === "win32") {
    return "C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem";
  }
  return "/usr/local/bin:/opt/homebrew/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin";
}

export function ensurePathInEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (typeof env.PATH === "string" && env.PATH.length > 0) return env;
  if (typeof env.Path === "string" && env.Path.length > 0) return env;
  return { ...env, PATH: defaultPathForPlatform() };
}

export async function ensureAbsoluteDirectory(
  cwd: string,
  opts: { createIfMissing?: boolean } = {},
) {
  if (!path.isAbsolute(cwd)) {
    throw new Error(`Working directory must be an absolute path: "${cwd}"`);
  }

  const assertDirectory = async () => {
    const stats = await fs.stat(cwd);
    if (!stats.isDirectory()) {
      throw new Error(`Working directory is not a directory: "${cwd}"`);
    }
  };

  try {
    await assertDirectory();
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!opts.createIfMissing || code !== "ENOENT") {
      if (code === "ENOENT") {
        throw new Error(`Working directory does not exist: "${cwd}"`);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  try {
    await fs.mkdir(cwd, { recursive: true });
    await assertDirectory();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not create working directory "${cwd}": ${reason}`);
  }
}

export async function ensureCommandResolvable(command: string, cwd: string, env: NodeJS.ProcessEnv) {
  const hasPathSeparator = command.includes("/") || command.includes("\\");
  if (hasPathSeparator) {
    const absolute = path.isAbsolute(command) ? command : path.resolve(cwd, command);
    try {
      await fs.access(absolute, fsConstants.X_OK);
    } catch {
      throw new Error(`Command is not executable: "${command}" (resolved: "${absolute}")`);
    }
    return;
  }

  const pathValue = env.PATH ?? env.Path ?? "";
  const delimiter = process.platform === "win32" ? ";" : ":";
  const dirs = pathValue.split(delimiter).filter(Boolean);
  const windowsExt = process.platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  for (const dir of dirs) {
    for (const ext of windowsExt) {
      const candidate = path.join(dir, process.platform === "win32" ? `${command}${ext}` : command);
      try {
        await fs.access(candidate, fsConstants.X_OK);
        return;
      } catch {
        // continue scanning PATH
      }
    }
  }

  throw new Error(`Command not found in PATH: "${command}"`);
}

export async function runChildProcess(
  runId: string,
  command: string,
  args: string[],
  opts: {
    cwd: string;
    env: Record<string, string>;
    timeoutSec: number;
    graceSec: number;
    onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
    onLogError?: (err: unknown, runId: string, message: string) => void;
    stdin?: string;
  },
): Promise<RunProcessResult> {
  const onLogError = opts.onLogError ?? ((err, id, msg) => console.warn({ err, runId: id }, msg));

  return new Promise<RunProcessResult>((resolve, reject) => {
    const mergedEnv = ensurePathInEnv({ ...process.env, ...opts.env });
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: mergedEnv,
      shell: false,
      stdio: [opts.stdin != null ? "pipe" : "ignore", "pipe", "pipe"],
    }) as ChildProcessWithEvents;

    if (opts.stdin != null && child.stdin) {
      child.stdin.write(opts.stdin);
      child.stdin.end();
    }

    runningProcesses.set(runId, { child, graceSec: opts.graceSec });

    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let logChain: Promise<void> = Promise.resolve();

    const timeout =
      opts.timeoutSec > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => {
              if (!child.killed) {
                child.kill("SIGKILL");
              }
            }, Math.max(1, opts.graceSec) * 1000);
          }, opts.timeoutSec * 1000)
        : null;

    child.stdout?.on("data", (chunk: unknown) => {
      const text = String(chunk);
      stdout = appendWithCap(stdout, text);
      logChain = logChain
        .then(() => opts.onLog("stdout", text))
        .catch((err) => onLogError(err, runId, "failed to append stdout log chunk"));
    });

    child.stderr?.on("data", (chunk: unknown) => {
      const text = String(chunk);
      stderr = appendWithCap(stderr, text);
      logChain = logChain
        .then(() => opts.onLog("stderr", text))
        .catch((err) => onLogError(err, runId, "failed to append stderr log chunk"));
    });

    child.on("error", (err: Error) => {
      if (timeout) clearTimeout(timeout);
      runningProcesses.delete(runId);
      const errno = (err as NodeJS.ErrnoException).code;
      const pathValue = mergedEnv.PATH ?? mergedEnv.Path ?? "";
      const msg =
        errno === "ENOENT"
          ? `Failed to start command "${command}" in "${opts.cwd}". Verify adapter command, working directory, and PATH (${pathValue}).`
          : `Failed to start command "${command}" in "${opts.cwd}": ${err.message}`;
      reject(new Error(msg));
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (timeout) clearTimeout(timeout);
      runningProcesses.delete(runId);
      void logChain.finally(() => {
        resolve({
          exitCode: code,
          signal,
          timedOut,
          stdout,
          stderr,
        });
      });
    });
  });
}
