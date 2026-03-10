import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { withProtocolTransportGuards } from "@squadrail/adapter-utils/server-utils";

describe("protocol transport guard wrappers", () => {
  it("blocks direct python protocol posts while allowing normal python usage", async () => {
    const env = await withProtocolTransportGuards({
      ...process.env,
      PATH: process.env.PATH ?? "",
      SQUADRAIL_TASK_ID: "issue-123",
    } as Record<string, string>);

    const safe = execFileSync("python3", ["-"], {
      env,
      input: "print('safe-python')\n",
      encoding: "utf8",
    });
    expect(safe.trim()).toBe("safe-python");

    try {
      execFileSync("python3", ["-"], {
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
      expect(stderr).toContain("Direct protocol HTTP via python is blocked");
      expect(stderr).toContain("squadrail-protocol.mjs");
    }
  });
});
