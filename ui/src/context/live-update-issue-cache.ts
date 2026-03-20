import type { Issue } from "@squadrail/shared";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function resolveIssueProjectIdsFromCache(input: {
  issueId: string;
  details: Record<string, unknown> | null;
  detailIssue: Issue | null | undefined;
  listIssues: Issue[] | null | undefined;
}) {
  const ids = new Set<string>();
  const detailsIdentifier =
    readString(input.details?.identifier) ??
    readString(input.details?.issueIdentifier);
  const matchingListIssue = input.listIssues?.find((issue) => {
    if (issue.id === input.issueId) return true;
    if (issue.identifier && issue.identifier === input.issueId) return true;
    if (detailsIdentifier && issue.identifier === detailsIdentifier) return true;
    return false;
  });
  const previousDetails = readRecord(input.details?.previous);

  const candidates = [
    input.detailIssue?.projectId ?? null,
    matchingListIssue?.projectId ?? null,
    readString(input.details?.projectId),
    readString(input.details?.nextProjectId),
    readString(input.details?.previousProjectId),
    readString(previousDetails?.projectId),
  ];

  for (const projectId of candidates) {
    if (projectId) ids.add(projectId);
  }

  return Array.from(ids);
}

export function shouldInvalidateProjectsListForIssueActivity(projectIds: string[]) {
  return projectIds.length > 0;
}
