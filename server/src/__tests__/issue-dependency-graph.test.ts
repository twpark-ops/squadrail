import { describe, expect, it } from "vitest";
import {
  buildIssueDependencyBlockingSummary,
  extractIssueDependencyReferences,
  hasBlockingIssueDependencies,
  readIssueDependencyGraphMetadata,
  resolveIssueDependencyGraphMetadata,
} from "../services/issue-dependency-graph.js";

function createDependencyDb(rows: unknown[]) {
  return {
    select() {
      return {
        from() {
          return this;
        },
        leftJoin() {
          return this;
        },
        where() {
          return Promise.resolve(rows);
        },
      };
    },
  } as any;
}

describe("issue dependency graph helpers", () => {
  it("extracts unique normalized dependency references from plan steps", () => {
    expect(
      extractIssueDependencyReferences({
        steps: [
          { title: "A", dependsOn: [" clo-101 ", "11111111-1111-4111-8111-111111111111"] },
          { title: "B", dependsOn: ["CLO-101", " clo-102 "] },
        ],
      }),
    ).toEqual([
      "CLO-101",
      "11111111-1111-4111-8111-111111111111",
      "CLO-102",
    ]);
  });

  it("resolves dependency rows and marks unfinished issues as blocking", async () => {
    const metadata = await resolveIssueDependencyGraphMetadata(
      createDependencyDb([
        {
          id: "issue-done",
          identifier: "CLO-101",
          title: "Already done",
          status: "done",
          workflowState: "done",
        },
        {
          id: "issue-open",
          identifier: "CLO-102",
          title: "Still open",
          status: "in_progress",
          workflowState: "implementing",
        },
      ]),
      {
        companyId: "company-1",
        issueId: "issue-current",
        payload: {
          steps: [
            {
              title: "Plan",
              dependsOn: ["CLO-101", "CLO-102", "CLO-404"],
            },
          ],
        },
        existingMetadata: {},
        now: new Date("2026-03-12T00:00:00.000Z"),
      },
    );

    expect(metadata).toMatchObject({
      refs: ["CLO-101", "CLO-102", "CLO-404"],
      unresolvedCount: 2,
      blockingIssueIds: ["issue-open"],
      items: [
        { reference: "CLO-101", resolved: true, issueId: "issue-done" },
        { reference: "CLO-102", resolved: false, issueId: "issue-open" },
        { reference: "CLO-404", resolved: false, issueId: null },
      ],
    });
    expect(hasBlockingIssueDependencies(metadata)).toBe(true);
    expect(buildIssueDependencyBlockingSummary(metadata)).toContain("CLO-102");
  });

  it("reuses persisted dependency refs when a later message omits dependsOn", async () => {
    const metadata = await resolveIssueDependencyGraphMetadata(
      createDependencyDb([
        {
          id: "issue-open",
          identifier: "CLO-102",
          title: "Still open",
          status: "todo",
          workflowState: "assigned",
        },
      ]),
      {
        companyId: "company-1",
        issueId: "issue-current",
        payload: {},
        existingMetadata: {
          dependencyGraph: {
            refs: ["CLO-102"],
            items: [],
            unresolvedCount: 1,
            blockingIssueIds: ["issue-open"],
            updatedAt: "2026-03-11T00:00:00.000Z",
          },
        },
      },
    );

    expect(metadata?.refs).toEqual(["CLO-102"]);
    expect(metadata?.items[0]).toMatchObject({
      reference: "CLO-102",
      issueId: "issue-open",
      resolved: false,
    });
  });

  it("refreshes persisted dependency refs against current issue status", async () => {
    const metadata = await resolveIssueDependencyGraphMetadata(
      createDependencyDb([
        {
          id: "issue-open",
          identifier: "CLO-102",
          title: "Now done",
          status: "done",
          workflowState: "done",
        },
      ]),
      {
        companyId: "company-1",
        issueId: "issue-current",
        payload: {},
        existingMetadata: {
          dependencyGraph: {
            refs: ["CLO-102"],
            items: [
              {
                reference: "CLO-102",
                issueId: "issue-open",
                identifier: "CLO-102",
                title: "Still open",
                status: "in_progress",
                workflowState: "implementing",
                resolved: false,
              },
            ],
            unresolvedCount: 1,
            blockingIssueIds: ["issue-open"],
            updatedAt: "2026-03-11T00:00:00.000Z",
          },
        },
      },
    );

    expect(metadata).toMatchObject({
      unresolvedCount: 0,
      blockingIssueIds: [],
      items: [
        {
          reference: "CLO-102",
          issueId: "issue-open",
          resolved: true,
          status: "done",
          workflowState: "done",
        },
      ],
    });
  });

  it("parses persisted metadata safely", () => {
    const metadata = readIssueDependencyGraphMetadata({
      dependencyGraph: {
        refs: ["CLO-201"],
        items: [
          {
            reference: "CLO-201",
            issueId: "issue-201",
            identifier: "CLO-201",
            title: "Dependency",
            status: "done",
            workflowState: "done",
            resolved: true,
          },
        ],
        unresolvedCount: 0,
        blockingIssueIds: [],
        updatedAt: "2026-03-12T00:00:00.000Z",
      },
    });

    expect(metadata).toEqual({
      refs: ["CLO-201"],
      items: [
        {
          reference: "CLO-201",
          issueId: "issue-201",
          identifier: "CLO-201",
          title: "Dependency",
          status: "done",
          workflowState: "done",
          resolved: true,
        },
      ],
      unresolvedCount: 0,
      blockingIssueIds: [],
      updatedAt: "2026-03-12T00:00:00.000Z",
    });
  });
});
