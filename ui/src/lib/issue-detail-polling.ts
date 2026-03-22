export type IssueDetailSection = "Work" | "Changes";

export type IssueDetailTab =
  | "brief"
  | "protocol"
  | "comments"
  | "subissues"
  | "documents"
  | "activity"
  | "delivery"
  | "deliverables";

export type IssueDetailPollingState = {
  protocolState: boolean;
  protocolMessages: boolean;
  protocolBriefs: boolean;
  reviewCycles: boolean;
  protocolViolations: boolean;
  changeSurface: boolean;
  linkedRuns: boolean;
};

export function buildIssueDetailPollingState(input: {
  detailTab: IssueDetailTab;
  issueSection: IssueDetailSection;
}): IssueDetailPollingState {
  const isChangesSurface = input.issueSection === "Changes";
  const isProtocolTab = input.detailTab === "protocol";
  const isDeliveryTab = input.detailTab === "delivery";
  const isBriefTab = input.detailTab === "brief";

  return {
    protocolState: isChangesSurface || isProtocolTab || isDeliveryTab,
    protocolMessages: isChangesSurface || isProtocolTab || isDeliveryTab,
    protocolBriefs: isChangesSurface || isProtocolTab || isBriefTab,
    reviewCycles: isChangesSurface || isProtocolTab || isDeliveryTab,
    protocolViolations: isChangesSurface || isProtocolTab || isDeliveryTab,
    changeSurface: isChangesSurface,
    linkedRuns: isChangesSurface || isDeliveryTab,
  };
}

export function resolveIssueDetailLiveRefetchInterval(input: {
  pollingActive: boolean;
  hasData: boolean;
  intervalMs: number;
}) {
  return input.pollingActive || input.hasData ? input.intervalMs : false;
}
