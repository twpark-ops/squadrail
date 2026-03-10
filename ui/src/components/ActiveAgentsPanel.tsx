import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import type { Issue, LiveEvent } from "@squadrail/shared";
import { heartbeatsApi, type LiveRunForIssue } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { getUIAdapter } from "../adapters";
import type { TranscriptEntry } from "../adapters";
import { queryKeys } from "../lib/queryKeys";
import { cn, relativeTime } from "../lib/utils";
import { workIssuePath } from "../lib/appRoutes";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { Identity } from "./Identity";

type FeedTone = "info" | "warn" | "error" | "assistant" | "tool";

interface FeedItem {
  id: string;
  ts: string;
  runId: string;
  agentId: string;
  agentName: string;
  text: string;
  tone: FeedTone;
}

const MAX_FEED_ITEMS = 40;
const MIN_DASHBOARD_RUNS = 4;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function summarizeEntry(entry: TranscriptEntry): { text: string; tone: FeedTone } | null {
  if (entry.kind === "assistant") {
    const text = entry.text.trim();
    return text ? { text, tone: "assistant" } : null;
  }
  if (entry.kind === "thinking") {
    const text = entry.text.trim();
    return text ? { text: `[thinking] ${text}`, tone: "info" } : null;
  }
  if (entry.kind === "tool_call") {
    return { text: `tool ${entry.name}`, tone: "tool" };
  }
  if (entry.kind === "tool_result") {
    const base = entry.content.trim();
    return {
      text: entry.isError ? `tool error: ${base}` : `tool result: ${base}`,
      tone: entry.isError ? "error" : "tool",
    };
  }
  if (entry.kind === "stderr") {
    const text = entry.text.trim();
    return text ? { text, tone: "error" } : null;
  }
  if (entry.kind === "system") {
    const text = entry.text.trim();
    return text ? { text, tone: "warn" } : null;
  }
  if (entry.kind === "stdout") {
    const text = entry.text.trim();
    return text ? { text, tone: "info" } : null;
  }
  return null;
}

function createFeedItem(
  run: LiveRunForIssue,
  ts: string,
  text: string,
  tone: FeedTone,
  nextId: number,
): FeedItem | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return {
    id: `${run.id}:${nextId}`,
    ts,
    runId: run.id,
    agentId: run.agentId,
    agentName: run.agentName,
    text: trimmed.slice(0, 220),
    tone,
  };
}

function parseStdoutChunk(
  run: LiveRunForIssue,
  chunk: string,
  ts: string,
  pendingByRun: Map<string, string>,
  nextIdRef: MutableRefObject<number>,
): FeedItem[] {
  const pendingKey = `${run.id}:stdout`;
  const combined = `${pendingByRun.get(pendingKey) ?? ""}${chunk}`;
  const split = combined.split(/\r?\n/);
  pendingByRun.set(pendingKey, split.pop() ?? "");
  const adapter = getUIAdapter(run.adapterType);

  const summarized: Array<{ text: string; tone: FeedTone; thinkingDelta?: boolean }> = [];
  const appendSummary = (entry: TranscriptEntry) => {
    if (entry.kind === "thinking" && entry.delta) {
      const text = entry.text;
      if (!text.trim()) return;
      const last = summarized[summarized.length - 1];
      if (last && last.thinkingDelta) {
        last.text += text;
      } else {
        summarized.push({ text: `[thinking] ${text}`, tone: "info", thinkingDelta: true });
      }
      return;
    }

    const summary = summarizeEntry(entry);
    if (!summary) return;
    summarized.push({ text: summary.text, tone: summary.tone });
  };

  const items: FeedItem[] = [];
  for (const line of split.slice(-8)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = adapter.parseStdoutLine(trimmed, ts);
    if (parsed.length === 0) {
      const fallback = createFeedItem(run, ts, trimmed, "info", nextIdRef.current++);
      if (fallback) items.push(fallback);
      continue;
    }
    for (const entry of parsed) {
      appendSummary(entry);
    }
  }

  for (const summary of summarized) {
    const item = createFeedItem(run, ts, summary.text, summary.tone, nextIdRef.current++);
    if (item) items.push(item);
  }

  return items;
}

function parseStderrChunk(
  run: LiveRunForIssue,
  chunk: string,
  ts: string,
  pendingByRun: Map<string, string>,
  nextIdRef: MutableRefObject<number>,
): FeedItem[] {
  const pendingKey = `${run.id}:stderr`;
  const combined = `${pendingByRun.get(pendingKey) ?? ""}${chunk}`;
  const split = combined.split(/\r?\n/);
  pendingByRun.set(pendingKey, split.pop() ?? "");

  const items: FeedItem[] = [];
  for (const line of split.slice(-8)) {
    const item = createFeedItem(run, ts, line, "error", nextIdRef.current++);
    if (item) items.push(item);
  }
  return items;
}

