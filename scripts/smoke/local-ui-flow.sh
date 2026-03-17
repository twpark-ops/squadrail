#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3311}"
SQUADRAIL_HOME="${SQUADRAIL_HOME:-}"
SMOKE_ENGINE="${SMOKE_ENGINE:-codex_local}"
SMOKE_PRESET_KEY="${SMOKE_PRESET_KEY:-squadrail_default_v1}"
RESET_SMOKE_HOME="${RESET_SMOKE_HOME:-true}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --engine)
      SMOKE_ENGINE="$2"
      shift 2
      ;;
    --preset)
      SMOKE_PRESET_KEY="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --host)
      HOST="$2"
      shift 2
      ;;
    --home)
      SQUADRAIL_HOME="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$SQUADRAIL_HOME" ]]; then
  SQUADRAIL_HOME="$(mktemp -d /tmp/squadrail-smoke-ui.XXXXXX)"
fi

if [[ -d "$SQUADRAIL_HOME" && "$RESET_SMOKE_HOME" == "true" ]]; then
  case "$SQUADRAIL_HOME" in
    /tmp/squadrail-*|/var/tmp/squadrail-*)
      rm -rf "$SQUADRAIL_HOME"
      ;;
    *)
      echo "refusing to reset non-smoke directory: $SQUADRAIL_HOME" >&2
      echo "set RESET_SMOKE_HOME=false to reuse an existing directory explicitly" >&2
      exit 1
      ;;
  esac
fi

BASE_URL="http://${HOST}:${PORT}"
SERVER_LOG="${SERVER_LOG:-$SQUADRAIL_HOME/local-ui-flow.log}"
SCREENSHOT_PATH="${SCREENSHOT_PATH:-$SQUADRAIL_HOME/local-ui-flow.png}"
SETTINGS_DOM_PATH="${SETTINGS_DOM_PATH:-$SQUADRAIL_HOME/settings.dom.html}"
WORK_DOM_PATH="${WORK_DOM_PATH:-$SQUADRAIL_HOME/work.dom.html}"
WORK_DETAIL_DOM_PATH="${WORK_DETAIL_DOM_PATH:-$SQUADRAIL_HOME/work-detail.dom.html}"
OVERVIEW_DOM_PATH="${OVERVIEW_DOM_PATH:-$SQUADRAIL_HOME/overview.dom.html}"
CHANGES_DOM_PATH="${CHANGES_DOM_PATH:-$SQUADRAIL_HOME/changes.dom.html}"
CHANGE_DETAIL_DOM_PATH="${CHANGE_DETAIL_DOM_PATH:-$SQUADRAIL_HOME/change-detail.dom.html}"
RUNS_DOM_PATH="${RUNS_DOM_PATH:-$SQUADRAIL_HOME/runs.dom.html}"
TEAM_DOM_PATH="${TEAM_DOM_PATH:-$SQUADRAIL_HOME/team.dom.html}"
KNOWLEDGE_DOM_PATH="${KNOWLEDGE_DOM_PATH:-$SQUADRAIL_HOME/knowledge.dom.html}"
CHROME_PROFILE_DIR="${CHROME_PROFILE_DIR:-$SQUADRAIL_HOME/chrome-profile}"
CHROME_DUMP_PROFILE_DIR="${CHROME_DUMP_PROFILE_DIR:-$SQUADRAIL_HOME/chrome-dump-profile}"
RUN_SUPPORT_PLAYWRIGHT_SPEC="${RUN_SUPPORT_PLAYWRIGHT_SPEC:-false}"
SUPPORT_PLAYWRIGHT_GREP="${SUPPORT_PLAYWRIGHT_GREP:-}"
SMOKE_SCOPE="${SMOKE_SCOPE:-full}"

mkdir -p "$SQUADRAIL_HOME"

require_bin() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_bin curl
require_bin node
require_bin pnpm

