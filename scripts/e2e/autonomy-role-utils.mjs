export function resolveChildDeliveryActors(protocolState, preview) {
  const staffing = preview?.staffing ?? {};
  return {
    implementationAssigneeAgentId:
      protocolState?.primaryEngineerAgentId
      ?? staffing.implementationAssigneeAgentId
      ?? null,
    techLeadAgentId:
      protocolState?.techLeadAgentId
      ?? staffing.techLeadAgentId
      ?? null,
    reviewerAgentId:
      protocolState?.reviewerAgentId
      ?? staffing.reviewerAgentId
      ?? null,
    qaAgentId:
      protocolState?.qaAgentId
      ?? staffing.qaAgentId
      ?? null,
  };
}
