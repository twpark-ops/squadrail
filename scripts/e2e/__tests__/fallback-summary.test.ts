import { describe, expect, it } from "vitest";
import {
  aggregateFallbackSummaries,
  createFallbackTracker,
  recordFallbackEvent,
  summarizeFallbackTracker,
} from "../fallback-summary.mjs";

describe("fallback summary helpers", () => {
  it("groups fallback events by family and reason", () => {
    const tracker = createFallbackTracker();
    recordFallbackEvent(tracker, { reason: "routing_reassign", workflowState: "assigned" });
    recordFallbackEvent(tracker, { reason: "reviewer_approval", workflowState: "under_review" });
    recordFallbackEvent(tracker, { reason: "close", workflowState: "approved" });

    expect(summarizeFallbackTracker(tracker)).toEqual({
      total: 3,
      familyCounts: {
        pm_routing: 1,
        staffing_and_wake: 0,
        review_handoff: 1,
        qa_gate: 0,
        closure: 1,
      },
      reasonCounts: {
        routing_reassign: 1,
        reviewer_approval: 1,
        close: 1,
      },
      events: [
        { family: "pm_routing", reason: "routing_reassign", workflowState: "assigned", note: null },
        { family: "review_handoff", reason: "reviewer_approval", workflowState: "under_review", note: null },
        { family: "closure", reason: "close", workflowState: "approved", note: null },
      ],
    });
  });

  it("aggregates scenario summaries", () => {
    const first = createFallbackTracker();
    recordFallbackEvent(first, { reason: "routing_reassign" });
    const second = createFallbackTracker();
    recordFallbackEvent(second, { reason: "qa_approval" });
    recordFallbackEvent(second, { reason: "implementation_start" });

    expect(aggregateFallbackSummaries([
      { scenario: "s1", identifier: "CLO-1", fallbackSummary: first },
      { scenario: "s2", identifier: "CLO-2", fallbackSummary: second },
    ])).toEqual({
      total: 3,
      familyCounts: {
        pm_routing: 1,
        staffing_and_wake: 1,
        review_handoff: 0,
        qa_gate: 1,
        closure: 0,
      },
      reasonCounts: {
        routing_reassign: 1,
        qa_approval: 1,
        implementation_start: 1,
      },
      scenarios: [
        {
          scenario: "s1",
          identifier: "CLO-1",
          total: 1,
          familyCounts: {
            pm_routing: 1,
            staffing_and_wake: 0,
            review_handoff: 0,
            qa_gate: 0,
            closure: 0,
          },
          reasonCounts: {
            routing_reassign: 1,
          },
        },
        {
          scenario: "s2",
          identifier: "CLO-2",
          total: 2,
          familyCounts: {
            pm_routing: 0,
            staffing_and_wake: 1,
            review_handoff: 0,
            qa_gate: 1,
            closure: 0,
          },
          reasonCounts: {
            qa_approval: 1,
            implementation_start: 1,
          },
        },
      ],
    });
  });
});
