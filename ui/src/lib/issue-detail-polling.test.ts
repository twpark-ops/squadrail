import { describe, expect, it } from "vitest";
import {
  buildIssueDetailPollingState,
  resolveIssueDetailLiveRefetchInterval,
} from "./issue-detail-polling";

describe("issue detail polling state", () => {
  it("keeps the default brief tab focused on brief refresh only", () => {
    expect(buildIssueDetailPollingState({
      detailTab: "brief",
      issueSection: "Work",
    })).toEqual({
      protocolState: false,
      protocolMessages: false,
      protocolBriefs: true,
      reviewCycles: false,
      protocolViolations: false,
      changeSurface: false,
      linkedRuns: false,
    });
  });

  it("enables protocol polling on protocol and delivery surfaces", () => {
    expect(buildIssueDetailPollingState({
      detailTab: "protocol",
      issueSection: "Work",
    })).toEqual({
      protocolState: true,
      protocolMessages: true,
      protocolBriefs: true,
      reviewCycles: true,
      protocolViolations: true,
      changeSurface: false,
      linkedRuns: false,
    });

    expect(buildIssueDetailPollingState({
      detailTab: "delivery",
      issueSection: "Work",
    })).toEqual({
      protocolState: true,
      protocolMessages: true,
      protocolBriefs: false,
      reviewCycles: true,
      protocolViolations: true,
      changeSurface: false,
      linkedRuns: true,
    });
  });

  it("treats the changes route as always-live", () => {
    expect(buildIssueDetailPollingState({
      detailTab: "brief",
      issueSection: "Changes",
    })).toEqual({
      protocolState: true,
      protocolMessages: true,
      protocolBriefs: true,
      reviewCycles: true,
      protocolViolations: true,
      changeSurface: true,
      linkedRuns: true,
    });
  });
});

describe("issue detail live refetch interval", () => {
  it("polls when the tab is active or live data already exists", () => {
    expect(resolveIssueDetailLiveRefetchInterval({
      pollingActive: true,
      hasData: false,
      intervalMs: 3000,
    })).toBe(3000);
    expect(resolveIssueDetailLiveRefetchInterval({
      pollingActive: false,
      hasData: true,
      intervalMs: 3000,
    })).toBe(3000);
    expect(resolveIssueDetailLiveRefetchInterval({
      pollingActive: false,
      hasData: false,
      intervalMs: 3000,
    })).toBe(false);
  });
});