resolve_browser_bin() {
  if [[ -n "${CHROME_BIN:-}" ]]; then
    echo "$CHROME_BIN"
    return 0
  fi

  local candidates=("google-chrome" "chromium-browser" "chromium")
  local candidate
  for candidate in "${candidates[@]}"; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

CHROME_BIN="$(resolve_browser_bin)" || {
  echo "missing required browser command: google-chrome | chromium-browser | chromium" >&2
  exit 1
}

dump_dom_page() {
  local url="$1"
  local output_path="$2"
  local attempt tmp

  for attempt in 1 2; do
    tmp="$(mktemp "${SQUADRAIL_HOME}/dump-dom.XXXXXX.html")"
    if "$CHROME_BIN" --headless=new --disable-gpu --user-data-dir="$CHROME_DUMP_PROFILE_DIR" --virtual-time-budget=5000 --dump-dom "$url" >"$tmp" 2>/dev/null; then
      mv "$tmp" "$output_path"
      return 0
    fi
    if [[ -s "$tmp" ]]; then
      mv "$tmp" "$output_path"
      return 0
    fi
    rm -f "$tmp"
    sleep 1
  done

  echo "failed to dump DOM for ${url}" >&2
  return 1
}

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "==> starting Squadrail server on ${BASE_URL}"
(
  cd "$REPO_ROOT"
  if [[ ! -f "$REPO_ROOT/ui/dist/index.html" ]]; then
    pnpm --filter @squadrail/ui build >/dev/null
  fi
  cd "$REPO_ROOT/server"
  PORT="$PORT" \
  HOST="$HOST" \
  SQUADRAIL_HOME="$SQUADRAIL_HOME" \
  HEARTBEAT_SCHEDULER_ENABLED=false \
  SQUADRAIL_KNOWLEDGE_BACKFILL_ENABLED=false \
  SQUADRAIL_MIGRATION_AUTO_APPLY=true \
  pnpm exec tsx src/index.ts
) >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 90); do
  if curl -sSf "${BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -sSf "${BASE_URL}/health" >/dev/null

COMPANY_RESPONSE="$(curl -sSf -X POST "${BASE_URL}/api/companies" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke UI Co","description":"Local browser smoke automation","budgetMonthlyCents":50000}')"

COMPANY_ID="$(printf '%s' "$COMPANY_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.id);});')"
COMPANY_PREFIX="$(printf '%s' "$COMPANY_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.issuePrefix || x.prefix || x.slug || "");});')"

curl -sSf -X POST "${BASE_URL}/api/companies/${COMPANY_ID}/role-packs/seed-defaults" \
  -H "Content-Type: application/json" \
  -d "{\"presetKey\":\"${SMOKE_PRESET_KEY}\"}" >/dev/null

ISSUE_RESPONSE="$(curl -sSf -X POST "${BASE_URL}/api/companies/${COMPANY_ID}/issues" \
  -H "Content-Type: application/json" \
  -d '{"title":"Smoke protocol issue","description":"Verify protocol console and recovery cards","status":"backlog","priority":"high"}')"

ISSUE_ID="$(printf '%s' "$ISSUE_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.id);});')"
ISSUE_IDENTIFIER="$(printf '%s' "$ISSUE_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.identifier || x.id);});')"
PROJECT_RESPONSE="$(curl -sSf -X POST "${BASE_URL}/api/companies/${COMPANY_ID}/projects" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Workspace\",\"description\":\"Workspace for browser smoke automation\",\"status\":\"in_progress\",\"workspace\":{\"name\":\"Smoke Workspace\",\"cwd\":\"${REPO_ROOT}\",\"isPrimary\":true}}")"

PROJECT_ID="$(printf '%s' "$PROJECT_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.id);});')"
SMOKE_WORKSPACE_ID="$(printf '%s' "$PROJECT_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);const workspaces=Array.isArray(x.workspaces)?x.workspaces:[];const primary=workspaces.find((entry)=>entry.isPrimary) || workspaces[0];if(!primary?.id){process.exit(1);}process.stdout.write(primary.id);});')"

curl -sSf -X PATCH "${BASE_URL}/api/companies/${COMPANY_ID}/setup-progress" \
  -H "Content-Type: application/json" \
  -d "{\"selectedEngine\":\"${SMOKE_ENGINE}\",\"selectedWorkspaceId\":\"${SMOKE_WORKSPACE_ID}\",\"metadata\":{\"knowledgeSeeded\":true,\"firstIssueReady\":true,\"smokeReady\":true}}" >/dev/null

curl -sSf -X POST "${BASE_URL}/api/companies/${COMPANY_ID}/knowledge-sync" \
  -H "Content-Type: application/json" \
  -d "{\"projectIds\":[\"${PROJECT_ID}\"],\"forceFull\":false,\"rebuildGraph\":true,\"rebuildVersions\":true,\"backfillPersonalization\":true}" >/dev/null

