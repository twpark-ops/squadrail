import { describe, expect, it } from "vitest";
import { approvals, agents, heartbeatRuns } from "@squadrail/db";
import { sidebarBadgeService } from "../services/sidebar-badges.js";

function createSidebarBadgeDbMock(input: {
  approvalCountRows: Array<{ count: number }>;
  latestRunRows: Array<{ runStatus: string }>;
}) {
  return {
    db: {
      select() {
        return {
          from(table: unknown) {
            if (table === approvals) {
              return {
                where() {
                  return Promise.resolve(input.approvalCountRows);
                },
                then<TResult1 = unknown, TResult2 = never>(
                  onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
                  onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
                ) {
                  return Promise.resolve(input.approvalCountRows).then(onfulfilled as any, onrejected as any);
                },
              };
            }
            if (table === heartbeatRuns) {
              return {
                innerJoin(joinTable: unknown) {
                  if (joinTable !== agents) throw new Error("unexpected join");
                  return {
                    where() {
                      return this;
                    },
                    orderBy() {
                      return Promise.resolve(input.latestRunRows);
                    },
                    then<TResult1 = unknown, TResult2 = never>(
                      onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
                      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
                    ) {
                      return Promise.resolve(input.latestRunRows).then(onfulfilled as any, onrejected as any);
                    },
                  };
                },
              };
            }
            throw new Error("unexpected table");
          },
        };
      },
      selectDistinctOn() {
        return {
          from(table: unknown) {
            if (table !== heartbeatRuns) throw new Error("unexpected distinct table");
            return {
              innerJoin(joinTable: unknown) {
                if (joinTable !== agents) throw new Error("unexpected join");
                return {
                  where() {
                    return this;
                  },
                  orderBy() {
                    return Promise.resolve(input.latestRunRows);
                  },
                  then<TResult1 = unknown, TResult2 = never>(
                    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
                    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
                  ) {
                    return Promise.resolve(input.latestRunRows).then(onfulfilled as any, onrejected as any);
                  },
                };
              },
            };
          },
        };
      },
    } as any,
  };
}

describe("sidebar badge service", () => {
  it("combines approvals, failed runs, join requests, and assigned issues into inbox counts", async () => {
    const fixture = createSidebarBadgeDbMock({
      approvalCountRows: [{ count: 2 }],
      latestRunRows: [
        { runStatus: "failed" },
        { runStatus: "timed_out" },
        { runStatus: "completed" },
      ],
    });

    const result = await sidebarBadgeService(fixture.db).get("company-1", {
      joinRequests: 3,
      assignedIssues: 4,
    });

    expect(result).toEqual({
      inbox: 11,
      approvals: 2,
      failedRuns: 2,
      joinRequests: 3,
    });
  });

  it("defaults extra counts to zero", async () => {
    const fixture = createSidebarBadgeDbMock({
      approvalCountRows: [{ count: 0 }],
      latestRunRows: [{ runStatus: "completed" }],
    });

    await expect(sidebarBadgeService(fixture.db).get("company-1")).resolves.toEqual({
      inbox: 0,
      approvals: 0,
      failedRuns: 0,
      joinRequests: 0,
    });
  });
});
