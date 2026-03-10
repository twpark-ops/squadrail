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

  it("synthesizes a result payload when stream-json lacks a final result event", () => {
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "claude-789", model: "claude-sonnet" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Reassigned the issue and waiting for the follow-up wake." },
            {
              type: "tool_use",
              id: "toolu_3",
              name: "bash",
              input: { command: "node scripts/runtime/squadrail-protocol.mjs reassign-task --issue \"$SQUADRAIL_TASK_ID\" ..." },
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
              tool_use_id: "toolu_3",
              content: "{\"messageType\":\"REASSIGN_TASK\"}",
              is_error: false,
            },
          ],
        },
      }),
    ].join("\n");

    const parsed = parseClaudeStreamJson(stdout);
    expect(parsed.sessionId).toBe("claude-789");
    expect(parsed.summary).toContain("Reassigned the issue");
    expect(parsed.resultJson).toEqual(
      expect.objectContaining({
        subtype: "stream_incomplete",
        session_id: "claude-789",
        commandExecutions: [
          expect.objectContaining({
            status: "completed",
            exitCode: 0,
          }),
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
