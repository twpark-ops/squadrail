import { beforeEach, describe, expect, it } from "vitest";
import { approvals, issueApprovals, issues } from "@squadrail/db";
import { issueApprovalService } from "../services/issue-approvals.js";

function createIssueApprovalDbMock(seed?: {
  issueRows?: unknown[][];
  approvalRows?: unknown[][];
  issueApprovalRows?: unknown[][];
  approvalJoinRows?: unknown[][];
  issueJoinRows?: unknown[][];
}) {
  const queues = {
    issueRows: [...(seed?.issueRows ?? [])],
    approvalRows: [...(seed?.approvalRows ?? [])],
    issueApprovalRows: [...(seed?.issueApprovalRows ?? [])],
    approvalJoinRows: [...(seed?.approvalJoinRows ?? [])],
    issueJoinRows: [...(seed?.issueJoinRows ?? [])],
  };
  const state = {
    inserted: [] as Array<{ table: unknown; values: unknown }>,
    deleted: [] as unknown[],
  };

  function buildResolvedChain(rows: unknown[]) {
    const chain = {
      where() {
        return chain;
      },
      orderBy() {
        return Promise.resolve(rows);
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return Promise.resolve(rows).then(onfulfilled as any, onrejected as any);
      },
    };
    return chain;
  }

  return {
    state,
    db: {
      select() {
        return {
          from(table: unknown) {
            if (table === issues) {
              const rows = queues.issueRows.shift() ?? [];
              return buildResolvedChain(rows);
            }
            if (table === approvals) {
              const rows = queues.approvalRows.shift() ?? [];
              return buildResolvedChain(rows);
            }
            if (table === issueApprovals) {
              return {
                innerJoin(joinTable: unknown) {
                  if (joinTable === approvals) return buildResolvedChain(queues.approvalJoinRows.shift() ?? []);
                  if (joinTable === issues) return buildResolvedChain(queues.issueJoinRows.shift() ?? []);
                  throw new Error("unexpected join");
                },
                where() {
                  return Promise.resolve(queues.issueApprovalRows.shift() ?? []);
                },
              };
            }
            throw new Error("unexpected table");
          },
        };
      },
      insert(table: unknown) {
        return {
          values(values: unknown) {
            state.inserted.push({ table, values });
            return {
              async onConflictDoNothing() {
                return undefined;
              },
            };
          },
        };
      },
      delete(table: unknown) {
        return {
          async where(condition: unknown) {
            state.deleted.push(condition);
          },
        };
      },
    } as any,
  };
}

