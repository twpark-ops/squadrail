import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalRunLogBasePath = process.env.RUN_LOG_BASE_PATH;

afterEach(async () => {
  if (originalRunLogBasePath === undefined) {
    delete process.env.RUN_LOG_BASE_PATH;
  } else {
    process.env.RUN_LOG_BASE_PATH = originalRunLogBasePath;
  }
  vi.resetModules();
});

describe("run log store", () => {
  it("reads tail bytes from the end of the log when requested", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-run-log-store-"));
    process.env.RUN_LOG_BASE_PATH = tempDir;
    vi.resetModules();

    const { getRunLogStore } = await import("../services/run-log-store.js");
    const store = getRunLogStore();
    const handle = await store.begin({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "run-1",
    });

    await store.append(handle, {
      stream: "stdout",
      ts: "2026-03-10T00:00:00.000Z",
      chunk: "alpha-line",
    });
    await store.append(handle, {
      stream: "stdout",
      ts: "2026-03-10T00:00:01.000Z",
      chunk: "beta-line",
    });
    await store.append(handle, {
      stream: "stdout",
      ts: "2026-03-10T00:00:02.000Z",
      chunk: "gamma-line",
    });

    const headRead = await store.read(handle, { limitBytes: 128 });
    const tailRead = await store.read(handle, { limitBytes: 128, tailBytes: 128 });

    expect(headRead.content).toContain("alpha-line");
    expect(tailRead.content).toContain("gamma-line");
    expect(tailRead.content).not.toContain("alpha-line");

    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