SECOND_COMPANY_RESPONSE="$(curl -sSf -X POST "${BASE_URL}/api/companies" \
  -H "Content-Type: application/json" \
  -d '{"name":"Atlas Test Org","description":"Secondary company for company-rail persistence validation","budgetMonthlyCents":25000}')"

SECOND_COMPANY_ID="$(printf '%s' "$SECOND_COMPANY_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.id);});')"

curl -sSf -X POST "${BASE_URL}/api/companies/${SECOND_COMPANY_ID}/role-packs/seed-defaults" \
  -H "Content-Type: application/json" \
  -d "{\"presetKey\":\"${SMOKE_PRESET_KEY}\"}" >/dev/null

SECOND_PROJECT_RESPONSE="$(curl -sSf -X POST "${BASE_URL}/api/companies/${SECOND_COMPANY_ID}/projects" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Atlas Workspace\",\"description\":\"Secondary workspace for company rail reorder validation\",\"status\":\"in_progress\",\"workspace\":{\"name\":\"Atlas Workspace\",\"cwd\":\"${REPO_ROOT}\",\"isPrimary\":true}}")"

SECOND_WORKSPACE_ID="$(printf '%s' "$SECOND_PROJECT_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);const workspaces=Array.isArray(x.workspaces)?x.workspaces:[];const primary=workspaces.find((entry)=>entry.isPrimary) || workspaces[0];if(!primary?.id){process.exit(1);}process.stdout.write(primary.id);});')"

curl -sSf -X PATCH "${BASE_URL}/api/companies/${SECOND_COMPANY_ID}/setup-progress" \
  -H "Content-Type: application/json" \
  -d "{\"selectedEngine\":\"${SMOKE_ENGINE}\",\"selectedWorkspaceId\":\"${SECOND_WORKSPACE_ID}\",\"metadata\":{\"knowledgeSeeded\":true,\"firstIssueReady\":true,\"smokeReady\":true}}" >/dev/null

ENGINEER_RESPONSE="$(curl -sSf -X POST "${BASE_URL}/api/companies/${COMPANY_ID}/agents" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Engineer\",\"role\":\"engineer\",\"adapterType\":\"${SMOKE_ENGINE}\",\"adapterConfig\":{},\"runtimeConfig\":{},\"budgetMonthlyCents\":0}")"
ENGINEER_ID="$(printf '%s' "$ENGINEER_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.id);});')"

REVIEWER_RESPONSE="$(curl -sSf -X POST "${BASE_URL}/api/companies/${COMPANY_ID}/agents" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Reviewer\",\"role\":\"qa\",\"adapterType\":\"${SMOKE_ENGINE}\",\"adapterConfig\":{},\"runtimeConfig\":{},\"budgetMonthlyCents\":0}")"
REVIEWER_ID="$(printf '%s' "$REVIEWER_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.id);});')"

for _ in $(seq 1 30); do
  EMBEDDED_DB_PORT="$(grep -Eo 'pg:[0-9]+' "$SERVER_LOG" | tail -n 1 | cut -d: -f2 || true)"
  if [[ -n "$EMBEDDED_DB_PORT" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "${EMBEDDED_DB_PORT:-}" ]]; then
  echo "failed to detect embedded postgres port from ${SERVER_LOG}" >&2
  exit 1
fi

(
  cd "$REPO_ROOT/server"
  DATABASE_URL="postgres://squadrail:squadrail@127.0.0.1:${EMBEDDED_DB_PORT}/squadrail" \
  COMPANY_ID="$COMPANY_ID" \
  ISSUE_ID="$ISSUE_ID" \
  PROJECT_ID="$PROJECT_ID" \
  ENGINEER_ID="$ENGINEER_ID" \
  REVIEWER_ID="$REVIEWER_ID" \
  REPO_ROOT="$REPO_ROOT" \
  pnpm exec tsx <<'TS'
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  createDb,
  issueMergeCandidates,
  issueProtocolArtifacts,
  issueProtocolMessages,
  issueProtocolRecipients,
  issueProtocolState,
  issueProtocolThreads,
  issues,
} from "@squadrail/db";

const databaseUrl = process.env.DATABASE_URL;
const companyId = process.env.COMPANY_ID;
const issueId = process.env.ISSUE_ID;
const projectId = process.env.PROJECT_ID;
const engineerId = process.env.ENGINEER_ID;
const reviewerId = process.env.REVIEWER_ID;
const repoRoot = process.env.REPO_ROOT;

