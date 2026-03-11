import { describe, expect, it } from "vitest";
import { resolveTimeoutRulesForState } from "../services/issue-protocol-timeouts.js";

describe("issue protocol timeout rules", () => {
  it("registers a dedicated blocked resolution timeout rule", () => {
    const rules = resolveTimeoutRulesForState("blocked");

    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      timeoutCode: "blocked_resolution_timeout",
      reminderRole: "tech_lead",
      escalationRole: "human_board",
    });
  });

  it("does not mix blocked timeout rules into implementing state", () => {
    const rules = resolveTimeoutRulesForState("implementing");

    expect(rules.some((rule) => rule.timeoutCode === "blocked_resolution_timeout")).toBe(false);
    expect(rules.some((rule) => rule.timeoutCode === "progress_stale")).toBe(true);
  });
});
