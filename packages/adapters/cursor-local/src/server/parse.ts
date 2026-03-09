import { asString, asNumber, parseObject, parseJson } from "@squadrail/adapter-utils/server-utils";
import { normalizeCursorStreamLine } from "../shared/stream.js";

function asErrorText(value: unknown): string {
  if (typeof value === "string") return value;
  const rec = parseObject(value);
  const message =
    asString(rec.message, "") ||
    asString(rec.error, "") ||
    asString(rec.code, "") ||
    asString(rec.detail, "");
  if (message) return message;
  try {
    return JSON.stringify(rec);
  } catch {
    return "";
  }
}

function collectAssistantText(message: unknown): string[] {
  if (typeof message === "string") {
    const trimmed = message.trim();
    return trimmed ? [trimmed] : [];
  }

  const rec = parseObject(message);
  const direct = asString(rec.text, "").trim();
  const lines: string[] = direct ? [direct] : [];
  const content = Array.isArray(rec.content) ? rec.content : [];

  for (const partRaw of content) {
    const part = parseObject(partRaw);
    const type = asString(part.type, "").trim();
    if (type === "output_text" || type === "text") {
      const text = asString(part.text, "").trim();
      if (text) lines.push(text);
    }
  }

  return lines;
}

function readSessionId(event: Record<string, unknown>): string | null {
  return (
    asString(event.session_id, "").trim() ||
    asString(event.sessionId, "").trim() ||
    asString(event.sessionID, "").trim() ||
    null
  );
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

export function parseCursorJsonl(stdout: string) {
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
    const line = normalizeCursorStreamLine(rawLine).line;
    if (!line) continue;

    const event = parseJson(line);
    if (!event) continue;

    const foundSession = readSessionId(event);
    if (foundSession) sessionId = foundSession;

    const type = asString(event.type, "").trim();

    if (type === "assistant") {
      messages.push(...collectAssistantText(event.message));
      continue;
    }

    if (type === "tool_call") {
      const subtype = asString(event.subtype, "").trim().toLowerCase();
      if (subtype === "completed" || subtype === "complete" || subtype === "finished") {
        const toolCall = parseObject(event.tool_call ?? event.toolCall);
        const [toolName] = Object.keys(toolCall);
        const payload = toolName ? parseObject(toolCall[toolName]) : {};
        if (toolName && isCommandLikeToolName(toolName)) {
          const result = payload.result ?? payload.output ?? parseObject(payload.function).result;
          const success = parseObject(parseObject(result).success);
          const command = readCommand(success) ?? readCommand(result) ?? readCommand(payload.args) ?? readCommand(payload);
          if (command) {
            const aggregatedOutput = [
              asString(success.stdout, "").trim(),
              asString(success.stderr, "").trim(),
              asString(parseObject(result).output, "").trim(),
            ].filter(Boolean).join("\n").trim() || null;
            commandExecutions.push({
              command,
              status: asString(payload.status, "").trim() || subtype || null,
              exitCode: readExitCode(success) ?? readExitCode(parseObject(payload.metadata)),
              aggregatedOutput,
            });
          }
        }
      }
      continue;
    }

    if (type === "tool_use") {
      const part = parseObject(event.part);
      const toolName = asString(part.tool, "tool").trim();
      const state = parseObject(part.state);
      if (isCommandLikeToolName(toolName)) {
        const command = readCommand(state.input);
        if (command) {
          const aggregatedOutput = [
            asString(state.output, "").trim(),
            asString(state.stderr, "").trim(),
          ].filter(Boolean).join("\n").trim() || null;
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

    if (type === "result") {
      const usageObj = parseObject(event.usage);
      usage.inputTokens += asNumber(
        usageObj.input_tokens,
        asNumber(usageObj.inputTokens, 0),
      );
      usage.cachedInputTokens += asNumber(
        usageObj.cached_input_tokens,
        asNumber(usageObj.cachedInputTokens, asNumber(usageObj.cache_read_input_tokens, 0)),
      );
      usage.outputTokens += asNumber(
        usageObj.output_tokens,
        asNumber(usageObj.outputTokens, 0),
      );
      totalCostUsd += asNumber(event.total_cost_usd, asNumber(event.cost_usd, asNumber(event.cost, 0)));

      const isError = event.is_error === true || asString(event.subtype, "").toLowerCase() === "error";
      const resultText = asString(event.result, "").trim();
      if (resultText && messages.length === 0) {
        messages.push(resultText);
      }
      if (isError) {
        const resultError = asErrorText(event.error ?? event.message ?? event.result).trim();
        if (resultError) errorMessage = resultError;
      }
      continue;
    }

    if (type === "error") {
      const message = asErrorText(event.message ?? event.error ?? event.detail).trim();
      if (message) errorMessage = message;
      continue;
    }

    if (type === "system") {
      const subtype = asString(event.subtype, "").trim().toLowerCase();
      if (subtype === "error") {
        const message = asErrorText(event.message ?? event.error ?? event.detail).trim();
        if (message) errorMessage = message;
      }
      continue;
    }

    // Compatibility with older stream-json shapes.
    if (type === "text") {
      const part = parseObject(event.part);
      const text = asString(part.text, "").trim();
      if (text) messages.push(text);
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

export function isCursorUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return /unknown\s+(session|chat)|session\s+.*\s+not\s+found|chat\s+.*\s+not\s+found|resume\s+.*\s+not\s+found|could\s+not\s+resume/i.test(
    haystack,
  );
}
