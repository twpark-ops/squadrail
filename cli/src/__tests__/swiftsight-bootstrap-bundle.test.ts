import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const tempDirs: string[] = [];
const scriptPath = fileURLToPath(
  new URL("../../../scripts/bootstrap/generate-swiftsight-org-bundle.mjs", import.meta.url),
);

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("generate-swiftsight-org-bundle", () => {
  it("creates an import-ready SwiftSight org bundle", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "swiftsight-root-"));
    const out = await fs.mkdtemp(path.join(os.tmpdir(), "swiftsight-bundle-"));
    tempDirs.push(root, out);

    for (const repoName of [
      "swiftsight-cloud",
      "swiftsight-agent",
      "swiftcl",
      "swiftsight-report-server",
      "swiftsight-worker",
    ]) {
      await fs.mkdir(path.join(root, repoName), { recursive: true });
    }

    await execFile(process.execPath, [
      scriptPath,
      "--root",
      root,
      "--out",
      out,
      "--company-name",
      "cloud-swiftsight",
    ]);

    const manifest = JSON.parse(
      await fs.readFile(path.join(out, "squadrail.manifest.json"), "utf8"),
    ) as {
      projects: Array<{
        slug: string;
        workspaces: Array<{
          name: string;
          executionPolicy?: {
            mode: string;
            isolationStrategy: string | null;
          } | null;
        }>;
      }>;
      agents: Array<{
        slug: string;
        adapterType: string;
        title: string;
      }>;
      source: null;
    };

    expect(manifest.source).toBeNull();
    expect(manifest.projects).toHaveLength(5);
    expect(manifest.agents).toHaveLength(18);
    expect(manifest.agents.filter((agent) => agent.title === "Engineer")).toHaveLength(10);
    expect(manifest.agents.filter((agent) => agent.title === "Tech Lead")).toHaveLength(4);
    expect(
      manifest.agents
        .filter((agent) => agent.title === "Engineer")
        .map((agent) => agent.adapterType),
    ).toEqual(
      expect.arrayContaining([
        "claude_local",
        "codex_local",
      ]),
    );
    expect(manifest.agents.some((agent) => agent.slug === "swiftsight-cloud-engineer-claude")).toBe(true);
    expect(manifest.agents.some((agent) => agent.slug === "swiftsight-worker-engineer-codex")).toBe(true);

    const cloudProject = manifest.projects.find((project) => project.slug === "swiftsight-cloud");
    expect(cloudProject?.workspaces.find((workspace) => workspace.name === "implementation")?.executionPolicy).toMatchObject({
      mode: "isolated",
      isolationStrategy: "worktree",
    });

    const workerProject = manifest.projects.find((project) => project.slug === "swiftsight-worker");
    expect(workerProject?.workspaces.find((workspace) => workspace.name === "implementation")?.executionPolicy).toMatchObject({
      mode: "isolated",
      isolationStrategy: "clone",
    });

    await expect(fs.readFile(path.join(out, "README.md"), "utf8")).resolves.toContain("## Import");
    await expect(
      fs.readFile(path.join(out, "agents/swiftsight-cto/AGENTS.md"), "utf8"),
    ).resolves.toContain("Primary project: cross-project");
    await expect(
      fs.readFile(path.join(out, "agents/swiftsight-cto/AGENTS.md"), "utf8"),
    ).resolves.toContain("/scripts/runtime/squadrail-protocol.mjs");
    await expect(
      fs.readFile(path.join(out, "agents/swiftsight-cto/AGENTS.md"), "utf8"),
    ).resolves.toContain("get-brief --scope");
  });
});
