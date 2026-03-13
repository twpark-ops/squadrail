import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBuildSquadrailEnv,
  mockRedactEnvForLogs,
  mockRunChildProcess,
} = vi.hoisted(() => ({
  mockBuildSquadrailEnv: vi.fn(),
  mockRedactEnvForLogs: vi.fn(),
  mockRunChildProcess: vi.fn(),
}));

vi.mock("../adapters/utils.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/utils.js")>("../adapters/utils.js");
  return {
    ...actual,
    buildSquadrailEnv: mockBuildSquadrailEnv,
    redactEnvForLogs: mockRedactEnvForLogs,
    runChildProcess: mockRunChildProcess,
  };
});

import { execute as executeHttp } from "../adapters/http/execute.js";
import { execute as executeProcess } from "../adapters/process/execute.js";

describe("adapter execute modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildSquadrailEnv.mockReturnValue({ SQUADRAIL_AGENT_ID: "agent-1" });
    mockRedactEnvForLogs.mockImplementation((env: Record<string, string>) => ({
      ...env,
      TOKEN: "***REDACTED***",
    }));
  });

  it("executes HTTP adapters with merged headers and payload template", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeHttp({
      runId: "run-1",
      agent: { id: "agent-1" } as never,
      context: { issueId: "issue-1" } as never,
      config: {
        url: "https://hook.example.com/invoke",
        method: "PATCH",
        timeoutMs: 250,
        headers: { Authorization: "Bearer token" },
        payloadTemplate: { source: "squadrail" },
      },
    } as never);

    expect(result).toEqual({
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: "HTTP PATCH https://hook.example.com/invoke",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hook.example.com/invoke",
      expect.objectContaining({
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer token",
        },
        body: JSON.stringify({
          source: "squadrail",
          agentId: "agent-1",
          runId: "run-1",
          context: { issueId: "issue-1" },
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("raises an HTTP adapter error for non-ok responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502 }));

    await expect(executeHttp({
      runId: "run-1",
      agent: { id: "agent-1" } as never,
      context: {} as never,
      config: {
        url: "https://hook.example.com/invoke",
      },
    } as never)).rejects.toThrow("HTTP invoke failed with status 502");
  });

  it("executes process adapters with redacted metadata and successful output", async () => {
    const onMeta = vi.fn();
    mockRunChildProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "done",
      stderr: "",
    });

    const result = await executeProcess({
      runId: "run-2",
      agent: { id: "agent-1" } as never,
      config: {
        command: "node",
        args: ["script.mjs"],
        cwd: "/workspace/project",
        env: { TOKEN: "secret-token", MODE: "prod" },
        timeoutSec: 30,
        graceSec: 10,
      },
      onLog: vi.fn(),
      onMeta,
    } as never);

    expect(result).toEqual({
      exitCode: 0,
      signal: null,
      timedOut: false,
      resultJson: {
        stdout: "done",
        stderr: "",
      },
    });
    expect(onMeta).toHaveBeenCalledWith({
      adapterType: "process",
      command: "node",
      cwd: "/workspace/project",
      commandArgs: ["script.mjs"],
      env: {
        SQUADRAIL_AGENT_ID: "agent-1",
        TOKEN: "***REDACTED***",
        MODE: "prod",
      },
    });
    expect(mockRunChildProcess).toHaveBeenCalledWith(
      "run-2",
      "node",
      ["script.mjs"],
      expect.objectContaining({
        cwd: "/workspace/project",
        env: {
          SQUADRAIL_AGENT_ID: "agent-1",
          TOKEN: "secret-token",
          MODE: "prod",
        },
        timeoutSec: 30,
        graceSec: 10,
      }),
    );
  });

  it("returns structured timeout and failure payloads for process adapters", async () => {
    mockRunChildProcess.mockResolvedValueOnce({
      exitCode: null,
      signal: "SIGTERM",
      timedOut: true,
      stdout: "",
      stderr: "timeout",
    });
    mockRunChildProcess.mockResolvedValueOnce({
      exitCode: 3,
      signal: null,
      timedOut: false,
      stdout: "partial",
      stderr: "boom",
    });

    const timedOut = await executeProcess({
      runId: "run-timeout",
      agent: { id: "agent-1" } as never,
      config: { command: "node", timeoutSec: 12 },
    } as never);
    const failed = await executeProcess({
      runId: "run-fail",
      agent: { id: "agent-1" } as never,
      config: { command: "node" },
    } as never);

    expect(timedOut).toEqual({
      exitCode: null,
      signal: "SIGTERM",
      timedOut: true,
      errorMessage: "Timed out after 12s",
    });
    expect(failed).toEqual({
      exitCode: 3,
      signal: null,
      timedOut: false,
      errorMessage: "Process exited with code 3",
      resultJson: {
        stdout: "partial",
        stderr: "boom",
      },
    });
  });
});
