import { describe, expect, it } from "vitest";
import { detectMergePrBridgeRemote } from "../services/merge-pr-bridge.js";

describe("merge PR bridge remote detection", () => {
  it("parses GitHub HTTPS remotes", () => {
    const remote = detectMergePrBridgeRemote("https://github.com/acme/swiftsight.git");

    expect(remote).toEqual(
      expect.objectContaining({
        provider: "github",
        repoOwner: "acme",
        repoName: "swiftsight",
        repoPath: "acme/swiftsight",
        repoUrl: "https://github.com/acme/swiftsight",
      }),
    );
  });

  it("parses GitLab SSH remotes with nested groups", () => {
    const remote = detectMergePrBridgeRemote("git@gitlab.example.com:platform/backend/swiftsight.git");

    expect(remote).toEqual(
      expect.objectContaining({
        provider: "gitlab",
        repoOwner: "platform/backend",
        repoName: "swiftsight",
        repoPath: "platform/backend/swiftsight",
        repoUrl: "https://gitlab.example.com/platform/backend/swiftsight",
      }),
    );
  });

  it("returns null for unsupported remotes", () => {
    expect(detectMergePrBridgeRemote("https://bitbucket.org/acme/swiftsight.git")).toBeNull();
  });
});
