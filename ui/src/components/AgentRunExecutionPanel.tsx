import { useState, type ReactNode, type RefObject } from "react";
import type { HeartbeatRun, HeartbeatRunEvent } from "@squadrail/shared";
import type { TranscriptEntry } from "../adapters";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import { cn, formatTokens } from "../lib/utils";

const REDACTED_ENV_VALUE = "***REDACTED***";
const SECRET_ENV_KEY_RE =
  /(api[-_]?key|access[-_]?token|auth(?:_?token)?|authorization|bearer|secret|passwd|password|credential|jwt|private[-_]?key|cookie|connectionstring)/i;
const JWT_VALUE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/;

function shouldRedactSecretValue(key: string, value: unknown): boolean {
  if (SECRET_ENV_KEY_RE.test(key)) return true;
  if (typeof value !== "string") return false;
  return JWT_VALUE_RE.test(value);
}

function redactEnvValue(key: string, value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "secret_ref"
  ) {
    return "***SECRET_REF***";
  }
  if (shouldRedactSecretValue(key, value)) return REDACTED_ENV_VALUE;
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatEnvForDisplay(envValue: unknown): string {
  const env = asRecord(envValue);
  if (!env) return "<unable-to-parse>";

  const keys = Object.keys(env);
  if (keys.length === 0) return "<empty>";

  return keys
    .sort()
    .map((key) => `${key}=${redactEnvValue(key, env[key])}`)
    .join("\n");
}

function formatStructuredValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    const formatted = JSON.stringify(value, null, 2);
    return typeof formatted === "string" ? formatted : "";
  } catch {
    return String(value ?? "");
  }
}

function buildPromptPreview(promptValue: unknown, maxLines = 10): { preview: string; lineCount: number } {
  const prompt = typeof promptValue === "string" ? promptValue : formatStructuredValue(promptValue);
  const lines = prompt.split(/\r?\n/);
  return {
    preview: lines.slice(0, maxLines).join("\n"),
    lineCount: lines.length,
  };
}

function summarizeEnvironment(envValue: unknown): { totalKeys: number; redactedKeys: number } {
  const env = asRecord(envValue);
  if (!env) return { totalKeys: 0, redactedKeys: 0 };
  let redactedKeys = 0;
  for (const [key, value] of Object.entries(env)) {
    if (
      shouldRedactSecretValue(key, value) ||
      (typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        (value as { type?: unknown }).type === "secret_ref")
    ) {
      redactedKeys += 1;
    }
  }
  return {
    totalKeys: Object.keys(env).length,
    redactedKeys,
  };
}

function summarizeContext(contextValue: unknown): Array<{ label: string; value: string }> {
  const context = asRecord(contextValue);
  if (!context) return [];

  const preferredKeys: Array<[string, string]> = [
    ["issueId", "Issue"],
    ["taskId", "Task"],
    ["taskKey", "Task key"],
    ["workspaceSource", "Workspace"],
    ["workspaceUsage", "Usage"],
    ["workspaceBranchName", "Branch"],
    ["wakeReason", "Wake"],
    ["protocolMessageType", "Protocol"],
    ["protocolWorkflow", "Workflow"],
  ];

  return preferredKeys
    .map(([key, label]) => {
      const value = context[key];
      const normalized = asNonEmptyString(value) ?? (typeof value === "number" ? String(value) : null);
      if (!normalized) return null;
      return { label, value: normalized };
    })
    .filter((value): value is { label: string; value: string } => value !== null);
}

function DiagnosticsSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border bg-background/60">
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
          <div className="min-w-0">
            <div className="text-xs font-medium text-foreground">{title}</div>
            {summary ? <div className="mt-0.5 text-[11px] text-muted-foreground">{summary}</div> : null}
          </div>
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border px-3 py-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export interface AgentRunExecutionPanelProps {
  transcript: TranscriptEntry[];
  run: Pick<HeartbeatRun, "status" | "error" | "stderrExcerpt" | "resultJson" | "stdoutExcerpt">;
  events: HeartbeatRunEvent[];
  adapterInvokePayload: Record<string, unknown> | null;
  logError?: string | null;
  isLive?: boolean;
  isFollowing?: boolean;
  onJumpToLive?: (() => void) | null;
  logEndRef?: RefObject<HTMLDivElement | null>;
  hasPersistedLog?: boolean;
  testId?: string;
}

