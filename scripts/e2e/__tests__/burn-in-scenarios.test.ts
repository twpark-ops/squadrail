import { describe, expect, it } from "vitest";
import { BURN_IN_BATCH_SCENARIOS, parseScenarioSelection } from "../burn-in-scenarios.mjs";

describe("burn-in scenario selection", () => {
  it("expands named burn-in batches into scenario keys", () => {
    expect(parseScenarioSelection("batch1")).toEqual(BURN_IN_BATCH_SCENARIOS.batch1);
  });

  it("parses comma-separated scenario keys", () => {
    expect(parseScenarioSelection("alpha, beta ,gamma")).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns an empty selection when no filter is provided", () => {
    expect(parseScenarioSelection("")).toEqual([]);
    expect(parseScenarioSelection(undefined)).toEqual([]);
  });
});
