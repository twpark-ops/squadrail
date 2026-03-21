import { describe, expect, it } from "vitest";
import { shouldDelayFallbackForFreshRun } from "../active-run-fallback-grace.mjs";

describe("shouldDelayFallbackForFreshRun", () => {
  it("returns true when the active run is younger than the configured grace", () => {
    expect(shouldDelayFallbackForFreshRun({
      startedAt: "2026-03-21T04:09:37.986Z",
      now: Date.parse("2026-03-21T04:09:38.200Z"),
      minAgeMs: 12_000,
    })).toBe(true);
  });

  it("returns false when the active run has already aged past the grace", () => {
    expect(shouldDelayFallbackForFreshRun({
      startedAt: "2026-03-21T04:09:37.986Z",
      now: Date.parse("2026-03-21T04:09:55.500Z"),
      minAgeMs: 12_000,
    })).toBe(false);
  });

  it("returns false when startedAt is missing", () => {
    expect(shouldDelayFallbackForFreshRun({
      startedAt: null,
      now: Date.parse("2026-03-21T04:09:38.200Z"),
      minAgeMs: 12_000,
    })).toBe(false);
  });
});
