type VerificationSignalKind = "test" | "build";
type VerificationSignalSource = "command_execution" | "stdout_excerpt" | "stderr_excerpt" | "result_json";
type VerificationSignalConfidence = "structured" | "heuristic";
type VerificationSignalStatus = "passed" | "failed" | "unknown";
const SHELL_TOOL_NAME_RE = /(?:^|_)(?:bash|shell)(?:$|_)/i;
const EXIT_CODE_PATTERNS = [
  /\bexit(?:ed)?\s+(?:with\s+)?code\s*[:=]?\s*(-?\d+)\b/i,
  /\bexit_code\s*[:=]?\s*(-?\d+)\b/i,
  /\bexitCode\s*[:=]?\s*(-?\d+)\b/i,
] as const;

export type RunVerificationSignal = {
  kind: VerificationSignalKind;
  command: string;
  source: VerificationSignalSource;
  confidence: VerificationSignalConfidence;
  status: VerificationSignalStatus;
  exitCode: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readExitCode(value: unknown): number | null {
  const record = asRecord(value);
  const direct = [record.exit_code, record.exitCode, record.code, record.status_code]
    .find((entry) => typeof entry === "number" && Number.isFinite(entry));
  return typeof direct === "number" ? direct : null;
}

function inferExitCodeFromText(text: string, isError: boolean): number | null {
  for (const pattern of EXIT_CODE_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return isError ? 1 : 0;
}

function uniqueSignals(signals: RunVerificationSignal[]) {
  const deduped = new Map<string, RunVerificationSignal>();
  const signalRank = (signal: RunVerificationSignal) => {
    const confidenceRank = signal.confidence === "structured" ? 100 : 0;
    const statusRank =
      signal.status === "passed"
        ? 3
        : signal.status === "failed"
          ? 2
          : 1;
    return confidenceRank + statusRank;
  };

  for (const signal of signals) {
    const key = `${signal.kind}:${signal.command.toLowerCase()}`;
    const existing = deduped.get(key);
    if (!existing || signalRank(signal) > signalRank(existing)) {
      deduped.set(key, signal);
    }
  }

  return Array.from(deduped.values());
}

const TEST_COMMAND_PATTERNS = [
  /\bpnpm\s+test(?::[^\s]+)?(?:\s+[^\r\n]+)?/iu,
  /\bnpm\s+test(?:\s+[^\r\n]+)?/iu,
  /\bbun\s+test(?:\s+[^\r\n]+)?/iu,
  /\bvitest(?:\s+[^\r\n]+)?/iu,
  /\bjest(?:\s+[^\r\n]+)?/iu,
  /\bpytest(?:\s+[^\r\n]+)?/iu,
  /\bgo\s+test(?:\s+[^\r\n]+)?/iu,
  /\bcargo\s+test(?:\s+[^\r\n]+)?/iu,
  /\bctest(?:\s+[^\r\n]+)?/iu,
  /\bxcodebuild\s+test(?:\s+[^\r\n]+)?/iu,
] as const;

const BUILD_COMMAND_PATTERNS = [
  /\bpnpm\s+build(?:\s+[^\r\n]+)?/iu,
  /\bnpm\s+run\s+build(?:\s+[^\r\n]+)?/iu,
  /\bbun\s+run\s+build(?:\s+[^\r\n]+)?/iu,
  /\bvite\s+build(?:\s+[^\r\n]+)?/iu,
  /\bnext\s+build(?:\s+[^\r\n]+)?/iu,
  /\bnuxt\s+build(?:\s+[^\r\n]+)?/iu,
  /\bwebpack(?:\s+[^\r\n]+)?/iu,
  /\brollup(?:\s+[^\r\n]+)?/iu,
  /\besbuild(?:\s+[^\r\n]+)?/iu,
  /\btsc(?:\s+[^\r\n]+)?/iu,
  /\bdocker\s+build(?:\s+[^\r\n]+)?/iu,
  /\bgradle\s+build(?:\s+[^\r\n]+)?/iu,
  /\bmvn\s+(?:package|install|verify)(?:\s+[^\r\n]+)?/iu,
] as const;

function extractSignalsFromText(text: string | null | undefined, source: VerificationSignalSource) {
  if (!text) return [];
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 256);

  const signals: RunVerificationSignal[] = [];
  for (const line of lines) {
    for (const pattern of TEST_COMMAND_PATTERNS) {
      const match = line.match(pattern);
      if (match?.[0]) {
        signals.push({
          kind: "test",
          command: match[0].trim(),
          source,
          confidence: "heuristic",
          status: "unknown",
          exitCode: null,
        });
      }
    }
    for (const pattern of BUILD_COMMAND_PATTERNS) {
      const match = line.match(pattern);
      if (match?.[0]) {
        signals.push({
          kind: "build",
          command: match[0].trim(),
          source,
          confidence: "heuristic",
          status: "unknown",
          exitCode: null,
        });
      }
    }
  }
  return signals;
}

function normalizeStructuredStatus(status: string | null, exitCode: number | null): VerificationSignalStatus {
  if (typeof exitCode === "number" && Number.isFinite(exitCode)) {
    return exitCode === 0 ? "passed" : "failed";
  }

  const normalized = status?.trim().toLowerCase() ?? "";
  if (["completed", "succeeded", "success", "passed"].includes(normalized)) return "passed";
  if (["failed", "errored", "error", "cancelled"].includes(normalized)) return "failed";
  return "unknown";
}

function detectSignalKinds(command: string) {
  const trimmed = command.trim();
  const detectedKinds = new Set<VerificationSignalKind>();
  for (const pattern of TEST_COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      detectedKinds.add("test");
      break;
    }
  }
  for (const pattern of BUILD_COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      detectedKinds.add("build");
      break;
    }
  }
  return Array.from(detectedKinds);
}

