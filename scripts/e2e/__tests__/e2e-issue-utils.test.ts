import { describe, expect, it } from "vitest";
import {
  buildE2eLabelSpecs,
  collectTaggedIssues,
  needsE2eCancellation,
  shouldHideE2eIssue,
} from "../e2e-issue-utils.mjs";

describe("e2e issue utils", () => {
  it("builds the default real-org label set", () => {
    const specs = buildE2eLabelSpecs();
    expect(specs.map((entry) => entry.name)).toEqual([
      "ops:e2e",
      "ops:e2e:real-org",
    ]);
  });

  it("adds the nightly label when requested", () => {
    const specs = buildE2eLabelSpecs({ nightly: true });
    expect(specs.map((entry) => entry.name)).toContain("ops:e2e:nightly");
  });

  it("classifies active and terminal E2E issue states", () => {
    expect(needsE2eCancellation("backlog")).toBe(true);
    expect(needsE2eCancellation("in_review")).toBe(true);
    expect(needsE2eCancellation("done")).toBe(false);
    expect(shouldHideE2eIssue("done")).toBe(true);
    expect(shouldHideE2eIssue("cancelled")).toBe(true);
    expect(shouldHideE2eIssue("blocked")).toBe(false);
  });

  it("collects issues that match any tagged label", () => {
    const issues = [
      { id: "a", labelIds: ["x", "y"] },
      { id: "b", labelIds: ["z"] },
      { id: "c", labelIds: [] },
    ];

    expect(collectTaggedIssues(issues, ["y", "q"]).map((issue) => issue.id)).toEqual(["a"]);
  });
});