if (!databaseUrl || !companyId || !issueId || !projectId || !engineerId || !reviewerId || !repoRoot) {
  throw new Error("missing required seed environment");
}

const db = createDb(databaseUrl);

const threadId = randomUUID();
const approvalMessageId = randomUUID();
const closeMessageId = randomUUID();
const mergeCandidateId = randomUUID();
const approvalAt = new Date("2026-03-10T11:00:00.000Z");
const closeAt = new Date("2026-03-10T11:05:00.000Z");

await db.transaction(async (tx) => {
  await tx.insert(issueProtocolThreads).values({
    id: threadId,
    companyId,
    issueId,
    threadType: "primary",
    title: "Primary protocol thread",
    createdAt: approvalAt,
    updatedAt: closeAt,
  });

  await tx.insert(issueProtocolMessages).values([
    {
      id: approvalMessageId,
      companyId,
      issueId,
      threadId,
      seq: 1,
      messageType: "APPROVE_IMPLEMENTATION",
      senderActorType: "agent",
      senderActorId: reviewerId,
      senderRole: "reviewer",
      workflowStateBefore: "under_review",
      workflowStateAfter: "approved",
      summary: "Approved for external merge handoff.",
      payload: {
        approvalSummary: "Approved for external merge handoff.",
        approvalMode: "agent_review",
        approvalChecklist: [
          "Verification artifacts checked",
          "Workspace handoff metadata checked",
        ],
        verifiedEvidence: [
          "Diff stat recorded",
          "Focused build and test runs attached",
        ],
        residualRisks: [
          "Board operator still needs to execute the merge action",
        ],
      },
      requiresAck: false,
      createdAt: approvalAt,
    },
    {
      id: closeMessageId,
      companyId,
      issueId,
      threadId,
      seq: 2,
      messageType: "CLOSE_TASK",
      senderActorType: "user",
      senderActorId: "local-board",
      senderRole: "human_board",
      workflowStateBefore: "approved",
      workflowStateAfter: "done",
      summary: "Ready for operator merge",
      payload: {
        closeReason: "completed",
        closureSummary: "Ready for operator merge",
        verificationSummary: "Focused tests passed",
        rollbackPlan: "Revert the smoke patch",
        finalArtifacts: [
          "Diff prepared for external merge",
        ],
        finalTestStatus: "passed",
        mergeStatus: "pending_external_merge",
        remainingRisks: [
          "Needs explicit operator merge handoff",
        ],
      },
      requiresAck: false,
      createdAt: closeAt,
    },
  ]);

  await tx.insert(issueProtocolRecipients).values([
    {
      companyId,
      messageId: approvalMessageId,
      recipientType: "user",
      recipientId: "local-board",
      recipientRole: "human_board",
    },
    {
      companyId,
      messageId: closeMessageId,
      recipientType: "agent",
      recipientId: engineerId,
      recipientRole: "engineer",
    },
  ]);

  await tx.insert(issueProtocolArtifacts).values([
    {
      companyId,
      messageId: approvalMessageId,
      artifactKind: "approval",
      artifactUri: "approval://smoke",
      label: "Smoke approval artifact",
      metadata: {},
    },
    {
      companyId,
      messageId: closeMessageId,
      artifactKind: "doc",
      artifactUri: "workspace://binding",
      label: "Workspace binding",
      metadata: {
        bindingType: "implementation_workspace",
        cwd: repoRoot,
        branchName: "squadrail/smoke-merge",
        headSha: "abc123def456",
        source: "project_isolated",
        workspaceState: "fresh",
      },
    },
    {
      companyId,
      messageId: closeMessageId,
      artifactKind: "diff",
      artifactUri: "run://diff",
      label: "Diff artifact",
      metadata: {
        branchName: "squadrail/smoke-merge",
        headSha: "abc123def456",
        changedFiles: [
          "ui/src/pages/Changes.tsx",
          "ui/src/pages/IssueDetail.tsx",
        ],
        statusEntries: [
          "M ui/src/pages/Changes.tsx",
          "M ui/src/pages/IssueDetail.tsx",
        ],
        diffStat: "2 files changed, 24 insertions(+)",
      },
    },
    {
      companyId,
      messageId: closeMessageId,
      artifactKind: "test_run",
      artifactUri: "run://test",
      label: "pnpm --filter @squadrail/ui test",
      metadata: {},
    },
    {
      companyId,
      messageId: closeMessageId,
      artifactKind: "build_run",
      artifactUri: "run://build",
      label: "pnpm --filter @squadrail/ui build",
      metadata: {},
    },
  ]);

  await tx.update(issues).set({
    projectId,
    status: "done",
    assigneeAgentId: engineerId,
    startedAt: approvalAt,
    completedAt: closeAt,
    updatedAt: closeAt,
  }).where(eq(issues.id, issueId));

  await tx.insert(issueProtocolState).values({
    issueId,
    companyId,
    workflowState: "approved",
    coarseIssueStatus: "in_review",
    primaryEngineerAgentId: engineerId,
    reviewerAgentId: reviewerId,
    currentReviewCycle: 1,
    lastProtocolMessageId: closeMessageId,
    lastTransitionAt: closeAt,
    metadata: {},
  });

  await tx.insert(issueMergeCandidates).values({
    id: mergeCandidateId,
    companyId,
    issueId,
    closeMessageId,
    state: "pending",
    sourceBranch: "squadrail/smoke-merge",
    workspacePath: repoRoot,
    headSha: "abc123def456",
    diffStat: "2 files changed, 24 insertions(+)",
    targetBaseBranch: "main",
    automationMetadata: {
      lastPreparedBranch: "squadrail/smoke-merge",
      lastPushRemote: "origin",
    },
    operatorNote: "Ready for operator merge",
    createdAt: closeAt,
    updatedAt: closeAt,
  });
});

