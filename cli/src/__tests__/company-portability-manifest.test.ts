import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseInclude,
  PRIMARY_PORTABILITY_MANIFEST_NAME,
  resolvePortabilityManifestPath,
} from "../commands/client/company.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("resolvePortabilityManifestPath", () => {
  it("parses company portability include sets with projects", () => {
    expect(parseInclude(undefined)).toEqual({
      company: true,
      projects: true,
      agents: true,
    });

    expect(parseInclude("projects,agents")).toEqual({
      company: false,
      projects: true,
      agents: true,
    });
  });

  it("loads squadrail.manifest.json for directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-portability-"));
    tempDirs.push(root);
    const primaryPath = path.join(root, PRIMARY_PORTABILITY_MANIFEST_NAME);
    await fs.writeFile(primaryPath, "{}", "utf8");

    const resolved = await resolvePortabilityManifestPath(root, true);
    expect(resolved).toBe(primaryPath);
  });
});
