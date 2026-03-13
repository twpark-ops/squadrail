import { describe, expect, it } from "vitest";
import { testEnvironment } from "../adapters/process/test.js";

describe("process adapter environment test", () => {
  it("fails when the command is missing", async () => {
    const result = await testEnvironment({
      adapterType: "process",
      config: {
        cwd: process.cwd(),
      },
    } as never);

    expect(result.status).toBe("fail");
    expect(result.checks.some((check) => check.code === "process_command_missing")).toBe(true);
    expect(result.checks.some((check) => check.code === "process_cwd_valid")).toBe(true);
  });

  it("passes when the command is resolvable and cwd is absolute", async () => {
    const result = await testEnvironment({
      adapterType: "process",
      config: {
        command: "node",
        cwd: process.cwd(),
      },
    } as never);

    expect(result.status).toBe("pass");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "process_command_present",
          level: "info",
        }),
        expect.objectContaining({
          code: "process_cwd_valid",
          level: "info",
        }),
        expect.objectContaining({
          code: "process_command_resolvable",
          level: "info",
        }),
      ]),
    );
  });

  it("reports invalid cwd and unresolvable commands", async () => {
    const result = await testEnvironment({
      adapterType: "process",
      config: {
        command: "definitely-not-a-real-command",
        cwd: "relative/path",
      },
    } as never);

    expect(result.status).toBe("fail");
    expect(result.checks.some((check) => check.code === "process_cwd_invalid")).toBe(true);
    expect(result.checks.some((check) => check.code === "process_command_unresolvable")).toBe(true);
  });
});
