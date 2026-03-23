import { describe, expect, it } from "vitest";
import { resolveChildDeliveryActors } from "../autonomy-role-utils.mjs";

describe("autonomy-role-utils", () => {
  it("prefers current protocol state owners over preview staffing", () => {
    expect(resolveChildDeliveryActors(
      {
        primaryEngineerAgentId: "eng-live",
        techLeadAgentId: "tl-live",
        reviewerAgentId: "rev-live",
        qaAgentId: "qa-live",
      },
      {
        staffing: {
          implementationAssigneeAgentId: "eng-preview",
          techLeadAgentId: "tl-preview",
          reviewerAgentId: "rev-preview",
          qaAgentId: "qa-preview",
        },
      },
    )).toEqual({
      implementationAssigneeAgentId: "eng-live",
      techLeadAgentId: "tl-live",
      reviewerAgentId: "rev-live",
      qaAgentId: "qa-live",
    });
  });

  it("falls back to preview staffing when protocol state omits an owner", () => {
    expect(resolveChildDeliveryActors(
      {
        primaryEngineerAgentId: null,
        techLeadAgentId: null,
        reviewerAgentId: "rev-live",
        qaAgentId: null,
      },
      {
        staffing: {
          implementationAssigneeAgentId: "eng-preview",
          techLeadAgentId: "tl-preview",
          reviewerAgentId: "rev-preview",
          qaAgentId: "qa-preview",
        },
      },
    )).toEqual({
      implementationAssigneeAgentId: "eng-preview",
      techLeadAgentId: "tl-preview",
      reviewerAgentId: "rev-live",
      qaAgentId: "qa-preview",
    });
  });
});
