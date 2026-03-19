import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { findCloseWakeEvidence, resolveCloseWakeRoots } from "../close-wake-evidence.mjs";

const tempRoots = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "close-wake-evidence-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("close wake evidence", () => {
  it("checks both legacy and current codex home roots", async () => {
    const root = await createTempRoot();
    expect(resolveCloseWakeRoots(root)).toEqual([
      path.join(root, "instances"),
      path.join(root, "home", "instances"),
    ]);
  });

  it("finds close wake evidence in the current home/instances layout", async () => {
    const root = await createTempRoot();
    const sessionDir = path.join(root, "home", "instances", "default", "codex-homes", "agent-1", "sessions");
    await mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, "close.jsonl");
    await writeFile(
      filePath,
      [
        'Structured wake context:',
        '- issueId: issue-123',
        '- wakeReason: issue_ready_for_closure',
      ].join("\n"),
    );

    await expect(findCloseWakeEvidence(root, "issue-123")).resolves.toEqual({
      matched: true,
      path: filePath,
    });
  });

  it("ignores instruction text that mentions close wake reason without an actual wake context", async () => {
    const root = await createTempRoot();
    const sessionDir = path.join(root, "home", "instances", "default", "codex-homes", "agent-1", "sessions");
    await mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, "ack.jsonl");
    await writeFile(
      filePath,
      [
        "# Delivery Fixture Tech Lead",
        "- If `SQUADRAIL_WAKE_REASON` is not `issue_ready_for_closure`, do not inspect files or helper internals. Exit quietly.",
        "Structured wake context:",
        "- issueId: issue-123",
        "- wakeReason: issue_supervisor_assignment_acknowledged",
      ].join("\n"),
    );

    await expect(findCloseWakeEvidence(root, "issue-123")).resolves.toEqual({
      matched: false,
      path: null,
    });
  });
});
