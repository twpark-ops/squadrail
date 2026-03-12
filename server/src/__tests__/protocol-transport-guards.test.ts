import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatProtocolHelperCommand,
  resolveProtocolHelperPath,
  SQUADRAIL_PROTOCOL_HELPER_ENV_VAR,
  withProtocolTransportGuards,
} from "@squadrail/adapter-utils/server-utils";

describe("protocol transport guard wrappers", () => {
  it("blocks direct python protocol posts while allowing normal python usage", async () => {
    const helperPath = await resolveProtocolHelperPath();
    const env = await withProtocolTransportGuards({
      ...process.env,
      PATH: process.env.PATH ?? "",
      SQUADRAIL_TASK_ID: "issue-123",
    } as Record<string, string>);
    const guardPython = path.join((env.PATH ?? "").split(":")[0] ?? "", "python3");
    expect(env[SQUADRAIL_PROTOCOL_HELPER_ENV_VAR]).toBe(helperPath);
    expect(env[SQUADRAIL_PROTOCOL_HELPER_ENV_VAR]).toMatch(/scripts[\\/]runtime[\\/]squadrail-protocol\.mjs$/);
    expect(existsSync(env[SQUADRAIL_PROTOCOL_HELPER_ENV_VAR] ?? "")).toBe(true);

    const safe = execFileSync(guardPython, ["-"], {
      env,
      input: "print('safe-python')\n",
      encoding: "utf8",
    });
    expect(safe.trim()).toBe("safe-python");

    try {
      execFileSync(guardPython, ["-"], {
        env,
        input: "import urllib.request\nprint('/api/issues/issue-123/protocol/messages')\n",
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      expect.unreachable("direct protocol POST should be blocked");
    } catch (error) {
      const stderr = error instanceof Error && "stderr" in error
        ? String((error as { stderr?: string | Buffer }).stderr ?? "")
        : "";
      const message = error instanceof Error ? error.message : "";
      const combined = `${message}\n${stderr}`;
      const status = typeof error === "object" && error !== null && "status" in error
        ? (error as { status?: number }).status
        : undefined;
      expect(status).toBe(97);
      expect(combined).toContain("Direct protocol HTTP via python is blocked");
      expect(combined).toContain("squadrail-protocol.mjs");
    }
  });

  it("renders helper commands through the helper env var instead of an absolute repo path", () => {
    expect(formatProtocolHelperCommand("request-changes")).toBe(
      'node "$SQUADRAIL_PROTOCOL_HELPER_PATH" request-changes --issue "$SQUADRAIL_TASK_ID" ...',
    );
    expect(formatProtocolHelperCommand("request-changes")).not.toContain("/home/taewoong/");
  });
});
