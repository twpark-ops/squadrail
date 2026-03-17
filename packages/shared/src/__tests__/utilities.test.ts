import { describe, expect, it } from "vitest";
import { normalizeAgentUrlKey, isUuidLike } from "../agent-url-key.js";
import { isKnowledgeSummarySourceType } from "../knowledge-source-types.js";
import { buildDefaultTeamBlueprintPreviewRequest } from "../team-blueprint-parameters.js";
import type { TeamBlueprintParameterHints } from "../types/team-blueprint.js";

// ---------------------------------------------------------------------------
// agent-url-key utilities
// ---------------------------------------------------------------------------

describe("normalizeAgentUrlKey", () => {
  it("lowercases and strips special chars", () => {
    expect(normalizeAgentUrlKey("Hello World!")).toBe("hello-world");
    expect(normalizeAgentUrlKey("  FOO--BAR__BAZ  ")).toBe("foo-bar-baz");
    expect(normalizeAgentUrlKey("@#$%")).toBeNull();
  });
});

describe("isUuidLike", () => {
  it("accepts valid UUID", () => {
    expect(isUuidLike("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("rejects non-UUID string", () => {
    expect(isUuidLike("not-a-uuid")).toBe(false);
    expect(isUuidLike("")).toBe(false);
    expect(isUuidLike(null)).toBe(false);
    expect(isUuidLike(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// knowledge-source-types utilities
// ---------------------------------------------------------------------------

describe("isKnowledgeSummarySourceType", () => {
  it("returns true for code_summary", () => {
    expect(isKnowledgeSummarySourceType("code_summary")).toBe(true);
  });

  it("returns false for code", () => {
    expect(isKnowledgeSummarySourceType("code")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// team-blueprint-parameters utilities
// ---------------------------------------------------------------------------

describe("buildDefaultTeamBlueprintPreviewRequest", () => {
  it("returns valid request", () => {
    const hints: TeamBlueprintParameterHints = {
      supportsPm: true,
      supportsQa: true,
      supportsCto: false,
      defaultProjectCount: 2,
      defaultEngineerPairsPerProject: 1,
    };

    const result = buildDefaultTeamBlueprintPreviewRequest(hints);

    expect(result.projectCount).toBe(2);
    expect(result.engineerPairsPerProject).toBe(1);
    expect(result.includePm).toBe(true);
    expect(result.includeQa).toBe(true);
    expect(result.includeCto).toBe(false);
  });
});
