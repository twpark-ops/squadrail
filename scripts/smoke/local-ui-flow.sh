#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3311}"
SQUADRAIL_HOME="${SQUADRAIL_HOME:-}"
SMOKE_ENGINE="${SMOKE_ENGINE:-codex_local}"
SMOKE_PRESET_KEY="${SMOKE_PRESET_KEY:-squadrail_default_v1}"

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

BASE_URL="http://${HOST}:${PORT}"
SERVER_LOG="${SERVER_LOG:-$SQUADRAIL_HOME/local-ui-flow.log}"
SCREENSHOT_PATH="${SCREENSHOT_PATH:-$SQUADRAIL_HOME/local-ui-flow.png}"
SETTINGS_DOM_PATH="${SETTINGS_DOM_PATH:-$SQUADRAIL_HOME/settings.dom.html}"
WORK_DOM_PATH="${WORK_DOM_PATH:-$SQUADRAIL_HOME/work.dom.html}"
WORK_DETAIL_DOM_PATH="${WORK_DETAIL_DOM_PATH:-$SQUADRAIL_HOME/work-detail.dom.html}"
OVERVIEW_DOM_PATH="${OVERVIEW_DOM_PATH:-$SQUADRAIL_HOME/overview.dom.html}"
CHANGES_DOM_PATH="${CHANGES_DOM_PATH:-$SQUADRAIL_HOME/changes.dom.html}"
RUNS_DOM_PATH="${RUNS_DOM_PATH:-$SQUADRAIL_HOME/runs.dom.html}"
TEAM_DOM_PATH="${TEAM_DOM_PATH:-$SQUADRAIL_HOME/team.dom.html}"
KNOWLEDGE_DOM_PATH="${KNOWLEDGE_DOM_PATH:-$SQUADRAIL_HOME/knowledge.dom.html}"
CHROME_PROFILE_DIR="${CHROME_PROFILE_DIR:-$SQUADRAIL_HOME/chrome-profile}"

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

SMOKE_WORKSPACE_ID="$(printf '%s' "$PROJECT_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);const workspaces=Array.isArray(x.workspaces)?x.workspaces:[];const primary=workspaces.find((entry)=>entry.isPrimary) || workspaces[0];if(!primary?.id){process.exit(1);}process.stdout.write(primary.id);});')"

curl -sSf -X PATCH "${BASE_URL}/api/companies/${COMPANY_ID}/setup-progress" \
  -H "Content-Type: application/json" \
  -d "{\"selectedEngine\":\"${SMOKE_ENGINE}\",\"selectedWorkspaceId\":\"${SMOKE_WORKSPACE_ID}\",\"metadata\":{\"knowledgeSeeded\":true,\"firstIssueReady\":true,\"smokeReady\":true}}" >/dev/null

ENGINEER_RESPONSE="$(curl -sSf -X POST "${BASE_URL}/api/companies/${COMPANY_ID}/agents" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Engineer\",\"role\":\"engineer\",\"adapterType\":\"${SMOKE_ENGINE}\",\"adapterConfig\":{},\"runtimeConfig\":{},\"budgetMonthlyCents\":0}")"
ENGINEER_ID="$(printf '%s' "$ENGINEER_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.id);});')"

REVIEWER_RESPONSE="$(curl -sSf -X POST "${BASE_URL}/api/companies/${COMPANY_ID}/agents" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Reviewer\",\"role\":\"qa\",\"adapterType\":\"${SMOKE_ENGINE}\",\"adapterConfig\":{},\"runtimeConfig\":{},\"budgetMonthlyCents\":0}")"
REVIEWER_ID="$(printf '%s' "$REVIEWER_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.id);});')"

curl -sSf -X POST "${BASE_URL}/api/issues/${ISSUE_ID}/protocol/messages" \
  -H "Content-Type: application/json" \
  -d "{\"messageType\":\"ASSIGN_TASK\",\"sender\":{\"actorType\":\"user\",\"actorId\":\"local-board\",\"role\":\"human_board\"},\"recipients\":[{\"recipientType\":\"agent\",\"recipientId\":\"${ENGINEER_ID}\",\"role\":\"engineer\"},{\"recipientType\":\"agent\",\"recipientId\":\"${REVIEWER_ID}\",\"role\":\"reviewer\"}],\"workflowStateBefore\":\"backlog\",\"workflowStateAfter\":\"assigned\",\"summary\":\"Assign smoke issue\",\"requiresAck\":false,\"payload\":{\"goal\":\"Verify dashboard queue and compose flow\",\"acceptanceCriteria\":[\"Execution queue populated\",\"Issue detail renders protocol console\"],\"definitionOfDone\":[\"Smoke DOM checks passed\"],\"priority\":\"high\",\"assigneeAgentId\":\"${ENGINEER_ID}\",\"reviewerAgentId\":\"${REVIEWER_ID}\"},\"artifacts\":[]}" >/dev/null

SETTINGS_URL="${BASE_URL}/${COMPANY_PREFIX}/settings"
WORK_URL="${BASE_URL}/${COMPANY_PREFIX}/work"
WORK_DETAIL_URL="${BASE_URL}/${COMPANY_PREFIX}/work/${ISSUE_IDENTIFIER}"
OVERVIEW_URL="${BASE_URL}/${COMPANY_PREFIX}/overview"
CHANGES_URL="${BASE_URL}/${COMPANY_PREFIX}/changes"
RUNS_URL="${BASE_URL}/${COMPANY_PREFIX}/runs"
TEAM_URL="${BASE_URL}/${COMPANY_PREFIX}/team"
KNOWLEDGE_URL="${BASE_URL}/${COMPANY_PREFIX}/knowledge"