function isRunActive(run: LiveRunForIssue): boolean {
  return run.status === "queued" || run.status === "running";
}

interface ActiveAgentsPanelProps {
  companyId: string;
}

export function ActiveAgentsPanel({ companyId }: ActiveAgentsPanelProps) {
  const [feedByRun, setFeedByRun] = useState<Map<string, FeedItem[]>>(new Map());
  const seenKeysRef = useRef(new Set<string>());
  const pendingByRunRef = useRef(new Map<string, string>());
  const nextIdRef = useRef(1);

  const { data: liveRuns } = useQuery({
    queryKey: [...queryKeys.liveRuns(companyId), "dashboard"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId, MIN_DASHBOARD_RUNS),
  });

  const runs = liveRuns ?? [];
  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(companyId),
    queryFn: () => issuesApi.list(companyId),
    enabled: runs.length > 0,
  });

  const issueById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues ?? []) {
      map.set(issue.id, issue);
    }
    return map;
  }, [issues]);

  const runById = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);
  const activeRunIds = useMemo(() => new Set(runs.filter(isRunActive).map((r) => r.id)), [runs]);
  const runningCount = runs.filter((run) => run.status === "running").length;
  const queuedCount = runs.filter((run) => run.status === "queued").length;

  // Clean up pending buffers for runs that ended
  useEffect(() => {
    const stillActive = new Set<string>();
    for (const runId of activeRunIds) {
      stillActive.add(`${runId}:stdout`);
      stillActive.add(`${runId}:stderr`);
    }
    for (const key of pendingByRunRef.current.keys()) {
      if (!stillActive.has(key)) {
        pendingByRunRef.current.delete(key);
      }
    }
  }, [activeRunIds]);

  // WebSocket connection for streaming
  useEffect(() => {
    if (activeRunIds.size === 0) return;

    let closed = false;
    let reconnectTimer: number | null = null;
    let socket: WebSocket | null = null;

    const appendItems = (runId: string, items: FeedItem[]) => {
      if (items.length === 0) return;
      setFeedByRun((prev) => {
        const next = new Map(prev);
        const existing = next.get(runId) ?? [];
        next.set(runId, [...existing, ...items].slice(-MAX_FEED_ITEMS));
        return next;
      });
    };

    const scheduleReconnect = () => {
      if (closed) return;
      reconnectTimer = window.setTimeout(connect, 1500);
    };

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${protocol}://${window.location.host}/api/companies/${encodeURIComponent(companyId)}/events/ws`;
      socket = new WebSocket(url);

      socket.onmessage = (message) => {
        const raw = typeof message.data === "string" ? message.data : "";
        if (!raw) return;

        let event: LiveEvent;
        try {
          event = JSON.parse(raw) as LiveEvent;
        } catch {
          return;
        }

        if (event.companyId !== companyId) return;
        const payload = event.payload ?? {};
        const runId = readString(payload["runId"]);
        if (!runId || !activeRunIds.has(runId)) return;

        const run = runById.get(runId);
        if (!run) return;

        if (event.type === "heartbeat.run.event") {
          const seq = typeof payload["seq"] === "number" ? payload["seq"] : null;
          const eventType = readString(payload["eventType"]) ?? "event";
          const messageText = readString(payload["message"]) ?? eventType;
          const dedupeKey = `${runId}:event:${seq ?? `${eventType}:${messageText}:${event.createdAt}`}`;
          if (seenKeysRef.current.has(dedupeKey)) return;
          seenKeysRef.current.add(dedupeKey);
          if (seenKeysRef.current.size > 2000) seenKeysRef.current.clear();
          const tone = eventType === "error" ? "error" : eventType === "lifecycle" ? "warn" : "info";
          const item = createFeedItem(run, event.createdAt, messageText, tone, nextIdRef.current++);
          if (item) appendItems(run.id, [item]);
          return;
        }

        if (event.type === "heartbeat.run.status") {
          const status = readString(payload["status"]) ?? "updated";
          const dedupeKey = `${runId}:status:${status}:${readString(payload["finishedAt"]) ?? ""}`;
          if (seenKeysRef.current.has(dedupeKey)) return;
          seenKeysRef.current.add(dedupeKey);
          if (seenKeysRef.current.size > 2000) seenKeysRef.current.clear();
          const tone = status === "failed" || status === "timed_out" ? "error" : "warn";
          const item = createFeedItem(run, event.createdAt, `run ${status}`, tone, nextIdRef.current++);
          if (item) appendItems(run.id, [item]);
          return;
        }

        if (event.type === "heartbeat.run.log") {
          const chunk = readString(payload["chunk"]);
          if (!chunk) return;
          const stream = readString(payload["stream"]) === "stderr" ? "stderr" : "stdout";
          if (stream === "stderr") {
            appendItems(run.id, parseStderrChunk(run, chunk, event.createdAt, pendingByRunRef.current, nextIdRef));
            return;
          }
          appendItems(run.id, parseStdoutChunk(run, chunk, event.createdAt, pendingByRunRef.current, nextIdRef));
        }
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (socket) {
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close(1000, "active_agents_panel_unmount");
      }
    };
  }, [activeRunIds, companyId, runById]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.35rem] border border-border/80 bg-background/72 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-foreground">
            {runs.length === 0 ? "No live execution right now" : `${runs.length} active or recent agent sessions`}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Focus on the latest meaningful handoff instead of raw transcript walls.
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border bg-card px-3 py-1.5">
            {runningCount} running
          </span>
          <span className="rounded-full border border-border bg-card px-3 py-1.5">
            {queuedCount} queued
          </span>
          <span className="rounded-full border border-border bg-card px-3 py-1.5">
            {Math.max(runs.length - runningCount - queuedCount, 0)} cooling down
          </span>
        </div>
      </div>
      {runs.length === 0 ? (
        <div className="rounded-[1.3rem] border border-dashed border-border/80 bg-card/70 p-8">
          <p className="text-sm text-muted-foreground">No recent agent runs.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {runs.map((run) => (
            <AgentRunCard
              key={run.id}
              run={run}
              issue={run.issueId ? issueById.get(run.issueId) : undefined}
              feed={feedByRun.get(run.id) ?? []}
              isActive={isRunActive(run)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentRunCard({
  run,
  issue,
  feed,
  isActive,
}: {
  run: LiveRunForIssue;
  issue?: Issue;
  feed: FeedItem[];
  isActive: boolean;
}) {
  const recent = feed.slice(-3);
  const latest = recent[recent.length - 1] ?? null;
  const toneClassName =
    latest?.tone === "error"
      ? "text-red-600 dark:text-red-300"
      : latest?.tone === "warn"
        ? "text-amber-600 dark:text-amber-300"
        : latest?.tone === "assistant"
          ? "text-emerald-700 dark:text-emerald-200"
          : latest?.tone === "tool"
            ? "text-cyan-700 dark:text-cyan-200"
            : "text-foreground";
  const fallbackText = isActive
    ? "Execution is live, waiting for the next meaningful event."
    : run.finishedAt
      ? `Finished ${relativeTime(run.finishedAt)}`
      : `Started ${relativeTime(run.createdAt)}`;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[1.45rem] border bg-card/88 shadow-card",
        isActive ? "border-primary/18" : "border-border/85",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span
                className={cn(
                  "absolute inline-flex h-full w-full rounded-full",
                  isActive ? "animate-ping bg-primary/55" : "bg-muted-foreground/25",
                )}
              />
              <span
                className={cn(
                  "relative inline-flex h-2.5 w-2.5 rounded-full",
                  isActive ? "bg-primary" : "bg-muted-foreground/45",
                )}
              />
            </span>
            <Identity name={run.agentName} size="sm" />
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {run.status}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{run.triggerDetail ?? run.invocationSource}</span>
            <span className="text-border">•</span>
            <span>{relativeTime(run.startedAt ?? run.createdAt)}</span>
          </div>

          {run.issueId && (
            <Link
              to={workIssuePath(issue?.identifier ?? run.issueId)}
              className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground no-underline hover:border-primary/20 hover:text-primary"
              title={issue?.title ? `${issue.identifier ?? run.issueId.slice(0, 8)} - ${issue.title}` : issue?.identifier ?? run.issueId.slice(0, 8)}
            >
              <span className="truncate">
                {issue?.identifier ?? run.issueId.slice(0, 8)}
                {issue?.title ? ` · ${issue.title}` : ""}
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
            </Link>
          )}
        </div>

        <Link
          to={`/agents/${run.agentId}/runs/${run.id}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground no-underline hover:border-primary/20 hover:text-foreground"
        >
          Run detail
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="border-t border-border/70 bg-background/66 px-4 py-4">
        <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
          Latest signal
        </div>
        <div className={cn("mt-2 text-sm leading-6", toneClassName)}>
          {latest?.text ?? fallbackText}
        </div>
        {recent.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {recent.slice(0, -1).map((item) => (
              <span
                key={item.id}
                className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground"
              >
                {relativeTime(item.ts)} · {item.text.slice(0, 48)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
