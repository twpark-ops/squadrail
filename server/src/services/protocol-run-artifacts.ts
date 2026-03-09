import type { CreateIssueProtocolMessage } from "@squadrail/shared";
import type { RunVerificationSignal } from "./run-verification-signals.js";
import { extractRunVerificationSignals } from "./run-verification-signals.js";
import { inspectWorkspaceGitSnapshot } from "./workspace-git-snapshot.js";

type ProtocolRunLike = {
  id: string;
  companyId: string;
  agentId: string;
  invocationSource: string | null;
  status: string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  stdoutExcerpt: string | null;
  stderrExcerpt: string | null;
  resultJson?: Record<string, unknown> | null;
  contextSnapshot: Record<string, unknown> | null;
};

type WorkspaceContext = {
  cwd: string | null;
  source: string | null;
  projectId: string | null;
  workspaceId: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  workspaceUsage: string | null;
  branchName: string | null;
  workspaceState: string | null;
  hasLocalChanges: boolean | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function truncateLabel(value: string, max = 120) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function dedupeArtifacts(artifacts: RequestProtocolArtifact[]) {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    const key = `${artifact.kind}:${artifact.uri}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractWorkspaceContext(run: ProtocolRunLike): WorkspaceContext | null {
  const context = asRecord(run.contextSnapshot);
  const workspace = asRecord(context.squadrailWorkspace);
  if (Object.keys(workspace).length === 0) return null;
  return {
    cwd: readString(workspace.cwd),
    source: readString(workspace.source),
    projectId: readString(workspace.projectId),
    workspaceId: readString(workspace.workspaceId),
    repoUrl: readString(workspace.repoUrl),
    repoRef: readString(workspace.repoRef),
    workspaceUsage: readString(workspace.workspaceUsage),
    branchName: readString(workspace.branchName),
    workspaceState: readString(workspace.workspaceState),
    hasLocalChanges:
      typeof workspace.hasLocalChanges === "boolean" ? workspace.hasLocalChanges : null,
  };
}

function deriveRunIssueScope(run: ProtocolRunLike) {
  const context = asRecord(run.contextSnapshot);
  const issueId = readString(context.issueId);
  const taskId = readString(context.taskId);
  return issueId ?? taskId;
}

export function runMatchesIssueScope(run: ProtocolRunLike, issueId: string) {
  return deriveRunIssueScope(run) === issueId;
}

function collectEvidenceLines(message: CreateIssueProtocolMessage) {
  const payload = asRecord(message.payload);
  return Array.from(new Set([
    ...readStringArray(payload.evidence),
    ...readStringArray(payload.testResults),
    ...readStringArray(payload.requiredEvidence),
    ...readStringArray(payload.verifiedEvidence),
    ...readStringArray(payload.finalArtifacts),
    ...readStringArray(payload.followUpActions),
    ...readStringArray(payload.remainingRisks),
    readString(payload.diffSummary),
    readString(payload.verificationSummary),
    readString(payload.closureSummary),
  ].filter((entry): entry is string => Boolean(entry))));
}

const TEST_EVIDENCE_RE = /\b(vitest|jest|pytest|go test|cargo test|pnpm test|npm test|bun test|rspec|xcodebuild test|ctest|test(s)?\b)\b/i;
const BUILD_EVIDENCE_RE = /\b(vite build|next build|nuxt build|docker build|gradle build|mvn (package|install|verify)|tsc\b|webpack|rollup|esbuild|compile|build\b|bundle\b)\b/i;

function buildRunEvidenceText(run: ProtocolRunLike) {
  return [
    run.stdoutExcerpt ?? "",
    run.stderrExcerpt ?? "",
    run.resultJson ? JSON.stringify(run.resultJson) : "",
  ].filter(Boolean).join("\n");
}

function autoArtifactMetadata(input: {
  run: ProtocolRunLike;
  issueId: string;
  workspace: WorkspaceContext | null;
  evidenceLines?: string[];
}) {
  return {
    autoCaptured: true,
    runId: input.run.id,
    issueId: input.issueId,
    invocationSource: input.run.invocationSource,
    runStatus: input.run.status,
    startedAt: input.run.startedAt,
    finishedAt: input.run.finishedAt,
    workspace: input.workspace,
    ...(input.evidenceLines && input.evidenceLines.length > 0
      ? { evidenceLines: input.evidenceLines }
      : {}),
    ...(input.run.stdoutExcerpt ? { stdoutExcerpt: input.run.stdoutExcerpt } : {}),
    ...(input.run.stderrExcerpt ? { stderrExcerpt: input.run.stderrExcerpt } : {}),
  };
}

export async function enrichProtocolMessageArtifactsFromRun(input: {
  message: CreateIssueProtocolMessage;
  run: ProtocolRunLike;
  issueId: string;
  liveLogContent?: string | null;
}) {
  const workspace = extractWorkspaceContext(input.run);
  const runEvidenceText = buildRunEvidenceText(input.run);
  const verificationSignals = extractRunVerificationSignals({
    stdoutExcerpt: input.run.stdoutExcerpt,
    stderrExcerpt: input.run.stderrExcerpt,
    resultJson: input.run.resultJson ?? null,
    logContent: input.liveLogContent ?? null,
  }) as RunVerificationSignal[];
  const workspaceGitSnapshot =
    workspace?.cwd && workspace.workspaceUsage === "implementation"
      ? await inspectWorkspaceGitSnapshot({
          cwd: workspace.cwd,
          branchName: workspace.branchName,
        })
      : null;
  const autoArtifacts: RequestProtocolArtifact[] = [
    {
      kind: "run",
      uri: `run://${input.run.id}`,
      label: `Heartbeat run ${input.run.id.slice(0, 8)}`,
      metadata: autoArtifactMetadata({
        run: input.run,
        issueId: input.issueId,
        workspace,
      }),
    },
  ];

  if (input.message.messageType === "APPROVE_IMPLEMENTATION") {
    autoArtifacts.push({
      kind: "approval",
      uri: `approval://${input.issueId}/${input.run.id}`,
      label: "Approval evidence",
      metadata: {
        ...autoArtifactMetadata({
          run: input.run,
          issueId: input.issueId,
          workspace,
        }),
        approvalMode: asRecord(input.message.payload).approvalMode ?? null,
      },
    });
  }

  if (workspace?.workspaceUsage === "implementation") {
    autoArtifacts.push({
      kind: "doc",
      uri: `workspace://${workspace.workspaceId ?? workspace.projectId ?? input.issueId}/binding`,
      label: `Workspace binding ${workspace.source ?? "unknown"}`,
      metadata: {
        ...autoArtifactMetadata({
          run: input.run,
          issueId: input.issueId,
          workspace,
        }),
        bindingType: "implementation_workspace",
        bindingStatus: "resolved",
        cwd: workspace.cwd,
        branchName: workspaceGitSnapshot?.branchName ?? workspace.branchName,
        expectedBranchName: workspaceGitSnapshot?.expectedBranchName ?? workspace.branchName,
        branchMismatch: workspaceGitSnapshot?.branchMismatch ?? false,
        workspaceState: workspace.workspaceState,
        hasLocalChanges: workspace.hasLocalChanges,
        repoUrl: workspace.repoUrl,
        repoRef: workspace.repoRef,
        headSha: workspaceGitSnapshot?.headSha ?? null,
      },
    });
  }

  if (workspace?.workspaceUsage === "implementation" && workspaceGitSnapshot?.hasChanges) {
    autoArtifacts.push({
      kind: "diff",
      uri: `run://${input.run.id}/workspace-diff`,
      label: truncateLabel(
        workspaceGitSnapshot.diffStat
          ?? `Workspace diff (${workspaceGitSnapshot.changedFiles.length} file(s))`,
      ),
      metadata: {
        ...autoArtifactMetadata({
          run: input.run,
          issueId: input.issueId,
          workspace,
        }),
        captureConfidence: "workspace_snapshot",
        branchName: workspaceGitSnapshot.branchName,
        expectedBranchName: workspaceGitSnapshot.expectedBranchName,
        branchMismatch: workspaceGitSnapshot.branchMismatch,
        workspaceState: workspace.workspaceState,
        hasLocalChanges: workspace.hasLocalChanges,
        headSha: workspaceGitSnapshot.headSha,
        changedFiles: workspaceGitSnapshot.changedFiles,
        statusEntries: workspaceGitSnapshot.statusEntries,
        diffStat: workspaceGitSnapshot.diffStat,
      },
    });
  }

  const evidenceLines = collectEvidenceLines(input.message);
  const testSignals = verificationSignals.filter((signal) => signal.kind === "test");
  const buildSignals = verificationSignals.filter((signal) => signal.kind === "build");
  const trustedTestSignals = testSignals.filter((signal) => signal.status !== "failed");
  const trustedBuildSignals = buildSignals.filter((signal) => signal.status !== "failed");
  const hasStructuredTestSignals = testSignals.some((signal) => signal.confidence === "structured");
  const hasStructuredBuildSignals = buildSignals.some((signal) => signal.confidence === "structured");
  const testSignalCommands = trustedTestSignals.map((signal) => signal.command);
  const buildSignalCommands = trustedBuildSignals.map((signal) => signal.command);
  const testCaptureConfidence = trustedTestSignals.some((signal) => signal.confidence === "structured")
    ? "structured"
    : "corroborated";
  const buildCaptureConfidence = trustedBuildSignals.some((signal) => signal.confidence === "structured")
    ? "structured"
    : "corroborated";
  const runShowsTestSignal =
    trustedTestSignals.length > 0 || (!hasStructuredTestSignals && TEST_EVIDENCE_RE.test(runEvidenceText));
  const runShowsBuildSignal =
    trustedBuildSignals.length > 0 || (!hasStructuredBuildSignals && BUILD_EVIDENCE_RE.test(runEvidenceText));
  const testEvidence = runShowsTestSignal
    ? evidenceLines.filter((line) => TEST_EVIDENCE_RE.test(line))
    : [];
  const buildEvidence = runShowsBuildSignal
    ? evidenceLines.filter((line) => BUILD_EVIDENCE_RE.test(line))
    : [];

  if (testEvidence.length > 0) {
    autoArtifacts.push({
      kind: "test_run",
      uri: `run://${input.run.id}/test`,
      label: truncateLabel(testEvidence[0] ?? "Reported test evidence"),
      metadata: {
        ...autoArtifactMetadata({
          run: input.run,
          issueId: input.issueId,
          workspace,
          evidenceLines: testEvidence,
        }),
        captureConfidence: testCaptureConfidence,
        observedCommands: testSignalCommands,
        observedStatuses: trustedTestSignals.map((signal) => signal.status),
      },
    });
  }

  if (buildEvidence.length > 0) {
    autoArtifacts.push({
      kind: "build_run",
      uri: `run://${input.run.id}/build`,
      label: truncateLabel(buildEvidence[0] ?? "Reported build evidence"),
      metadata: {
        ...autoArtifactMetadata({
          run: input.run,
          issueId: input.issueId,
          workspace,
          evidenceLines: buildEvidence,
        }),
        captureConfidence: buildCaptureConfidence,
        observedCommands: buildSignalCommands,
        observedStatuses: trustedBuildSignals.map((signal) => signal.status),
      },
    });
  }

  return {
    ...input.message,
    artifacts: dedupeArtifacts([
      ...((input.message.artifacts ?? []) as RequestProtocolArtifact[]),
      ...autoArtifacts,
    ]),
  };
}
type RequestProtocolArtifact = NonNullable<CreateIssueProtocolMessage["artifacts"]>[number];