echo "==> verifying settings page"
SETTINGS_DOM="$("$CHROME_BIN" --headless=new --disable-gpu --user-data-dir="$CHROME_PROFILE_DIR" --virtual-time-budget=5000 --dump-dom "$SETTINGS_URL")"
printf '%s' "$SETTINGS_DOM" >"$SETTINGS_DOM_PATH"
grep -q "Role Studio" "$SETTINGS_DOM_PATH"
grep -q "Side-by-side diff" "$SETTINGS_DOM_PATH"
grep -q "Protocol integrity" "$SETTINGS_DOM_PATH"
grep -q "Tenant RLS" "$SETTINGS_DOM_PATH"

echo "==> verifying work list page"
WORK_DOM="$("$CHROME_BIN" --headless=new --disable-gpu --user-data-dir="$CHROME_PROFILE_DIR" --virtual-time-budget=5000 --dump-dom "$WORK_URL")"
printf '%s' "$WORK_DOM" >"$WORK_DOM_PATH"
grep -q "Smoke protocol issue" "$WORK_DOM_PATH"

echo "==> verifying work detail page"
WORK_DETAIL_DOM="$("$CHROME_BIN" --headless=new --disable-gpu --user-data-dir="$CHROME_PROFILE_DIR" --virtual-time-budget=5000 --dump-dom "$WORK_DETAIL_URL")"
printf '%s' "$WORK_DETAIL_DOM" >"$WORK_DETAIL_DOM_PATH"
grep -q "Smoke protocol issue" "$WORK_DETAIL_DOM_PATH"
grep -q "Smoke Engineer" "$WORK_DETAIL_DOM_PATH"
grep -q "GET /issues/${ISSUE_IDENTIFIER}/protocol/briefs 200" "$SERVER_LOG"
grep -q "GET /issues/${ISSUE_IDENTIFIER}/protocol/state 200" "$SERVER_LOG"
grep -q "GET /issues/${ISSUE_IDENTIFIER}/protocol/messages 200" "$SERVER_LOG"
grep -q "GET /issues/${ISSUE_IDENTIFIER}/runs 200" "$SERVER_LOG"

echo "==> verifying overview page"
OVERVIEW_DOM="$("$CHROME_BIN" --headless=new --disable-gpu --user-data-dir="$CHROME_PROFILE_DIR" --virtual-time-budget=5000 --dump-dom "$OVERVIEW_URL")"
printf '%s' "$OVERVIEW_DOM" >"$OVERVIEW_DOM_PATH"
grep -q "System Status" "$OVERVIEW_DOM_PATH"
grep -q "Live Agents" "$OVERVIEW_DOM_PATH"
grep -q "Protocol Queues" "$OVERVIEW_DOM_PATH"
grep -q "Smoke protocol issue" "$OVERVIEW_DOM_PATH"

echo "==> verifying changes page"
CHANGES_DOM="$("$CHROME_BIN" --headless=new --disable-gpu --user-data-dir="$CHROME_PROFILE_DIR" --virtual-time-budget=5000 --dump-dom "$CHANGES_URL")"
printf '%s' "$CHANGES_DOM" >"$CHANGES_DOM_PATH"
grep -q "Changes" "$CHANGES_DOM_PATH"
grep -q "Implementation In Motion" "$CHANGES_DOM_PATH"

echo "==> verifying runs page"
RUNS_DOM="$("$CHROME_BIN" --headless=new --disable-gpu --user-data-dir="$CHROME_PROFILE_DIR" --virtual-time-budget=5000 --dump-dom "$RUNS_URL")"
printf '%s' "$RUNS_DOM" >"$RUNS_DOM_PATH"
grep -q "Runs" "$RUNS_DOM_PATH"
grep -q "Recovery Queue" "$RUNS_DOM_PATH"
grep -q "Recent Heartbeats" "$RUNS_DOM_PATH"

echo "==> verifying team page"
TEAM_DOM="$("$CHROME_BIN" --headless=new --disable-gpu --user-data-dir="$CHROME_PROFILE_DIR" --virtual-time-budget=5000 --dump-dom "$TEAM_URL")"
printf '%s' "$TEAM_DOM" >"$TEAM_DOM_PATH"
grep -q "Team" "$TEAM_DOM_PATH"
grep -q "Operating Lanes" "$TEAM_DOM_PATH"
grep -q "Execution Mix" "$TEAM_DOM_PATH"

echo "==> verifying knowledge page"
KNOWLEDGE_DOM="$("$CHROME_BIN" --headless=new --disable-gpu --user-data-dir="$CHROME_PROFILE_DIR" --virtual-time-budget=5000 --dump-dom "$KNOWLEDGE_URL")"
printf '%s' "$KNOWLEDGE_DOM" >"$KNOWLEDGE_DOM_PATH"
grep -q "Knowledge Base" "$KNOWLEDGE_DOM_PATH"
grep -q "Retrieval posture" "$KNOWLEDGE_DOM_PATH"
grep -q "Recent Retrieval Loops" "$KNOWLEDGE_DOM_PATH"
grep -q "7-day trend" "$KNOWLEDGE_DOM_PATH"
grep -Eq "No documents indexed yet|Recent Company Slice" "$KNOWLEDGE_DOM_PATH"

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
echo "    runs DOM: ${RUNS_DOM_PATH}"
echo "    team DOM: ${TEAM_DOM_PATH}"
echo "    knowledge DOM: ${KNOWLEDGE_DOM_PATH}"
echo "    server log: ${SERVER_LOG}"