describe("issue approval service", () => {
  beforeEach(() => {
    // no-op
  });

  it("lists approvals for an issue and redacts payloads", async () => {
    const fixture = createIssueApprovalDbMock({
      issueRows: [[{
        id: "issue-1",
        companyId: "company-1",
      }]],
      approvalJoinRows: [[{
        id: "approval-1",
        companyId: "company-1",
        type: "hire_agent",
        requestedByAgentId: null,
        requestedByUserId: "user-1",
        status: "pending",
        payload: {
          apiKey: "secret",
        },
        decisionNote: null,
        decidedByUserId: null,
        decidedAt: null,
        createdAt: new Date("2026-03-13T00:00:00.000Z"),
        updatedAt: new Date("2026-03-13T00:00:00.000Z"),
      }]],
    });
    const service = issueApprovalService(fixture.db);

    const result = await service.listApprovalsForIssue("issue-1");

    expect(result).toEqual([
      expect.objectContaining({
        id: "approval-1",
        companyId: "company-1",
        payload: expect.any(Object),
      }),
    ]);
    expect(JSON.stringify(result[0]?.payload)).not.toContain("secret");
  });

  it("lists linked issues for an approval", async () => {
    const fixture = createIssueApprovalDbMock({
      approvalRows: [[{
        id: "approval-1",
        companyId: "company-1",
      }]],
      issueJoinRows: [[{
        id: "issue-1",
        companyId: "company-1",
        projectId: null,
        goalId: null,
        parentId: null,
        title: "Review flow",
        description: null,
        status: "todo",
        priority: "high",
        assigneeAgentId: null,
        createdByAgentId: null,
        createdByUserId: "user-1",
        issueNumber: 1,
        identifier: "CLO-1",
        requestDepth: 0,
        billingCode: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: new Date("2026-03-13T00:00:00.000Z"),
        updatedAt: new Date("2026-03-13T00:00:00.000Z"),
      }]],
    });
    const service = issueApprovalService(fixture.db);

    await expect(service.listIssuesForApproval("approval-1")).resolves.toEqual([
      expect.objectContaining({
        id: "issue-1",
        identifier: "CLO-1",
      }),
    ]);
  });

  it("links and unlinks issue approval pairs after same-company validation", async () => {
    const fixture = createIssueApprovalDbMock({
      issueRows: [
        [{
          id: "issue-1",
          companyId: "company-1",
        }],
        [{
          id: "issue-1",
          companyId: "company-1",
        }],
        [{
          id: "issue-1",
          companyId: "company-1",
        }],
      ],
      approvalRows: [
        [{
          id: "approval-1",
          companyId: "company-1",
        }],
        [{
          id: "approval-1",
          companyId: "company-1",
        }],
      ],
      issueApprovalRows: [[{
        issueId: "issue-1",
        approvalId: "approval-1",
      }]],
    });
    const service = issueApprovalService(fixture.db);

    const linked = await service.link("issue-1", "approval-1", {
      agentId: "agent-1",
      userId: null,
    });
    await service.unlink("issue-1", "approval-1");

    expect(linked).toEqual({
      issueId: "issue-1",
      approvalId: "approval-1",
    });
    expect(fixture.state.inserted).toEqual([
      expect.objectContaining({
        table: issueApprovals,
        values: expect.objectContaining({
          issueId: "issue-1",
          approvalId: "approval-1",
          linkedByAgentId: "agent-1",
        }),
      }),
    ]);
    expect(fixture.state.deleted).toHaveLength(1);
  });

  it("rejects cross-company links and missing issues during bulk link", async () => {
    const mismatch = createIssueApprovalDbMock({
      approvalRows: [[{
        id: "approval-1",
        companyId: "company-1",
      }]],
      issueRows: [[
        { id: "issue-1", companyId: "company-1" },
        { id: "issue-2", companyId: "company-2" },
      ]],
    });
    const missing = createIssueApprovalDbMock({
      approvalRows: [[{
        id: "approval-1",
        companyId: "company-1",
      }]],
      issueRows: [[
        { id: "issue-1", companyId: "company-1" },
      ]],
    });
    const mismatchService = issueApprovalService(mismatch.db);
    const missingService = issueApprovalService(missing.db);

    await expect(mismatchService.linkManyForApproval("approval-1", ["issue-1", "issue-2"]))
      .rejects.toThrow("Issue and approval must belong to the same company");
    await expect(missingService.linkManyForApproval("approval-1", ["issue-1", "issue-2"]))
      .rejects.toThrow("One or more issues not found");
  });

  it("deduplicates bulk issue links before inserting", async () => {
    const fixture = createIssueApprovalDbMock({
      approvalRows: [[{
        id: "approval-1",
        companyId: "company-1",
      }]],
      issueRows: [[
        { id: "issue-1", companyId: "company-1" },
        { id: "issue-2", companyId: "company-1" },
      ]],
    });
    const service = issueApprovalService(fixture.db);

    await service.linkManyForApproval("approval-1", ["issue-1", "issue-2", "issue-1"], {
      userId: "user-1",
    });

    expect(fixture.state.inserted).toEqual([
      expect.objectContaining({
        table: issueApprovals,
        values: [
          expect.objectContaining({
            issueId: "issue-1",
            approvalId: "approval-1",
            linkedByUserId: "user-1",
          }),
          expect.objectContaining({
            issueId: "issue-2",
            approvalId: "approval-1",
            linkedByUserId: "user-1",
          }),
        ],
      }),
    ]);
  });
});