function extractStructuredSignalsFromResultJson(resultJson: Record<string, unknown> | null | undefined) {
  const json = asRecord(resultJson);
  const commandExecutions = Array.isArray(json.commandExecutions) ? json.commandExecutions : [];
  const signals: RunVerificationSignal[] = [];
  for (const entry of commandExecutions) {
    const record = asRecord(entry);
    const command = readString(record.command);
    if (!command) continue;
    const exitCode = typeof record.exitCode === "number" && Number.isFinite(record.exitCode)
      ? record.exitCode
      : null;
    const status = readString(record.status);
    const normalizedStatus = normalizeStructuredStatus(status, exitCode);
    for (const kind of detectSignalKinds(command)) {
      signals.push({
        kind,
        command,
        source: "command_execution",
        confidence: "structured",
        status: normalizedStatus,
        exitCode,
      });
    }
  }
  return signals;
}

function extractStructuredSignalsFromLiveLog(logContent: string | null | undefined) {
  if (!logContent) return [];

  const signals: RunVerificationSignal[] = [];
  const pendingCommandToolUses = new Map<string, string>();
  const outerLines = logContent
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const outerLine of outerLines) {
    let outerRecord: Record<string, unknown>;
    try {
      outerRecord = asRecord(JSON.parse(outerLine));
    } catch {
      continue;
    }

    const chunk = readString(outerRecord.chunk);
    if (!chunk) continue;

    const innerLines = chunk
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const innerLine of innerLines) {
      if (!innerLine.startsWith("{")) continue;

      let eventRecord: Record<string, unknown>;
      try {
        eventRecord = asRecord(JSON.parse(innerLine));
      } catch {
        continue;
      }

      if (readString(eventRecord.type) === "assistant") {
        const message = asRecord(eventRecord.message);
        const content = Array.isArray(message.content) ? message.content : [];
        for (const entry of content) {
          const block = asRecord(entry);
          if (readString(block.type) !== "tool_use") continue;
          const toolName = readString(block.name) ?? "";
          const toolId = readString(block.id);
          const input = asRecord(block.input);
          const command = readString(input.command);
          if (!toolId || !command || !SHELL_TOOL_NAME_RE.test(toolName)) continue;
          pendingCommandToolUses.set(toolId, command);
        }
        continue;
      }

      if (readString(eventRecord.type) === "user") {
        const message = asRecord(eventRecord.message);
        const content = Array.isArray(message.content) ? message.content : [];
        for (const entry of content) {
          const block = asRecord(entry);
          if (readString(block.type) !== "tool_result") continue;
          const toolUseId = readString(block.tool_use_id);
          const command = toolUseId ? pendingCommandToolUses.get(toolUseId) ?? null : null;
          if (!command) continue;

          const isError = block.is_error === true;
          let aggregatedOutput = "";
          let exitCode = readExitCode(block) ?? readExitCode(block.metadata);
          const contentValue = block.content;

          if (typeof contentValue === "string") {
            aggregatedOutput = contentValue.trim();
          } else if (Array.isArray(contentValue)) {
            aggregatedOutput = contentValue
              .map((part) => {
                const item = asRecord(part);
                exitCode = exitCode ?? readExitCode(item) ?? readExitCode(item.metadata);
                return readString(item.text) ?? "";
              })
              .filter(Boolean)
              .join("\n")
              .trim();
          }

          exitCode = exitCode ?? inferExitCodeFromText(aggregatedOutput, isError);
          const normalizedStatus = normalizeStructuredStatus(isError ? "failed" : "completed", exitCode);

          for (const kind of detectSignalKinds(command)) {
            signals.push({
              kind,
              command,
              source: "command_execution",
              confidence: "structured",
              status: normalizedStatus,
              exitCode,
            });
          }

          pendingCommandToolUses.delete(toolUseId ?? "");
        }
        continue;
      }

      const item = asRecord(eventRecord.item);
      if (item.type !== "command_execution") continue;

      const command = readString(item.command);
      if (!command) continue;

      const exitCode =
        typeof item.exit_code === "number" && Number.isFinite(item.exit_code)
          ? item.exit_code
          : typeof item.exitCode === "number" && Number.isFinite(item.exitCode)
            ? item.exitCode
            : null;
      const status = readString(item.status);
      const normalizedStatus = normalizeStructuredStatus(status, exitCode);

      for (const kind of detectSignalKinds(command)) {
        signals.push({
          kind,
          command,
          source: "command_execution",
          confidence: "structured",
          status: normalizedStatus,
          exitCode,
        });
      }
    }
  }

  return signals;
}

function extractTextsFromResultJson(resultJson: Record<string, unknown> | null | undefined) {
  const json = asRecord(resultJson);
  return [
    readString(json.stdout),
    readString(json.stderr),
    readString(json.summary),
    readString(json.result),
  ].filter((value): value is string => Boolean(value));
}

export function extractRunVerificationSignals(input: {
  stdoutExcerpt?: string | null;
  stderrExcerpt?: string | null;
  resultJson?: Record<string, unknown> | null;
  logContent?: string | null;
}) {
  const signals = [
    ...extractStructuredSignalsFromResultJson(input.resultJson),
    ...extractStructuredSignalsFromLiveLog(input.logContent),
    ...extractSignalsFromText(input.stdoutExcerpt, "stdout_excerpt"),
    ...extractSignalsFromText(input.stderrExcerpt, "stderr_excerpt"),
    ...extractTextsFromResultJson(input.resultJson).flatMap((text) => extractSignalsFromText(text, "result_json")),
  ];
  return uniqueSignals(signals);
}
