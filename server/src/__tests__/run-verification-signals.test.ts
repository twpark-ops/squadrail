import { describe, expect, it } from "vitest";
import { extractRunVerificationSignals } from "../services/run-verification-signals.js";

describe("extractRunVerificationSignals", () => {
  it("extracts unique test and build commands from run outputs", () => {
    const signals = extractRunVerificationSignals({
      stdoutExcerpt: "Running pnpm test:run\nRunning pnpm build\nRunning pnpm test:run",
      stderrExcerpt: "pytest tests/unit/test_api.py",
      resultJson: {
        commandExecutions: [
          { command: "pnpm test:run", status: "completed", exitCode: 0 },
          { command: "pnpm build", status: "failed", exitCode: 1 },
        ],
        stdout: "vite build",
      },
    });

    expect(signals).toEqual([
      {
        kind: "test",
        command: "pnpm test:run",
        source: "command_execution",
        confidence: "structured",
        status: "passed",
        exitCode: 0,
      },
      {
        kind: "build",
        command: "pnpm build",
        source: "command_execution",
        confidence: "structured",
        status: "failed",
        exitCode: 1,
      },
      {
        kind: "test",
        command: "pytest tests/unit/test_api.py",
        source: "stderr_excerpt",
        confidence: "heuristic",
        status: "unknown",
        exitCode: null,
      },
      {
        kind: "build",
        command: "vite build",
        source: "result_json",
        confidence: "heuristic",
        status: "unknown",
        exitCode: null,
      },
    ]);
  });

  it("extracts structured signals from active run live logs", () => {
    const signals = extractRunVerificationSignals({
      logContent: [
        JSON.stringify({
          ts: "2026-03-10T00:00:00.000Z",
          stream: "stdout",
          chunk: `${JSON.stringify({
            type: "item.completed",
            item: {
              type: "command_execution",
              command: "/usr/bin/zsh -lc 'pnpm test'",
              exit_code: 0,
              status: "completed",
            },
          })}\n${JSON.stringify({
            type: "item.completed",
            item: {
              type: "command_execution",
              command: "/usr/bin/zsh -lc 'pnpm build'",
              exit_code: 0,
              status: "completed",
            },
          })}`,
        }),
      ].join("\n"),
    });

    expect(signals).toEqual([
      {
        kind: "test",
        command: "/usr/bin/zsh -lc 'pnpm test'",
        source: "command_execution",
        confidence: "structured",
        status: "passed",
        exitCode: 0,
      },
      {
        kind: "build",
        command: "/usr/bin/zsh -lc 'pnpm build'",
        source: "command_execution",
        confidence: "structured",
        status: "passed",
        exitCode: 0,
      },
    ]);
  });
});