export function AgentRunExecutionPanel({
  transcript,
  run,
  events,
  adapterInvokePayload,
  logError = null,
  isLive = false,
  isFollowing = false,
  onJumpToLive = null,
  logEndRef,
  hasPersistedLog = false,
  testId,
}: AgentRunExecutionPanelProps) {
  const contextSummary = summarizeContext(adapterInvokePayload?.context);
  const environmentSummary = summarizeEnvironment(adapterInvokePayload?.env);
  const promptPreview = buildPromptPreview(adapterInvokePayload?.prompt);
  const diagnosticsCount =
    (adapterInvokePayload?.prompt !== undefined ? 1 : 0) +
    (adapterInvokePayload?.context !== undefined ? 1 : 0) +
    (adapterInvokePayload?.env !== undefined ? 1 : 0) +
    (events.length > 0 ? 1 : 0);

  if (events.length === 0 && transcript.length === 0 && !logError) {
    return <p className="text-xs text-muted-foreground">No log events.</p>;
  }

  const levelColors: Record<string, string> = {
    info: "text-foreground",
    warn: "text-yellow-600 dark:text-yellow-400",
    error: "text-red-600 dark:text-red-400",
  };

  const streamColors: Record<string, string> = {
    stdout: "text-foreground",
    stderr: "text-red-600 dark:text-red-300",
    system: "text-blue-600 dark:text-blue-300",
  };

  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Transcript ({transcript.length})
        </span>
        <div className="flex items-center gap-2">
          {isLive && !isFollowing && onJumpToLive ? (
            <Button variant="ghost" size="xs" onClick={onJumpToLive}>
              Jump to live
            </Button>
          ) : null}
          {isLive ? (
            <span className="flex items-center gap-1 text-xs text-cyan-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400" />
              </span>
              Live
            </span>
          ) : null}
        </div>
      </div>
      <div className="bg-neutral-100 dark:bg-neutral-950 rounded-lg p-3 font-mono text-xs space-y-0.5 overflow-x-hidden">
        {transcript.length === 0 && !hasPersistedLog ? (
          <div className="text-neutral-500">No persisted transcript for this run.</div>
        ) : null}
        {transcript.map((entry, idx) => {
          const time = new Date(entry.ts).toLocaleTimeString("en-US", { hour12: false });
          const grid = "grid grid-cols-[auto_auto_1fr] gap-x-2 sm:gap-x-3 items-baseline";
          const tsCell = "text-neutral-400 dark:text-neutral-600 select-none w-12 sm:w-16 text-[10px] sm:text-xs";
          const lblCell = "w-14 sm:w-20 text-[10px] sm:text-xs";
          const contentCell = "min-w-0 whitespace-pre-wrap break-words overflow-hidden";
          const expandCell = "col-span-full md:col-start-3 md:col-span-1";

          if (entry.kind === "assistant") {
            return (
              <div key={`${entry.ts}-assistant-${idx}`} className={cn(grid, "py-0.5")}>
                <span className={tsCell}>{time}</span>
                <span className={cn(lblCell, "text-green-700 dark:text-green-300")}>assistant</span>
                <span className={cn(contentCell, "text-green-900 dark:text-green-100")}>{entry.text}</span>
              </div>
            );
          }

          if (entry.kind === "thinking") {
            return (
              <div key={`${entry.ts}-thinking-${idx}`} className={cn(grid, "py-0.5")}>
                <span className={tsCell}>{time}</span>
                <span className={cn(lblCell, "text-green-600/60 dark:text-green-300/60")}>thinking</span>
                <span className={cn(contentCell, "text-green-800/60 dark:text-green-100/60 italic")}>{entry.text}</span>
              </div>
            );
          }

          if (entry.kind === "user") {
            return (
              <div key={`${entry.ts}-user-${idx}`} className={cn(grid, "py-0.5")}>
                <span className={tsCell}>{time}</span>
                <span className={cn(lblCell, "text-neutral-500 dark:text-neutral-400")}>user</span>
                <span className={cn(contentCell, "text-neutral-700 dark:text-neutral-300")}>{entry.text}</span>
              </div>
            );
          }

          if (entry.kind === "tool_call") {
            return (
              <div key={`${entry.ts}-tool-${idx}`} className={cn(grid, "gap-y-1 py-0.5")}>
                <span className={tsCell}>{time}</span>
                <span className={cn(lblCell, "text-yellow-700 dark:text-yellow-300")}>tool_call</span>
                <span className="text-yellow-900 dark:text-yellow-100 min-w-0">{entry.name}</span>
                <pre className={cn(expandCell, "bg-neutral-200 dark:bg-neutral-900 rounded p-2 text-[11px] overflow-x-auto whitespace-pre-wrap text-neutral-800 dark:text-neutral-200")}>
                  {JSON.stringify(entry.input, null, 2)}
                </pre>
              </div>
            );
          }

          if (entry.kind === "tool_result") {
            return (
              <div key={`${entry.ts}-toolres-${idx}`} className={cn(grid, "gap-y-1 py-0.5")}>
                <span className={tsCell}>{time}</span>
                <span className={cn(lblCell, entry.isError ? "text-red-600 dark:text-red-300" : "text-purple-600 dark:text-purple-300")}>tool_result</span>
                {entry.isError ? <span className="text-red-600 dark:text-red-400 min-w-0">error</span> : <span />}
                <pre className={cn(expandCell, "bg-neutral-100 dark:bg-neutral-900 rounded p-2 text-[11px] overflow-x-auto whitespace-pre-wrap text-neutral-700 dark:text-neutral-300 max-h-60 overflow-y-auto")}>
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(entry.content), null, 2);
                    } catch {
                      return entry.content;
                    }
                  })()}
                </pre>
              </div>
            );
          }

          if (entry.kind === "init") {
            return (
              <div key={`${entry.ts}-init-${idx}`} className={grid}>
                <span className={tsCell}>{time}</span>
                <span className={cn(lblCell, "text-blue-700 dark:text-blue-300")}>init</span>
                <span className={cn(contentCell, "text-blue-900 dark:text-blue-100")}>model: {entry.model}{entry.sessionId ? `, session: ${entry.sessionId}` : ""}</span>
              </div>
            );
          }

          if (entry.kind === "result") {
            return (
              <div key={`${entry.ts}-result-${idx}`} className={cn(grid, "gap-y-1 py-0.5")}>
                <span className={tsCell}>{time}</span>
                <span className={cn(lblCell, "text-cyan-700 dark:text-cyan-300")}>result</span>
                <span className={cn(contentCell, "text-cyan-900 dark:text-cyan-100")}>
                  tokens in={formatTokens(entry.inputTokens)} out={formatTokens(entry.outputTokens)} cached={formatTokens(entry.cachedTokens)} cost=${entry.costUsd.toFixed(6)}
                </span>
                {(entry.subtype || entry.isError || entry.errors.length > 0) ? (
                  <div className={cn(expandCell, "text-red-600 dark:text-red-300 whitespace-pre-wrap break-words")}>
                    subtype={entry.subtype || "unknown"} is_error={entry.isError ? "true" : "false"}
                    {entry.errors.length > 0 ? ` errors=${entry.errors.join(" | ")}` : ""}
                  </div>
                ) : null}
                {entry.text ? (
                  <div className={cn(expandCell, "whitespace-pre-wrap break-words text-neutral-800 dark:text-neutral-100")}>{entry.text}</div>
                ) : null}
              </div>
            );
          }

          const label =
            entry.kind === "stderr" ? "stderr" :
            entry.kind === "system" ? "system" :
            "stdout";
          const color =
            entry.kind === "stderr" ? "text-red-600 dark:text-red-300" :
            entry.kind === "system" ? "text-blue-600 dark:text-blue-300" :
            "text-neutral-500";
          return (
            <div key={`${entry.ts}-raw-${idx}`} className={grid}>
              <span className={tsCell}>{time}</span>
              <span className={cn(lblCell, color)}>{label}</span>
              <span className={cn(contentCell, color)}>{entry.text}</span>
            </div>
          );
        })}
        {logError ? <div className="text-red-600 dark:text-red-300">{logError}</div> : null}
        {logEndRef ? <div ref={logEndRef} /> : null}
      </div>

      {(run.status === "failed" || run.status === "timed_out") ? (
        <div className="rounded-lg border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-950/20 p-3 space-y-2">
          <div className="text-xs font-medium text-red-700 dark:text-red-300">Failure details</div>
          {run.error ? (
            <div className="text-xs text-red-600 dark:text-red-200">
              <span className="text-red-700 dark:text-red-300">Error: </span>
              {run.error}
            </div>
          ) : null}
          {run.stderrExcerpt && run.stderrExcerpt.trim() ? (
            <div>
              <div className="text-xs text-red-700 dark:text-red-300 mb-1">stderr excerpt</div>
              <pre className="bg-red-50 dark:bg-neutral-950 rounded-md p-2 text-xs overflow-x-auto whitespace-pre-wrap text-red-800 dark:text-red-100">
                {run.stderrExcerpt}
              </pre>
            </div>
          ) : null}
          {run.resultJson ? (
            <div>
              <div className="text-xs text-red-700 dark:text-red-300 mb-1">adapter result JSON</div>
              <pre className="bg-red-50 dark:bg-neutral-950 rounded-md p-2 text-xs overflow-x-auto whitespace-pre-wrap text-red-800 dark:text-red-100">
                {JSON.stringify(run.resultJson, null, 2)}
              </pre>
            </div>
          ) : null}
          {run.stdoutExcerpt && run.stdoutExcerpt.trim() && !run.resultJson ? (
            <div>
              <div className="text-xs text-red-700 dark:text-red-300 mb-1">stdout excerpt</div>
              <pre className="bg-red-50 dark:bg-neutral-950 rounded-md p-2 text-xs overflow-x-auto whitespace-pre-wrap text-red-800 dark:text-red-100">
                {run.stdoutExcerpt}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {(adapterInvokePayload || events.length > 0) ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Diagnostics</span>
            <span className="text-[11px] text-muted-foreground">
              {diagnosticsCount} section{diagnosticsCount === 1 ? "" : "s"}
            </span>
          </div>

          {adapterInvokePayload ? (
            <div className="rounded-lg border border-border bg-background/60 px-3 py-3 space-y-2">
              <div className="text-xs font-medium text-foreground">Invocation summary</div>
              <div className="grid gap-2 sm:grid-cols-2 text-xs text-muted-foreground">
                {typeof adapterInvokePayload.adapterType === "string" ? (
                  <div>
                    <span className="text-foreground">Adapter</span>: {adapterInvokePayload.adapterType}
                  </div>
                ) : null}
                {typeof adapterInvokePayload.cwd === "string" ? (
                  <div className="truncate" title={adapterInvokePayload.cwd}>
                    <span className="text-foreground">Working dir</span>: <span className="font-mono">{adapterInvokePayload.cwd}</span>
                  </div>
                ) : null}
                {typeof adapterInvokePayload.command === "string" ? (
                  <div className="sm:col-span-2 break-all">
                    <span className="text-foreground">Command</span>:{" "}
                    <span className="font-mono">
                      {[
                        adapterInvokePayload.command,
                        ...(Array.isArray(adapterInvokePayload.commandArgs)
                          ? adapterInvokePayload.commandArgs.filter((value): value is string => typeof value === "string")
                          : []),
                      ].join(" ")}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {adapterInvokePayload?.prompt !== undefined ? (
            <DiagnosticsSection
              title="Prompt"
              summary={
                promptPreview.lineCount > 0
                  ? `${promptPreview.lineCount} line(s) · first lines shown by default`
                  : "structured prompt payload"
              }
            >
              <pre className="bg-neutral-100 dark:bg-neutral-950 rounded-md p-2 text-xs overflow-x-auto whitespace-pre-wrap">
                {promptPreview.preview}
                {promptPreview.lineCount > 10 ? "\n…" : ""}
              </pre>
              <pre className="mt-3 bg-neutral-100 dark:bg-neutral-950 rounded-md p-2 text-xs overflow-x-auto whitespace-pre-wrap">
                {formatStructuredValue(adapterInvokePayload.prompt)}
              </pre>
            </DiagnosticsSection>
          ) : null}

          {adapterInvokePayload?.context !== undefined ? (
            <DiagnosticsSection
              title="Context"
              summary={
                contextSummary.length > 0
                  ? `${contextSummary.length} highlighted field(s)`
                  : "raw runtime context"
              }
            >
              {contextSummary.length > 0 ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  {contextSummary.map((entry) => (
                    <span
                      key={`${entry.label}:${entry.value}`}
                      className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      <span className="text-foreground">{entry.label}</span>: {entry.value}
                    </span>
                  ))}
                </div>
              ) : null}
              <pre className="bg-neutral-100 dark:bg-neutral-950 rounded-md p-2 text-xs overflow-x-auto whitespace-pre-wrap">
                {formatStructuredValue(adapterInvokePayload.context)}
              </pre>
            </DiagnosticsSection>
          ) : null}

          {adapterInvokePayload?.env !== undefined ? (
            <DiagnosticsSection
              title="Environment"
              summary={`${environmentSummary.totalKeys} key(s) · ${environmentSummary.redactedKeys} redacted`}
            >
              <pre className="bg-neutral-100 dark:bg-neutral-950 rounded-md p-2 text-xs overflow-x-auto whitespace-pre-wrap font-mono">
                {formatEnvForDisplay(adapterInvokePayload.env)}
              </pre>
            </DiagnosticsSection>
          ) : null}

          {events.length > 0 ? (
            <DiagnosticsSection
              title="Events"
              summary={`${events.length} event(s) captured for this run`}
            >
              <div className="bg-neutral-100 dark:bg-neutral-950 rounded-lg p-3 font-mono text-xs space-y-0.5">
                {events.map((evt) => {
                  const color = evt.color
                    ?? (evt.level ? levelColors[evt.level] : null)
                    ?? (evt.stream ? streamColors[evt.stream] : null)
                    ?? "text-foreground";

                  return (
                    <div key={evt.id} className="flex gap-2">
                      <span className="text-neutral-400 dark:text-neutral-600 shrink-0 select-none w-16">
                        {new Date(evt.createdAt).toLocaleTimeString("en-US", { hour12: false })}
                      </span>
                      <span className={cn("shrink-0 w-14", evt.stream ? (streamColors[evt.stream] ?? "text-neutral-500") : "text-neutral-500")}>
                        {evt.stream ? `[${evt.stream}]` : ""}
                      </span>
                      <span className={cn("break-all", color)}>
                        {evt.message ?? (evt.payload ? JSON.stringify(evt.payload) : "")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </DiagnosticsSection>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
