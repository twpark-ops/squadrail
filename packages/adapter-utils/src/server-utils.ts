import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
export const SQUADRAIL_PROTOCOL_HELPER_ENV_VAR = "SQUADRAIL_PROTOCOL_HELPER_PATH";
const PROTOCOL_HELPER_RELATIVE_PATH = path.join("scripts", "runtime", "squadrail-protocol.mjs");
const CURRENT_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
let protocolTransportGuardDirPromise: Promise<string> | null = null;
let protocolHelperPathPromise: Promise<string> | null = null;

function collectParentDirectories(start: string) {
  const results: string[] = [];
  let current = path.resolve(start);
  while (!results.includes(current)) {
    results.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return results;
}

function escapeForDoubleQuotedBash(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

function getProtocolHelperVarRef() {
  return `$${SQUADRAIL_PROTOCOL_HELPER_ENV_VAR}`;
}

function buildProtocolHelperPathCandidates() {
  const searchRoots = [process.cwd(), CURRENT_MODULE_DIR];
  const candidates: string[] = [];
  for (const root of searchRoots) {
    for (const directory of collectParentDirectories(root)) {
      candidates.push(path.join(directory, PROTOCOL_HELPER_RELATIVE_PATH));
    }
  }
  return Array.from(new Set(candidates));
}

async function assertReadableFile(filePath: string, errorPrefix: string) {
  try {
    await fs.access(filePath, fsConstants.R_OK);
    return filePath;
  } catch {
    throw new Error(`${errorPrefix}: "${filePath}"`);
  }
}

export async function resolveProtocolHelperPath(explicitPath?: string | null): Promise<string> {
  const trimmedExplicit = typeof explicitPath === "string" ? explicitPath.trim() : "";
  if (trimmedExplicit.length > 0) {
    const resolvedExplicit = path.isAbsolute(trimmedExplicit)
      ? trimmedExplicit
      : path.resolve(process.cwd(), trimmedExplicit);
    return assertReadableFile(
      resolvedExplicit,
      "Configured protocol helper path is not readable",
    );
  }

  if (!protocolHelperPathPromise) {
    protocolHelperPathPromise = (async () => {
      const candidates = buildProtocolHelperPathCandidates();
      for (const candidate of candidates) {
        try {
          await fs.access(candidate, fsConstants.R_OK);
          return candidate;
        } catch {
          // continue scanning
        }
      }
      throw new Error(
        `Could not resolve protocol helper path. Expected ${PROTOCOL_HELPER_RELATIVE_PATH} relative to the repo or set ${SQUADRAIL_PROTOCOL_HELPER_ENV_VAR}.`,
      );
    })();
  }

  return protocolHelperPathPromise;
}

export function formatProtocolHelperCommand(command: string) {
  return `node "${getProtocolHelperVarRef()}" ${command} --issue "$SQUADRAIL_TASK_ID" ...`;
}

function buildPythonProtocolGuardScript(defaultHelperPath: string) {
  return `#!/usr/bin/env bash
set -euo pipefail

REAL_PYTHON="/usr/bin/python3"
HELPER_PATH="\${${SQUADRAIL_PROTOCOL_HELPER_ENV_VAR}:-${escapeForDoubleQuotedBash(defaultHelperPath)}}"
BLOCK_MESSAGE="[squadrail] Direct protocol HTTP via python is blocked. Use: node \${HELPER_PATH} <command> --issue \\"$SQUADRAIL_TASK_ID\\" ..."

block_if_protocol_script() {
  local content="$1"
  if printf '%s' "$content" | grep -Eq '/protocol/messages'; then
    printf '%s\\n' "$BLOCK_MESSAGE" >&2
    exit 97
  fi
}

if [[ "\${1:-}" == "-" ]]; then
  tmp_file="$(mktemp)"
  trap 'rm -f "$tmp_file"' EXIT
  cat >"$tmp_file"
  block_if_protocol_script "$(cat "$tmp_file")"
  "$REAL_PYTHON" "$@" <"$tmp_file"
  exit $?
fi

if [[ "\${1:-}" == "-c" ]]; then
  block_if_protocol_script "\${2:-}"
fi

exec "$REAL_PYTHON" "$@"
`;
}

function buildHttpProtocolGuardScript(realBinary: string, toolName: string, defaultHelperPath: string) {
  return `#!/usr/bin/env bash
set -euo pipefail

REAL_BINARY="${realBinary}"
HELPER_PATH="\${${SQUADRAIL_PROTOCOL_HELPER_ENV_VAR}:-${escapeForDoubleQuotedBash(defaultHelperPath)}}"
BLOCK_MESSAGE="[squadrail] Direct protocol HTTP via ${toolName} is blocked. Use: node \${HELPER_PATH} <command> --issue \\"$SQUADRAIL_TASK_ID\\" ..."

if printf '%s' "$*" | grep -Eq '/protocol/messages'; then
  printf '%s\\n' "$BLOCK_MESSAGE" >&2
  exit 97
fi

exec "$REAL_BINARY" "$@"
`;
}

function buildGitWriteGuardScript() {
  const blockedSubcommands = ["commit", "add", "push", "stash", "rebase", "merge", "cherry-pick", "reset", "checkout -- ", "restore"];
  const pattern = blockedSubcommands.join("|");
  return `#!/usr/bin/env bash
set -euo pipefail

REAL_GIT="$(command -v git.real 2>/dev/null || echo /usr/bin/git)"
BLOCK_MESSAGE="[squadrail] QA workspace is read-only. git write operations (commit, add, push, etc.) are blocked. QA may only run commands for execution verification."

if [[ "\${SQUADRAIL_WORKSPACE_READ_ONLY:-}" == "1" ]]; then
  subcmd="\${1:-}"
  case "$subcmd" in
    ${blockedSubcommands.map((cmd) => cmd.split(" ")[0]).join("|")})
      printf '%s\\n' "$BLOCK_MESSAGE" >&2
      exit 97
      ;;
  esac
fi

exec "$REAL_GIT" "$@"
`;
}

async function ensureProtocolTransportGuardDir() {
  if (!protocolTransportGuardDirPromise) {
    protocolTransportGuardDirPromise = (async () => {
      const guardDir = path.join(os.tmpdir(), "squadrail-protocol-guard-bin", String(process.pid));
      const helperPath = await resolveProtocolHelperPath(
        process.env[SQUADRAIL_PROTOCOL_HELPER_ENV_VAR] ?? null,
      );
      await fs.mkdir(guardDir, { recursive: true });
      // Backup real git before shim replaces it
      const realGitPath = path.join(guardDir, "git.real");
      const whichGit = await new Promise<string>((resolve) => {
        const cp = require("node:child_process").execFileSync("which", ["git"], { encoding: "utf8" });
        resolve(cp.trim());
      }).catch(() => "/usr/bin/git");
      await Promise.all([
        fs.writeFile(path.join(guardDir, "python"), buildPythonProtocolGuardScript(helperPath), { mode: 0o755 }),
        fs.writeFile(path.join(guardDir, "python3"), buildPythonProtocolGuardScript(helperPath), { mode: 0o755 }),
        fs.writeFile(
          path.join(guardDir, "curl"),
          buildHttpProtocolGuardScript("/usr/bin/curl", "curl", helperPath),
          { mode: 0o755 },
        ),
        fs.writeFile(path.join(guardDir, "git"), buildGitWriteGuardScript(), { mode: 0o755 }),
        fs.symlink(whichGit, realGitPath).catch(() => null), // OK if exists
      ]);
      return guardDir;
    })();
  }
  return protocolTransportGuardDirPromise;
}

export async function withProtocolTransportGuards(
  env: NodeJS.ProcessEnv,
  options?: { readOnlyWorkspace?: boolean },
): Promise<NodeJS.ProcessEnv> {
  const helperPath = await resolveProtocolHelperPath(env[SQUADRAIL_PROTOCOL_HELPER_ENV_VAR] ?? null);
  const guardDir = await ensureProtocolTransportGuardDir();
  const currentPath = env.PATH ?? process.env.PATH ?? "";
  const pathEntries = currentPath.split(":").filter(Boolean);
  if (pathEntries[0] !== guardDir) {
    env.PATH = [guardDir, ...pathEntries].join(":");
  }
  env[SQUADRAIL_PROTOCOL_HELPER_ENV_VAR] = helperPath;
  if (options?.readOnlyWorkspace) {
    env.SQUADRAIL_WORKSPACE_READ_ONLY = "1";
  }
  return env;
}

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

export function buildProtocolHelperSnippet(messageType: string) {
  const commandByMessageType: Record<string, string> = {
    REASSIGN_TASK: "reassign-task",
    ACK_ASSIGNMENT: "ack-assignment",
    START_IMPLEMENTATION: "start-implementation",
    REPORT_PROGRESS: "report-progress",
    SUBMIT_FOR_REVIEW: "submit-for-review",
    ACK_CHANGE_REQUEST: "ack-change-request",
    START_REVIEW: "start-review",
    REQUEST_CHANGES: "request-changes",
    REQUEST_HUMAN_DECISION: "request-human-decision",
    APPROVE_IMPLEMENTATION: "approve-implementation",
    CLOSE_TASK: "close-task",
  };
  const command = commandByMessageType[messageType];
  if (!command) return null;
  return formatProtocolHelperCommand(command);
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
    case "assignment_supervisor":
    case "reassignment_supervisor":
      return [
        {
          label: "Minimal REASSIGN_TASK example",
          body: {
            messageType: "REASSIGN_TASK",
            sender,
            recipients: [
              {
                recipientType: "agent",
                recipientId: "$TARGET_ASSIGNEE_AGENT_ID",
                role: "engineer",
              },
              {
                recipientType: "agent",
                recipientId: "$TARGET_REVIEWER_AGENT_ID",
                role: "reviewer",
              },
            ],
            workflowStateBefore: "assigned",
            workflowStateAfter: "assigned",
            summary: "Route this issue into the correct execution lane.",
            payload: {
              reason: "Clarified scope and delegated implementation to the owned project lane.",
              newAssigneeAgentId: "$TARGET_ASSIGNEE_AGENT_ID",
              newReviewerAgentId: "$TARGET_REVIEWER_AGENT_ID",
            },
            artifacts: [],
          },
        },
        {
          label: "Minimal ESCALATE_BLOCKER example",
          body: {
            messageType: "ESCALATE_BLOCKER",
            sender,
            recipients: [
              {
                recipientType: "role_group",
                recipientId: "human_board",
                role: "human_board",
              },
            ],
            workflowStateBefore: "assigned",
            workflowStateAfter: "blocked",
            summary: "Escalate because the correct execution owner is still unclear.",
            payload: {
              blockerCode: "needs_human_decision",
              blockingReason: "The issue needs an explicit routing decision before implementation starts.",
              requestedAction: "Clarify the target owner and reviewer, then reassign the task.",
              requestedFrom: "human_board",
            },
            artifacts: [],
          },
        },
      ];
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
      `- Use the local helper for protocol transitions: \`${formatProtocolHelperCommand("<command>")}\`.`,
      "- Do not handcraft Python/curl/urllib/fetch POSTs for protocol messages in this run.",
      "- Any ad-hoc POST to `/protocol/messages` counts as a workflow failure when the helper supports that transition.",
      "- If the helper fails or times out for a supported protocol action, report the blocker and stop instead of retrying with ad-hoc HTTP.",
    ];

    if (
      protocolRequirement.key === "assignment_supervisor"
      || protocolRequirement.key === "reassignment_supervisor"
    ) {
      lines.splice(3, 0, "- You are explicitly allowed to route this issue with `REASSIGN_TASK`.");
      lines.splice(4, 0, "- Do not inspect repository files, search the codebase, or draft implementation notes before the first routing action is recorded.");
      lines.push("- Prefer `REASSIGN_TASK` when the correct execution owner and reviewer are already named in the issue, brief, or assignment payload.");
      lines.push("- Use the local helper command shown in the issue description when available; it is safer than ad-hoc API calls.");
      lines.push("- If ownership is genuinely unclear, use `ASK_CLARIFICATION` or `ESCALATE_BLOCKER` with the missing decision called out explicitly.");
    }

    if (
      protocolRequirement.key === "assignment_engineer"
      || protocolRequirement.key === "reassignment_engineer"
    ) {
      lines.splice(3, 0, "- Do not start file reads, design notes, or implementation planning before the first protocol action is sent.");
      lines.push("- If you accept and can continue immediately, follow `ACK_ASSIGNMENT` with `START_IMPLEMENTATION` in the same run.");
      lines.push("- Do not stop after `ACK_ASSIGNMENT` while the issue is still in `assigned` or `accepted`. ACK-only runs are incomplete and will be retried.");
      lines.push("- After `START_IMPLEMENTATION`, the server coalesces workspace context automatically via `workspaceUsageOverride`. Continue implementing in this run without waiting for a separate wake.");
      lines.push("- If the workspace is shared or analysis-only and no override is present, complete the protocol actions (ACK + START) and stop. The server routes your next wake to an isolated implementation workspace.");
    }

    if (protocolRequirement.key === "implementation_engineer") {
      lines.push("- Work only inside the isolated implementation workspace and finish with review handoff or explicit progress.");
      lines.push("- Stay inside the assigned issue scope. Do not make opportunistic cleanup, refactors, or warning-only fixes outside the requested acceptance criteria.");
      lines.push("- Run only the exact test suite, build, or lint commands needed to verify acceptance criteria. Do not run golangci-lint, repo-wide lint, complexity checks, or unrelated validation.");
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
      lines.push("- Do not stop after `START_REVIEW` while the issue remains in `submitted_for_review` or `under_review`. Review-start-only runs are incomplete and will be retried.");
      lines.push("- Review artifacts first. The shared review workspace may still reflect base HEAD and can differ from the isolated implementation workspace.");
      lines.push("- Do not reject solely because the shared workspace file still shows the pre-change content; verify against the submitted diff, changed files, evidence, and implementation workspace binding.");
      lines.push("- If you need to inspect exact implementation files, use the implementation workspace path from the review submission context rather than assuming the shared workspace contains the patch.");
      lines.push("- For `REQUEST_CHANGES`, keep `payload` flat and use only `severity`, `reviewSummary`, `changeRequests[]`, `requiredEvidence[]`, and `mustFixBeforeApprove`.");
      lines.push("- For `APPROVE_IMPLEMENTATION`, keep `payload` flat and use only `approvalSummary`, `approvalMode`, `approvalChecklist[]`, `verifiedEvidence[]`, and `residualRisks[]`.");
      lines.push("- Valid `approvalMode` values are exactly: `agent_review`, `tech_lead_review`, or `human_override`.");
    }

    if (protocolRequirement.key === "qa_gate_reviewer") {
      lines.push("- You are the QA execution gate reviewer. Your role is to EXECUTE the built software, not just read code or diffs.");
      lines.push("- **Do not create, edit, or delete any source files.** You have implementation workspace access for running commands only. Code changes are the engineer's responsibility.");
      lines.push("- Do not stop after `START_REVIEW` while the issue remains in `qa_pending` or `under_qa_review`. QA-start-only runs are incomplete and will be retried.");
      lines.push("- Start by reading the project runbook from your brief. If no runbook is available, send `ASK_CLARIFICATION` requesting execution instructions before approving.");
      lines.push("- Run the acceptance criteria commands or sanity checks in the project workspace. Record what you ran and what you observed.");
      lines.push("- Do not approve based on code reading alone. You must execute at least one verification command.");
      lines.push("- For `START_REVIEW`, describe your execution plan: which commands, fixtures, or probes you will use.");
      lines.push("- For `APPROVE_IMPLEMENTATION`, include execution evidence in payload: `executionLog` (commands run + output), `outputVerified` (expected vs actual), `sanityCommand` (primary check command), and optionally `fixtureUsed`.");
      lines.push("- For `REQUEST_CHANGES`, include the failure output as evidence: `executionLog` (failed command + output), `failureEvidence` (what went wrong), and `expectedBehavior` (what should have happened).");
    }

    if (protocolRequirement.key === "approval_tech_lead") {
      lines.push("- Approval wakes are not complete until a closing decision is recorded in protocol.");
      lines.push("- Do not idle in `approved`. Record `CLOSE_TASK` or `REQUEST_HUMAN_DECISION` in the same run.");
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
    lines.push(`Use \`${formatProtocolHelperCommand("<command>")}\` for protocol transport.`);
    lines.push("Use the exact helper command forms below; substitute values only and do not handcraft ad-hoc HTTP.");
    for (const example of protocolExamples) {
      const helperSnippet = buildProtocolHelperSnippet(asString(example.body.messageType, ""));
      const payload = parseObject(example.body.payload);
      const payloadKeys = Object.keys(payload);
      lines.push("");
      lines.push(`${example.label}:`);
      if (helperSnippet) {
        lines.push("Exact helper command form:");
        lines.push("```bash");
        lines.push(helperSnippet);
        lines.push("```");
      }
      if (payloadKeys.length > 0) {
        lines.push(`Required payload keys: ${payloadKeys.join(", ")}`);
      }
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
    lines.push("- You may acknowledge assignment and start implementation in protocol, but do not modify repository files in this workspace.");
    lines.push("- The server will coalesce workspace context on your next wake. If `workspaceUsageOverride` is provided, you will land in the correct implementation workspace automatically.");
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
    onLog: (stream: "stdout" | "stderr" | "system", chunk: string) => Promise<void>;
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
