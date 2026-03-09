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
});