const client = Reflect.get(db, "$client");
if (client && typeof client === "object" && "end" in client && typeof client.end === "function") {
  await client.end();
}
process.exit(0);
TS
)

SETTINGS_URL="${BASE_URL}/${COMPANY_PREFIX}/settings"
WORK_URL="${BASE_URL}/${COMPANY_PREFIX}/work"
WORK_DETAIL_URL="${BASE_URL}/${COMPANY_PREFIX}/work/${ISSUE_IDENTIFIER}"
OVERVIEW_URL="${BASE_URL}/${COMPANY_PREFIX}/overview"
CHANGES_URL="${BASE_URL}/${COMPANY_PREFIX}/changes"
CHANGE_DETAIL_URL="${BASE_URL}/${COMPANY_PREFIX}/changes/${ISSUE_IDENTIFIER}"
RUNS_URL="${BASE_URL}/${COMPANY_PREFIX}/runs"
TEAM_URL="${BASE_URL}/${COMPANY_PREFIX}/team"
KNOWLEDGE_URL="${BASE_URL}/${COMPANY_PREFIX}/knowledge"

echo "==> verifying settings page"
dump_dom_page "$SETTINGS_URL" "$SETTINGS_DOM_PATH"
grep -q "Role Studio" "$SETTINGS_DOM_PATH"
grep -q "Side-by-side diff" "$SETTINGS_DOM_PATH"
grep -q "Protocol integrity" "$SETTINGS_DOM_PATH"
grep -q "Tenant RLS" "$SETTINGS_DOM_PATH"

if [[ "$RUN_SUPPORT_PLAYWRIGHT_SPEC" == "true" ]]; then
  echo "==> verifying Company Settings blueprint apply flow with Playwright"
  (
    cd "$REPO_ROOT"
    if [[ -n "$SUPPORT_PLAYWRIGHT_GREP" ]]; then
      UI_REVIEW_BASE_URL="$BASE_URL" pnpm exec playwright test scripts/smoke/ui-support-routes.spec.ts --reporter=line -g "$SUPPORT_PLAYWRIGHT_GREP"
    else
      UI_REVIEW_BASE_URL="$BASE_URL" pnpm exec playwright test scripts/smoke/ui-support-routes.spec.ts --reporter=line
    fi
  )
fi

if [[ "$SMOKE_SCOPE" == "support_only" ]]; then
  echo "==> support-only smoke succeeded"
  exit 0
fi

echo "==> verifying work list page"
dump_dom_page "$WORK_URL" "$WORK_DOM_PATH"
grep -q "Delivery queue" "$WORK_DOM_PATH"
grep -q "Board" "$WORK_DOM_PATH"
grep -q "New Issue" "$WORK_DOM_PATH"

