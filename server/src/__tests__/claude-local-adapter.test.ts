import { describe, expect, it } from "vitest";
import { isClaudeMaxTurnsResult, parseClaudeStreamJson } from "@squadrail/adapter-claude-local/server";

describe("claude_local parser", () => {
  it("extracts bash tool executions from tool_use/tool_result pairs", () => {
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "claude-123", model: "claude-sonnet" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "bash",
              input: { command: "pnpm test:run" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: "PASS",
              is_error: false,
            },
          ],
        },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "claude-123",
        result: "done",
        usage: { input_tokens: 12, cache_read_input_tokens: 2, output_tokens: 4 },
      }),
    ].join("\n");

    const parsed = parseClaudeStreamJson(stdout);
    expect(parsed.sessionId).toBe("claude-123");
    expect(parsed.resultJson).toEqual(
      expect.objectContaining({
        commandExecutions: [
          {
            command: "pnpm test:run",
            status: "completed",
            exitCode: 0,
            aggregatedOutput: "PASS",
          },
        ],
      }),
    );
  });

  it("extracts failing bash tool exit codes from tool_result output", () => {
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "claude-456", model: "claude-sonnet" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_2",
              name: "bash",
              input: { command: "pnpm build" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_2",
              content: "Command failed with exit code 2",
              is_error: true,
            },
          ],
        },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "claude-456",
        result: "done",
        usage: { input_tokens: 12, cache_read_input_tokens: 2, output_tokens: 4 },
      }),
    ].join("\n");

    const parsed = parseClaudeStreamJson(stdout);
    expect(parsed.resultJson).toEqual(
      expect.objectContaining({
        commandExecutions: [
          {
            command: "pnpm build",
            status: "failed",
            exitCode: 2,
            aggregatedOutput: "Command failed with exit code 2",
          },
        ],
      }),
    );
  });
});

describe("claude_local max-turn detection", () => {
  it("detects max-turn exhaustion by subtype", () => {
    expect(
      isClaudeMaxTurnsResult({
        subtype: "error_max_turns",
        result: "Reached max turns",
      }),
    ).toBe(true);
  });

  it("detects max-turn exhaustion by stop_reason", () => {
    expect(
      isClaudeMaxTurnsResult({
        stop_reason: "max_turns",
      }),
    ).toBe(true);
  });

  it("returns false for non-max-turn results", () => {
    expect(
      isClaudeMaxTurnsResult({
        subtype: "success",
        stop_reason: "end_turn",
      }),
    ).toBe(false);
  });
});
