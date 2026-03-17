export const appRoutes = {
  overview: "/overview",
  work: "/work",
  changes: "/changes",
  runs: "/runs",
  knowledge: "/knowledge",
  team: "/team",
  settings: "/settings",
  docs: "/docs",
  costs: "/costs",
} as const;

export function workIssuePath(issueRef: string) {
  return `${appRoutes.work}/${issueRef}`;
}

export function changeIssuePath(issueRef: string) {
  return `${appRoutes.changes}/${issueRef}`;
}

