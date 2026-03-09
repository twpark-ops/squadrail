import { asString, asNumber, parseObject, parseJson } from "@squadrail/adapter-utils/server-utils";

function asErrorText(value: unknown): string {
  if (typeof value === "string") return value;
  const rec = parseObject(value);
  const message = asString(rec.message, "") || asString(rec.error, "") || asString(rec.code, "");
  if (message) return message;
  try {
    return JSON.stringify(rec);
  } catch {
    return "";
  }
}

function isCommandLikeToolName(name: string) {
  return /(?:^|_)(?:bash|shell)(?:$|_)/i.test(name) || name === "command_execution";
}

function readCommand(value: unknown): string | null {
  const record = parseObject(value);
  const command = asString(record.command, "").trim();
  return command || null;
}

function readExitCode(value: unknown) {
  const record = parseObject(value);
  const exit = record.exitCode ?? record.exit;
  return typeof exit === "number" && Number.isFinite(exit) ? exit : null;
}

export function parseOpenCodeJsonl(stdout: string) {
  let sessionId: string | null = null;
  const messages: string[] = [];
  let errorMessage: string | null = null;
  const commandExecutions: Array<{
    command: string;
    status: string | null;
    exitCode: number | null;
    aggregatedOutput: string | null;
  }> = [];
  let totalCostUsd = 0;
  const usage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const event = parseJson(line);
    if (!event) continue;

    const foundSession = asString(event.sessionID, "").trim();
    if (foundSession) sessionId = foundSession;

    const type = asString(event.type, "");

    if (type === "text") {
      const part = parseObject(event.part);
      const text = asString(part.text, "").trim();
      if (text) messages.push(text);
      continue;
    }

    if (type === "tool_use") {
      const part = parseObject(event.part);
      const toolName = asString(part.tool, "tool").trim();
      const state = parseObject(part.state);
      if (isCommandLikeToolName(toolName)) {
        const command = readCommand(state.input);
        if (command) {
          const aggregatedOutput = asString(state.output, "").trim() || null;
          commandExecutions.push({
            command,
            status: asString(state.status, "").trim() || null,
            exitCode: readExitCode(state.metadata),
            aggregatedOutput,
          });
        }
      }
      continue;
    }

    if (type === "step_finish") {
      const part = parseObject(event.part);
      const tokens = parseObject(part.tokens);
      const cache = parseObject(tokens.cache);
      usage.inputTokens += asNumber(tokens.input, 0);
      usage.cachedInputTokens += asNumber(cache.read, 0);
      usage.outputTokens += asNumber(tokens.output, 0);
      totalCostUsd += asNumber(part.cost, 0);
      continue;
    }

    if (type === "error") {
      const part = parseObject(event.part);
      const msg = asErrorText(event.message ?? part.message ?? event.error ?? part.error).trim();
      if (msg) errorMessage = msg;
    }
  }

  return {
    sessionId,
    summary: messages.join("\n\n").trim(),
    usage,
    costUsd: totalCostUsd > 0 ? totalCostUsd : null,
    errorMessage,
    commandExecutions,
  };
}

export function isOpenCodeUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return /unknown\s+session|session\s+.*\s+not\s+found|resource\s+not\s+found:.*[\\/]session[\\/].*\.json|notfounderror/i.test(
    haystack,
  );
}