echo "==> verifying work detail page"
dump_dom_page "$WORK_DETAIL_URL" "$WORK_DETAIL_DOM_PATH"
grep -q "Smoke protocol issue" "$WORK_DETAIL_DOM_PATH"
grep -q "Smoke Engineer" "$WORK_DETAIL_DOM_PATH"

echo "==> verifying overview page"
dump_dom_page "$OVERVIEW_URL" "$OVERVIEW_DOM_PATH"
grep -q "Execution queue" "$OVERVIEW_DOM_PATH"
grep -q "Review backlog" "$OVERVIEW_DOM_PATH"
grep -q "Live operations" "$OVERVIEW_DOM_PATH"
grep -q "Protocol queues" "$OVERVIEW_DOM_PATH"
grep -q "Smoke protocol issue" "$OVERVIEW_DOM_PATH"

echo "==> verifying changes page"
dump_dom_page "$CHANGES_URL" "$CHANGES_DOM_PATH"
grep -q "Changes · Squadrail" "$CHANGES_DOM_PATH"

echo "==> verifying change detail page"
dump_dom_page "$CHANGE_DETAIL_URL" "$CHANGE_DETAIL_DOM_PATH"

echo "==> verifying runs page"
dump_dom_page "$RUNS_URL" "$RUNS_DOM_PATH"
grep -q "Runs" "$RUNS_DOM_PATH"
grep -q "Live Runs" "$RUNS_DOM_PATH"
grep -q "Recovery" "$RUNS_DOM_PATH"
grep -q "History" "$RUNS_DOM_PATH"

echo "==> verifying team page"
dump_dom_page "$TEAM_URL" "$TEAM_DOM_PATH"
grep -q "Team" "$TEAM_DOM_PATH"
grep -q "Team surfaces" "$TEAM_DOM_PATH"
grep -q "Supervision" "$TEAM_DOM_PATH"
grep -q "Roster" "$TEAM_DOM_PATH"
grep -q "leadership" "$TEAM_DOM_PATH"
grep -q "engineers" "$TEAM_DOM_PATH"
grep -q "verification" "$TEAM_DOM_PATH"

echo "==> verifying knowledge page"
dump_dom_page "$KNOWLEDGE_URL" "$KNOWLEDGE_DOM_PATH"
grep -q "Knowledge Base" "$KNOWLEDGE_DOM_PATH"
grep -q "Retrieval posture" "$KNOWLEDGE_DOM_PATH"
grep -q "Recent Retrieval Loops" "$KNOWLEDGE_DOM_PATH"
grep -q "7-day trend" "$KNOWLEDGE_DOM_PATH"
grep -Eq "No documents indexed yet|Recent Company Slice" "$KNOWLEDGE_DOM_PATH"
grep -q "Setup" "$KNOWLEDGE_DOM_PATH"

"$CHROME_BIN" --headless=new --disable-gpu --user-data-dir="$CHROME_PROFILE_DIR" --virtual-time-budget=5000 --window-size=1440,1200 --screenshot="$SCREENSHOT_PATH" "$OVERVIEW_URL" >/dev/null 2>&1

echo "==> smoke succeeded"
echo "    settings: ${SETTINGS_URL}"
echo "    work: ${WORK_URL}"
echo "    work detail: ${WORK_DETAIL_URL}"
echo "    overview: ${OVERVIEW_URL}"
echo "    changes: ${CHANGES_URL}"
echo "    runs: ${RUNS_URL}"
echo "    team: ${TEAM_URL}"
echo "    knowledge: ${KNOWLEDGE_URL}"
echo "    engine: ${SMOKE_ENGINE}"
echo "    preset: ${SMOKE_PRESET_KEY}"
echo "    screenshot: ${SCREENSHOT_PATH}"
echo "    settings DOM: ${SETTINGS_DOM_PATH}"
echo "    work DOM: ${WORK_DOM_PATH}"
echo "    work detail DOM: ${WORK_DETAIL_DOM_PATH}"
echo "    overview DOM: ${OVERVIEW_DOM_PATH}"
echo "    changes DOM: ${CHANGES_DOM_PATH}"
echo "    change detail DOM: ${CHANGE_DETAIL_DOM_PATH}"
echo "    runs DOM: ${RUNS_DOM_PATH}"
echo "    team DOM: ${TEAM_DOM_PATH}"
echo "    knowledge DOM: ${KNOWLEDGE_DOM_PATH}"
echo "    server log: ${SERVER_LOG}"
