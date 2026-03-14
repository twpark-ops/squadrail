import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { ensureCodexSkillsInjected } from "@squadrail/adapter-codex-local/server";

const require = createRequire(import.meta.url);

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function resolveAdapterSkillPath(skillName: string): Promise<string> {
  const adapterServerEntry = require.resolve("@squadrail/adapter-codex-local/server");
  const adapterModuleDir = path.dirname(adapterServerEntry);
  const candidateRoots = [
    path.resolve(adapterModuleDir, "../../skills"),
    path.resolve(adapterModuleDir, "../../../../../skills"),
  ];

  for (const candidateRoot of candidateRoots) {
    const isDirectory = await fs.stat(candidateRoot).then((stat) => stat.isDirectory()).catch(() => false);
    if (isDirectory) return path.join(candidateRoot, skillName);
  }

  throw new Error(`Failed to resolve Squadrail skill directory for "${skillName}"`);
}

async function createCustomSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "custom", skillName), { recursive: true });
  await fs.writeFile(
    path.join(root, "custom", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

describe("codex local adapter skill injection", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("repairs a Codex Squadrail skill symlink that still points at another live checkout", async () => {
    const oldRepo = await makeTempDir("squadrail-codex-old-");
    const codexHome = await makeTempDir("squadrail-codex-home-");
    const skillsHome = path.join(codexHome, "skills");
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(codexHome);

    const currentSkill = await resolveAdapterSkillPath("squadrail");
    await fs.mkdir(skillsHome, { recursive: true });
    await fs.mkdir(path.join(oldRepo, "server"), { recursive: true });
    await fs.mkdir(path.join(oldRepo, "packages", "adapter-utils"), { recursive: true });
    await fs.mkdir(path.join(oldRepo, "skills", "squadrail"), { recursive: true });
    await fs.writeFile(path.join(oldRepo, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
    await fs.writeFile(path.join(oldRepo, "package.json"), '{"name":"squadrail"}\n', "utf8");
    await fs.writeFile(path.join(oldRepo, "skills", "squadrail", "SKILL.md"), "---\nname: squadrail\n---\n", "utf8");
    await fs.symlink(path.join(oldRepo, "skills", "squadrail"), path.join(skillsHome, "squadrail"));

    const previousCodeHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    try {
      const logs: string[] = [];
      await ensureCodexSkillsInjected(async (_stream, chunk) => {
        logs.push(chunk);
      });

      expect(await fs.realpath(path.join(skillsHome, "squadrail"))).toBe(
        await fs.realpath(currentSkill),
      );
      expect(logs.some((line) => line.includes('Repaired Codex skill "squadrail"'))).toBe(true);
    } finally {
      if (previousCodeHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodeHome;
    }
  });

  it("preserves a custom Codex skill symlink outside Squadrail repo checkouts", async () => {
    const customRoot = await makeTempDir("squadrail-codex-custom-");
    const codexHome = await makeTempDir("squadrail-codex-home-");
    const skillsHome = path.join(codexHome, "skills");
    cleanupDirs.add(customRoot);
    cleanupDirs.add(codexHome);

    await fs.mkdir(skillsHome, { recursive: true });
    await createCustomSkill(customRoot, "squadrail");
    await fs.symlink(path.join(customRoot, "custom", "squadrail"), path.join(skillsHome, "squadrail"));

    const previousCodeHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    try {
      await ensureCodexSkillsInjected(async () => {});

      expect(await fs.realpath(path.join(skillsHome, "squadrail"))).toBe(
        await fs.realpath(path.join(customRoot, "custom", "squadrail")),
      );
    } finally {
      if (previousCodeHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodeHome;
    }
  });
});
