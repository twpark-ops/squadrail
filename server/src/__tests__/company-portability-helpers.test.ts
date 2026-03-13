import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMarkdown,
  dedupeRequiredSecrets,
  ensureMarkdownPath,
  normalizeInclude,
  normalizePortableConfig,
  normalizePortableEnv,
  parseFrontmatterMarkdown,
  parseGitHubTreeUrl,
  pruneDefaultLikeValue,
  readAgentInstructions,
  renderCompanyAgentsSection,
  resolveRawGitHubUrl,
  uniqueNameBySlug,
  uniqueProjectNameBySlug,
} from "../services/company-portability.js";

describe("company portability helpers", () => {
  const tempRoots: string[] = [];
  const originalWorkspaceCwd = process.env.SQUADRAIL_WORKSPACE_CWD;

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
    if (originalWorkspaceCwd === undefined) delete process.env.SQUADRAIL_WORKSPACE_CWD;
    else process.env.SQUADRAIL_WORKSPACE_CWD = originalWorkspaceCwd;
  });

  it("normalizes include flags and rejects non-markdown manifest paths", () => {
    expect(normalizeInclude()).toEqual({
      company: true,
      projects: true,
      agents: true,
    });
    expect(normalizeInclude({ agents: false })).toEqual({
      company: true,
      projects: true,
      agents: false,
    });
    expect(ensureMarkdownPath("docs/manifest.md")).toBe("docs/manifest.md");
    expect(() => ensureMarkdownPath("docs/manifest.txt")).toThrow("Manifest file path must end in .md");
  });

  it("redacts sensitive env bindings and strips non-portable config fields", () => {
    const requiredSecrets: Array<{ key: string; description: string; agentSlug: string | null; providerHint: string | null }> = [];

    const env = normalizePortableEnv("eng-1", {
      OPENAI_API_KEY: { type: "secret_ref", secretId: "secret-1" },
      LOG_LEVEL: { type: "plain", value: "debug" },
    }, requiredSecrets);
    const config = normalizePortableConfig({
      cwd: "/tmp/repo",
      instructionsFilePath: "ROLE.md",
      env: {
        OPENAI_API_KEY: { type: "secret_ref", secretId: "secret-1" },
        LOG_LEVEL: { type: "plain", value: "debug" },
      },
      timeoutSec: 30,
    }, "eng-1", requiredSecrets);

    expect(env).toEqual({
      LOG_LEVEL: { type: "plain", value: "debug" },
    });
    expect(config).toEqual({
      env: {
        LOG_LEVEL: { type: "plain", value: "debug" },
      },
      timeoutSec: 30,
    });
    expect(requiredSecrets).toEqual([
      {
        key: "OPENAI_API_KEY",
        description: "Set OPENAI_API_KEY for agent eng-1",
        agentSlug: "eng-1",
        providerHint: null,
      },
      {
        key: "OPENAI_API_KEY",
        description: "Set OPENAI_API_KEY for agent eng-1",
        agentSlug: "eng-1",
        providerHint: null,
      },
    ]);
  });

  it("prunes default-like values and false booleans from nested structures", () => {
    const pruned = pruneDefaultLikeValue({
      heartbeat: {
        cooldownSec: 10,
        wakeOnDemand: true,
        wakeOnAssignment: false,
      },
      timeoutSec: 0,
      featureFlag: false,
      notes: "keep me",
    }, {
      dropFalseBooleans: true,
      defaultRules: [
        { path: ["heartbeat", "cooldownSec"], value: 10 },
        { path: ["timeoutSec"], value: 0 },
      ],
    });

    expect(pruned).toEqual({
      heartbeat: {
        wakeOnDemand: true,
      },
      notes: "keep me",
    });
  });

  it("round-trips markdown frontmatter and dedupes required secret rows", () => {
    const markdown = buildMarkdown({
      slug: "release-captain",
      enabled: true,
      retries: 3,
    }, "# Role\n\nLead the release.");

    expect(markdown).toContain("---");
    expect(parseFrontmatterMarkdown(markdown)).toEqual({
      frontmatter: {
        slug: "release-captain",
        enabled: true,
        retries: 3,
      },
      body: "# Role\n\nLead the release.",
    });
    expect(dedupeRequiredSecrets([
      { key: "OPENAI_API_KEY", description: "a", agentSlug: "eng", providerHint: null },
      { key: "openai_api_key", description: "b", agentSlug: "eng", providerHint: null },
      { key: "OPENAI_API_KEY", description: "c", agentSlug: "qa", providerHint: null },
    ])).toEqual([
      { key: "OPENAI_API_KEY", description: "a", agentSlug: "eng", providerHint: null },
      { key: "OPENAI_API_KEY", description: "c", agentSlug: "qa", providerHint: null },
    ]);
  });

  it("parses GitHub tree URLs and resolves raw file URLs", () => {
    expect(parseGitHubTreeUrl("https://github.com/acme/squadrail/tree/main/docs/export")).toEqual({
      owner: "acme",
      repo: "squadrail",
      ref: "main",
      basePath: "docs/export",
    });
    expect(resolveRawGitHubUrl("acme", "squadrail", "main", "/docs/export.md")).toBe(
      "https://raw.githubusercontent.com/acme/squadrail/main/docs/export.md",
    );
  });

  it("derives unique agent and project names from slug collisions", () => {
    expect(uniqueNameBySlug("Release Captain", new Set(["release-captain"]))).toBe("Release Captain 2");
    expect(uniqueProjectNameBySlug("Runtime", new Set(["runtime"]))).toBe("Runtime 2");
  });

  it("renders company agent sections and gracefully handles markdown without valid frontmatter", () => {
    expect(renderCompanyAgentsSection([])).toContain("- _none_");
    expect(renderCompanyAgentsSection([{ slug: "release-captain", name: "Release Captain" }])).toContain(
      "- release-captain - Release Captain",
    );
    expect(parseFrontmatterMarkdown("---\nmissing closing fence")).toEqual({
      frontmatter: {},
      body: "---\nmissing closing fence",
    });
    expect(() => parseGitHubTreeUrl("https://gitlab.com/acme/squadrail")).toThrow("github.com");
  });

  it("resolves agent instructions from workspace files, prompt fallbacks, and placeholders", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "company-portability-"));
    tempRoots.push(workspaceRoot);
    process.env.SQUADRAIL_WORKSPACE_CWD = workspaceRoot;
    await writeFile(path.join(workspaceRoot, "AGENTS.md"), "# Agent Guide\n\nUse the helper.\n", "utf8");

    await expect(readAgentInstructions({
      name: "Release Captain",
      adapterConfig: {
        instructionsFilePath: "AGENTS.md",
      },
    } as never)).resolves.toEqual({
      body: "# Agent Guide\n\nUse the helper.\n",
      warning: null,
    });

    await expect(readAgentInstructions({
      name: "Release Captain",
      adapterConfig: {
        instructionsFilePath: "missing.md",
        promptTemplate: "# Prompt fallback",
      },
    } as never)).resolves.toEqual({
      body: "# Prompt fallback",
      warning: "Agent Release Captain instructionsFilePath was not readable; fell back to promptTemplate.",
    });

    await expect(readAgentInstructions({
      name: "Release Captain",
      adapterConfig: {},
    } as never)).resolves.toEqual({
      body: "_No AGENTS instructions were resolved from current agent config._",
      warning: "Agent Release Captain has no resolvable instructionsFilePath/promptTemplate; exported placeholder AGENTS.md.",
    });
  });
});
