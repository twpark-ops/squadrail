import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCheck,
  Copy,
  ExternalLink,
  FileDiff,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  Rocket,
  ShieldCheck,
  TestTube2,
  XCircle,
} from "lucide-react";
import type { IssueChangeSurface } from "@squadrail/shared";
import {
  issuesApi,
  type MergeAutomationActionResult,
  type MergeCandidateAutomationInput,
  type MergeCandidateResolutionInput,
} from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { relativeTime } from "@/lib/utils";
import { Link } from "@/lib/router";
import { MarkdownDiffView } from "./MarkdownDiffView";
import { CopyText } from "./CopyText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/context/ToastContext";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function titleCase(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function toneClass(state: string | null | undefined) {
  switch (state) {
    case "merged":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
    case "pending":
    case "running":
    case "queued":
      return "border-amber-500/25 bg-amber-500/10 text-amber-100";
    case "rejected":
    case "failed":
      return "border-rose-500/25 bg-rose-500/10 text-rose-100";
    default:
      return "border-border bg-background/70 text-muted-foreground";
  }
}

function readDiffPreview(surface: IssueChangeSurface) {
  const metadata = asRecord(surface.diffArtifact?.metadata);
  if (!metadata) return null;

  const baselineText =
    readString(metadata.baselineText) ??
    readString(metadata.baselineMarkdown) ??
    readString(metadata.beforeText);
  const candidateText =
    readString(metadata.candidateText) ??
    readString(metadata.candidateMarkdown) ??
    readString(metadata.afterText);

  if (!baselineText || !candidateText) return null;

  return {
    baselineLabel:
      readString(metadata.baselineLabel) ??
      readString(metadata.beforeLabel) ??
      "Baseline",
    candidateLabel:
      readString(metadata.candidateLabel) ??
      readString(metadata.afterLabel) ??
      "Candidate",
    baselineText,
    candidateText,
  };
}

function actionResultSummary(result: MergeAutomationActionResult | null) {
  if (!result) return null;
  return [
    result.patchPath,
    result.prBundlePath,
    result.prPayloadPath,
    result.automationWorktreePath,
    result.targetBranch,
    result.pushedBranch,
    result.mergeCommitSha,
    result.externalUrl,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function countLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function ChangeReviewDesk({
  companyId,
  issueId,
  issueRef,
  issueTitle,
  reviewHref,
  workHref,
  surface,
  compact = false,
  onRefresh,
}: {
  companyId: string | null;
  issueId: string;
  issueRef: string;
  issueTitle: string;
  reviewHref: string;
  workHref: string;
  surface: IssueChangeSurface | null | undefined;
  compact?: boolean;
  onRefresh?: () => void;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [operatorNote, setOperatorNote] = useState("");
  const [targetBaseBranch, setTargetBaseBranch] = useState("");
  const [preparedBranchName, setPreparedBranchName] = useState("");
  const [remoteName, setRemoteName] = useState("");
  const [mergeCommitSha, setMergeCommitSha] = useState("");
  const [latestAutomationResult, setLatestAutomationResult] =
    useState<MergeAutomationActionResult | null>(null);

  useEffect(() => {
    setOperatorNote(surface?.mergeCandidate?.operatorNote ?? "");
    setTargetBaseBranch(surface?.mergeCandidate?.targetBaseBranch ?? "");
    setPreparedBranchName(
      readString(asRecord(surface?.mergeCandidate?.automationMetadata)?.lastPreparedBranch) ??
        surface?.branchName ??
        ""
    );
    setRemoteName(
      readString(asRecord(surface?.mergeCandidate?.automationMetadata)?.lastPushRemote) ?? "origin"
    );
    setMergeCommitSha(surface?.mergeCandidate?.mergeCommitSha ?? "");
    setLatestAutomationResult(null);
  }, [surface, issueId]);

  const diffPreview = useMemo(
    () => (surface ? readDiffPreview(surface) : null),
    [surface]
  );
  const automationSummary = useMemo(
    () => actionResultSummary(latestAutomationResult),
    [latestAutomationResult]
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.issues.changeSurface(issueId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.issues.detail(issueId),
    });
    if (companyId) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.issues.list(companyId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.dashboardProtocolQueue(companyId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard(companyId),
      });
    }
    onRefresh?.();
  };

  const resolveMutation = useMutation({
    mutationFn: (input: MergeCandidateResolutionInput) =>
      issuesApi.resolveMergeCandidate(issueId, input),
    onSuccess: (candidate, input) => {
      invalidate();
      pushToast({
        title:
          input.actionType === "mark_merged"
            ? `${issueRef} marked merged`
            : `${issueRef} marked rejected`,
        body: candidate.operatorNote ?? issueTitle,
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Merge candidate update failed",
        body: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    },
  });

  const automationMutation = useMutation({
    mutationFn: (input: MergeCandidateAutomationInput) =>
      issuesApi.runMergeCandidateAutomation(issueId, input),
    onSuccess: ({ result }) => {
      setLatestAutomationResult(result);
      invalidate();
      const summary =
        result.patchPath ??
        result.prBundlePath ??
        result.automationWorktreePath ??
        result.pushedBranch ??
        result.mergeCommitSha ??
        issueTitle;
      pushToast({
        title: `${titleCase(result.actionType)} completed`,
        body: summary,
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Merge automation failed",
        body: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    },
  });

  if (!surface) {
    return (
      <section className="rounded-[1.55rem] border border-border bg-card px-5 py-4.5 shadow-card">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FileDiff className="h-4 w-4 text-primary" />
          Review desk
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Change surface is not available yet for this issue.
        </p>
      </section>
    );
  }

  const mergeCandidate = surface.mergeCandidate;
  const prBridge = mergeCandidate?.prBridge ?? null;
  const gateStatus = mergeCandidate?.gateStatus ?? null;
  const conflictAssist = mergeCandidate?.conflictAssist ?? null;
  const failureAssist = mergeCandidate?.failureAssist ?? null;
  const mergeBlocked = Boolean(prBridge && gateStatus && gateStatus.mergeReady === false);
  const busy = resolveMutation.isPending || automationMutation.isPending;

  return (
    <section className="rounded-[1.55rem] border border-border bg-card px-5 py-4.5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/90">
            <FileDiff className="h-3.5 w-3.5" />
            {compact ? "Primary review desk" : "Operator review desk"}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              {issueRef} · {issueTitle}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Branch, workspace, verification, and merge follow-through in one review surface.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" className="rounded-full">
            <Link to={reviewHref}>
              Open review
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="rounded-full">
            <Link to={workHref}>
              Open work
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[1rem] border border-border bg-background/72 px-4 py-3.5">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Source branch
          </div>
          <div className="mt-2 text-sm font-semibold text-foreground">
            {surface.branchName ?? mergeCandidate?.sourceBranch ?? "No branch"}
          </div>
          {surface.branchName && (
            <CopyText
              text={surface.branchName}
              className="mt-2 inline-flex items-center gap-1 text-xs text-primary"
            >
              <span className="inline-flex items-center gap-1">
                <Copy className="h-3 w-3" />
                Copy branch
              </span>
            </CopyText>
          )}
        </div>
        <div className="rounded-[1rem] border border-border bg-background/72 px-4 py-3.5">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Workspace path
          </div>
          <div className="mt-2 truncate text-sm font-medium text-foreground">
            {surface.workspacePath ?? mergeCandidate?.workspacePath ?? "No workspace"}
          </div>
          {surface.workspacePath && (
            <CopyText
              text={surface.workspacePath}
              className="mt-2 inline-flex items-center gap-1 text-xs text-primary"
            >
              <span className="inline-flex items-center gap-1">
                <FolderGit2 className="h-3 w-3" />
                Copy workspace
              </span>
            </CopyText>
          )}
        </div>
        <div className="rounded-[1rem] border border-border bg-background/72 px-4 py-3.5">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Diff summary
          </div>
          <div className="mt-2 text-sm font-semibold text-foreground">
            {surface.diffStat ?? mergeCandidate?.diffStat ?? "No diff summary"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {surface.changedFiles.length} files · {surface.statusEntries.length} status entries
          </div>
        </div>
        <div className="rounded-[1rem] border border-border bg-background/72 px-4 py-3.5">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Merge state
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={toneClass(mergeCandidate?.state ?? surface.workspaceState)}>
              {titleCase(mergeCandidate?.state ?? surface.workspaceState)}
            </Badge>
            {surface.headSha && (
              <span className="font-mono text-xs text-muted-foreground">
                {surface.headSha.slice(0, 12)}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {surface.verificationArtifacts.length} verification artifacts attached
          </div>
        </div>
      </div>

      {mergeCandidate && (
        <div className="mt-4 grid gap-3 xl:grid-cols-4">
          <div className="rounded-[1rem] border border-border bg-background/72 px-4 py-3.5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              PR bridge
            </div>
            {prBridge ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={toneClass(prBridge.state)}>
                    {titleCase(prBridge.provider)} · {titleCase(prBridge.state)}
                  </Badge>
                  {prBridge.number ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      #{prBridge.number}
                    </span>
                  ) : null}
                </div>
                {prBridge.url ? (
                  <a
                    href={prBridge.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-primary"
                  >
                    Open external review
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">
                    External PR URL not synced yet.
                  </div>
                )}
                <div className="mt-2 text-xs text-muted-foreground">
                  {prBridge.repoOwner}/{prBridge.repoName}
                </div>
              </>
            ) : (
              <div className="mt-2 text-sm text-muted-foreground">
                Draft PR has not been created or synced yet.
              </div>
            )}
          </div>

          <div className="rounded-[1rem] border border-border bg-background/72 px-4 py-3.5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Mergeability
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={toneClass(prBridge?.mergeability ?? "unknown")}>
                {titleCase(prBridge?.mergeability ?? "unknown")}
              </Badge>
              {prBridge?.reviewDecision ? (
                <Badge variant="outline">
                  Review {titleCase(prBridge.reviewDecision)}
                </Badge>
              ) : null}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {prBridge
                ? `${countLabel(prBridge.commentCount, "comment")} · ${countLabel(prBridge.reviewCommentCount, "review note")}`
                : "Human final review remains outside Squadrail."}
            </div>
          </div>

          <div className="rounded-[1rem] border border-border bg-background/72 px-4 py-3.5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              CI gate
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={toneClass(gateStatus?.mergeReady ? "merged" : prBridge ? "pending" : "unknown")}
              >
                {gateStatus
                  ? gateStatus.mergeReady
                    ? "Merge ready"
                    : "Blocked"
                  : "Not synced"}
              </Badge>
              {gateStatus?.requiredChecksConfigured ? (
                <Badge variant="outline">Required checks</Badge>
              ) : null}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {prBridge
                ? `${prBridge.checkSummary.passing}/${prBridge.checkSummary.total} passing · ${prBridge.checkSummary.pending} pending · ${prBridge.checkSummary.failing} failing`
                : "Sync PR status to evaluate checks."}
            </div>
          </div>

          <div className="rounded-[1rem] border border-border bg-background/72 px-4 py-3.5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Review branch
            </div>
            <div className="mt-2 text-sm font-semibold text-foreground">
              {(prBridge?.headBranch ?? preparedBranchName) || "No branch"}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Base {(prBridge?.baseBranch ?? targetBaseBranch) || "unknown"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {prBridge?.lastSyncedAt
                ? `Last synced ${relativeTime(prBridge.lastSyncedAt)}`
                : "Not synced yet"}
            </div>
          </div>
        </div>
      )}

      {gateStatus?.blockingReasons.length ? (
        <div className="mt-4 rounded-[0.95rem] border border-amber-500/20 bg-amber-500/8 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-100">
            <AlertTriangle className="h-3.5 w-3.5" />
            Merge gate blockers
          </div>
          <ul className="mt-3 space-y-2 text-sm text-amber-50">
            {gateStatus.blockingReasons.map((reason) => (
              <li key={reason} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-200" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {conflictAssist && conflictAssist.status !== "clean" ? (
        <div className="mt-4 rounded-[0.95rem] border border-red-500/20 bg-red-500/8 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-red-100">
            <AlertTriangle className="h-3.5 w-3.5" />
            Merge conflict assist
          </div>
          <div className="mt-3 text-sm text-red-50">{conflictAssist.summary}</div>
          {conflictAssist.blockers.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm text-red-50">
              {conflictAssist.blockers.map((reason) => (
                <li key={reason} className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-200" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {conflictAssist.suggestedActions.length > 0 ? (
            <div className="mt-3 space-y-1 text-xs text-red-100/90">
              {conflictAssist.suggestedActions.map((action) => (
                <div key={action}>{action}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {failureAssist && failureAssist.status !== "clean" ? (
        <div className="mt-4 rounded-[0.95rem] border border-blue-500/20 bg-blue-500/8 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-100">
            <AlertTriangle className="h-3.5 w-3.5" />
            Failure learning gate
          </div>
          <div className="mt-3 text-sm text-blue-50">{failureAssist.summary}</div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-blue-100/90">
            <span className="rounded-full border border-blue-300/30 px-2.5 py-1">
              {failureAssist.retryability.replace(/_/g, " ")}
            </span>
            {failureAssist.failureFamily ? (
              <span className="rounded-full border border-blue-300/30 px-2.5 py-1">
                {failureAssist.failureFamily.replace(/_/g, " ")}
              </span>
            ) : null}
            <span className="rounded-full border border-blue-300/30 px-2.5 py-1">
              {failureAssist.repeatedFailureCount24h} repeated hits / 24h
            </span>
            {failureAssist.lastSeenAt ? (
              <span className="rounded-full border border-blue-300/30 px-2.5 py-1">
                Last seen {relativeTime(failureAssist.lastSeenAt)}
              </span>
            ) : null}
          </div>
          {failureAssist.blockers.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm text-blue-50">
              {failureAssist.blockers.map((reason) => (
                <li key={reason} className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-200" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {failureAssist.suggestedActions.length > 0 ? (
            <div className="mt-3 space-y-1 text-xs text-blue-100/90">
              {failureAssist.suggestedActions.map((action) => (
                <div key={action}>{action}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[1rem] border border-border bg-background/72 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <GitCommitHorizontal className="h-4 w-4 text-primary" />
            Diff preview
          </div>
          {diffPreview ? (
            <div className="mt-4">
              <MarkdownDiffView
                baselineLabel={diffPreview.baselineLabel}
                candidateLabel={diffPreview.candidateLabel}
                baselineText={diffPreview.baselineText}
                candidateText={diffPreview.candidateText}
              />
            </div>
          ) : (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-[0.95rem] border border-border bg-card px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Changed files
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {surface.changedFiles.length > 0 ? (
                    surface.changedFiles.slice(0, compact ? 8 : 12).map((file) => (
                      <span
                        key={file}
                        className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground"
                      >
                        {file}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      No changed files captured yet.
                    </span>
                  )}
                </div>
              </div>
              <div className="rounded-[0.95rem] border border-border bg-card px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Status entries
                </div>
                <div className="mt-3 space-y-2">
                  {surface.statusEntries.length > 0 ? (
                    surface.statusEntries
                      .slice(0, compact ? 6 : 10)
                      .map((entry) => (
                        <div
                          key={entry}
                          className="rounded-md border border-border/80 bg-background px-2.5 py-2 text-xs text-foreground"
                        >
                          {entry}
                        </div>
                      ))
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      No git status entries captured yet.
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-[1rem] border border-border bg-background/72 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Verification and handoff
          </div>
          <div className="mt-4 space-y-3">
            {mergeCandidate?.approvalSummary && (
              <div className="rounded-[0.95rem] border border-border bg-card px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Approval
                </div>
                <div className="mt-2 text-sm text-foreground">
                  {mergeCandidate.approvalSummary}
                </div>
              </div>
            )}
            {surface.verificationSummary && (
              <div className="rounded-[0.95rem] border border-border bg-card px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Verification summary
                </div>
                <div className="mt-2 text-sm text-foreground">
                  {surface.verificationSummary}
                </div>
              </div>
            )}
            {mergeCandidate?.rollbackPlan && (
              <div className="rounded-[0.95rem] border border-border bg-card px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Rollback plan
                </div>
                <div className="mt-2 text-sm text-foreground">
                  {mergeCandidate.rollbackPlan}
                </div>
              </div>
            )}
            <div className="rounded-[0.95rem] border border-border bg-card px-3 py-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <TestTube2 className="h-3.5 w-3.5" />
                Verification artifacts
              </div>
              <div className="mt-3 space-y-2">
                {surface.verificationArtifacts.length > 0 ? (
                  surface.verificationArtifacts.map((artifact) => (
                    <div
                      key={`${artifact.messageId}:${artifact.uri}`}
                      className="rounded-md border border-border/80 bg-background px-2.5 py-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">
                            {artifact.label ?? artifact.kind}
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {artifact.uri}
                          </div>
                        </div>
                        <div className="shrink-0 text-xs text-muted-foreground">
                          {relativeTime(artifact.createdAt)}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No verification artifacts attached yet.
                  </div>
                )}
              </div>
            </div>
            {mergeCandidate?.remainingRisks?.length ? (
              <div className="rounded-[0.95rem] border border-amber-500/20 bg-amber-500/8 px-3 py-3">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-100">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Remaining risks
                </div>
                <ul className="mt-3 space-y-2 text-sm text-amber-50">
                  {mergeCandidate.remainingRisks.map((risk) => (
                    <li key={risk} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-200" />
                      <span>{risk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {!compact && mergeCandidate && (
        <div className="mt-4 rounded-[1rem] border border-border bg-background/72 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <GitBranch className="h-4 w-4 text-primary" />
                Merge candidate operator actions
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Resolve the candidate or run export / merge follow-through without leaving the review desk.
              </p>
            </div>
            <Badge variant="outline" className={toneClass(mergeCandidate.state)}>
              {titleCase(mergeCandidate.state)}
            </Badge>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Input
              value={targetBaseBranch}
              onChange={(event) => setTargetBaseBranch(event.target.value)}
              placeholder="Target base branch"
            />
            <Input
              value={preparedBranchName}
              onChange={(event) => setPreparedBranchName(event.target.value)}
              placeholder="Prepared branch"
            />
            <Input
              value={remoteName}
              onChange={(event) => setRemoteName(event.target.value)}
              placeholder="Remote name"
            />
            <Input
              value={mergeCommitSha}
              onChange={(event) => setMergeCommitSha(event.target.value)}
              placeholder="Merge commit SHA"
            />
          </div>

          <Textarea
            className="mt-3 min-h-24"
            value={operatorNote}
            onChange={(event) => setOperatorNote(event.target.value)}
            placeholder="Operator note, rationale, or handoff context"
          />

          {mergeBlocked ? (
            <div className="mt-3 rounded-[0.95rem] border border-amber-500/20 bg-amber-500/8 px-3 py-3 text-sm text-amber-50">
              Synced PR checks are still blocking merge completion. Refresh the PR bridge after checks finish or review changes.
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                resolveMutation.mutate({
                  actionType: "mark_merged",
                  noteBody: operatorNote || null,
                  targetBaseBranch: targetBaseBranch || null,
                  mergeCommitSha: mergeCommitSha || null,
                })
              }
              disabled={busy || mergeBlocked}
              className="rounded-full"
            >
              {resolveMutation.isPending ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCheck className="h-3.5 w-3.5" />
              )}
              Mark merged
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                resolveMutation.mutate({
                  actionType: "mark_rejected",
                  noteBody: operatorNote || null,
                  targetBaseBranch: targetBaseBranch || null,
                })
              }
              disabled={busy}
              className="rounded-full"
            >
              <XCircle className="h-3.5 w-3.5" />
              Mark rejected
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                automationMutation.mutate({
                  actionType: "sync_pr_bridge",
                  targetBaseBranch: targetBaseBranch || null,
                  branchName: preparedBranchName || null,
                  integrationBranchName: preparedBranchName || null,
                  remoteName: remoteName || null,
                  pushAfterAction: prBridge ? false : true,
                })
              }
              disabled={busy}
              className="rounded-full"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {prBridge ? "Sync PR status" : "Create draft PR"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                automationMutation.mutate({
                  actionType: "export_patch",
                  targetBaseBranch: targetBaseBranch || null,
                  branchName: preparedBranchName || null,
                  remoteName: remoteName || null,
                })
              }
              disabled={busy}
              className="rounded-full"
            >
              <FileDiff className="h-3.5 w-3.5" />
              Export patch
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                automationMutation.mutate({
                  actionType: "export_pr_bundle",
                  targetBaseBranch: targetBaseBranch || null,
                  branchName: preparedBranchName || null,
                  integrationBranchName: preparedBranchName || null,
                  remoteName: remoteName || null,
                })
              }
              disabled={busy}
              className="rounded-full"
            >
              <FileDiff className="h-3.5 w-3.5" />
              Export PR bundle
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                automationMutation.mutate({
                  actionType: "merge_local",
                  targetBaseBranch: targetBaseBranch || null,
                  branchName: preparedBranchName || null,
                  integrationBranchName: preparedBranchName || null,
                  remoteName: remoteName || null,
                })
              }
              disabled={busy}
              className="rounded-full"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Merge local
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                automationMutation.mutate({
                  actionType: "push_branch",
                  branchName: preparedBranchName || null,
                  remoteName: remoteName || null,
                })
              }
              disabled={busy}
              className="rounded-full"
            >
              <Rocket className="h-3.5 w-3.5" />
              Push branch
            </Button>
          </div>

          {(latestAutomationResult || mergeCandidate.automationMetadata) && (
            <div className="mt-4 rounded-[0.95rem] border border-border bg-card px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Latest automation output
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(automationSummary ?? []).map((value) => (
                  <CopyText
                    key={value}
                    text={value}
                    className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground"
                  >
                    {value}
                  </CopyText>
                ))}
                {latestAutomationResult?.actionType && (
                  <Badge variant="outline">
                    {titleCase(latestAutomationResult.actionType)}
                  </Badge>
                )}
                {latestAutomationResult?.pushed && (
                  <Badge variant="outline">Pushed</Badge>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
