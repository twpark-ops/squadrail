import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeLocalInstancePaths,
  expandHomePrefix,
  resolveSquadrailHomeDir,
  resolveSquadrailInstanceId,
} from "../config/home.js";

const ORIGINAL_ENV = { ...process.env };

describe("home path resolution", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("defaults to ~/.squadrail when no legacy home exists", () => {
    delete process.env.SQUADRAIL_HOME;
    delete process.env.SQUADRAIL_INSTANCE_ID;

    const paths = describeLocalInstancePaths();
    expect(paths.homeDir).toBe(path.resolve(os.homedir(), ".squadrail"));
    expect(paths.instanceId).toBe("default");
    expect(paths.configPath).toBe(path.resolve(os.homedir(), ".squadrail", "instances", "default", "config.json"));
  });

  it("supports SQUADRAIL_HOME and explicit instance ids", () => {
    process.env.SQUADRAIL_HOME = "~/squadrail-home";

    const home = resolveSquadrailHomeDir();
    expect(home).toBe(path.resolve(os.homedir(), "squadrail-home"));
    expect(resolveSquadrailInstanceId("dev_1")).toBe("dev_1");
  });

  it("uses Squadrail env keys for explicit overrides", () => {
    process.env.SQUADRAIL_HOME = "~/squadrail-home";
    process.env.SQUADRAIL_INSTANCE_ID = "squad_dev";

    expect(resolveSquadrailHomeDir()).toBe(path.resolve(os.homedir(), "squadrail-home"));
    expect(resolveSquadrailInstanceId()).toBe("squad_dev");
  });

  it("rejects invalid instance ids", () => {
    expect(() => resolveSquadrailInstanceId("bad/id")).toThrow(/Invalid instance id/);
  });

  it("expands ~ prefixes", () => {
    expect(expandHomePrefix("~")).toBe(os.homedir());
    expect(expandHomePrefix("~/x/y")).toBe(path.resolve(os.homedir(), "x/y"));
  });
});
