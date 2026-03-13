import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLoggerWarn,
  mockSharedRunChildProcess,
} = vi.hoisted(() => ({
  mockLoggerWarn: vi.fn(),
  mockSharedRunChildProcess: vi.fn(),
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    warn: mockLoggerWarn,
  },
}));

vi.mock("@squadrail/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@squadrail/adapter-utils/server-utils")>("@squadrail/adapter-utils/server-utils");
  return {
    ...actual,
    runChildProcess: mockSharedRunChildProcess,
  };
});

import { runChildProcess } from "../adapters/utils.js";

describe("adapter utils wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through child process execution and wires logger-backed onLogError", async () => {
    mockSharedRunChildProcess.mockImplementation(
      async (_runId: string, _command: string, _args: string[], opts: { onLogError: (err: Error, id: string, msg: string) => void }) => {
        opts.onLogError(new Error("write failed"), "run-1", "log write failed");
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          stdout: "ok",
          stderr: "",
        };
      },
    );

    const result = await runChildProcess("run-1", "node", ["script.mjs"], {
      cwd: "/workspace/project",
      env: { PATH: "/usr/bin" },
      timeoutSec: 30,
      graceSec: 10,
      onLog: vi.fn(),
    });

    expect(result).toEqual({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "ok",
      stderr: "",
    });
    expect(mockSharedRunChildProcess).toHaveBeenCalledWith(
      "run-1",
      "node",
      ["script.mjs"],
      expect.objectContaining({
        cwd: "/workspace/project",
        env: { PATH: "/usr/bin" },
        timeoutSec: 30,
        graceSec: 10,
        onLog: expect.any(Function),
        onLogError: expect.any(Function),
      }),
    );
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      { err: expect.any(Error), runId: "run-1" },
      "log write failed",
    );
  });
});
