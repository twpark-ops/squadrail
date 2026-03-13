import { beforeEach, describe, expect, it } from "vitest";
import { issueMergeCandidates } from "@squadrail/db";
import { issueMergeCandidateService } from "../services/issue-merge-candidates.js";

function createMergeCandidateDbMock(seed?: {
  existing?: Record<string, any>;
}) {
  const store = {
    existing: seed?.existing ?? null,
    inserted: [] as Record<string, any>[],
    updated: [] as Record<string, any>[],
    deleted: [] as string[],
  };

  const readRows = (table: unknown) => {
    if (table === issueMergeCandidates) {
      return store.existing ? [store.existing] : [];
    }
    return [];
  };

  return {
    store,
    db: {
      select() {
        return {
          from(table: unknown) {
            const rows = Promise.resolve(readRows(table));
            return {
              where() {
                return rows;
              },
              then<TResult1 = unknown, TResult2 = never>(
                onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
                onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
              ) {
                return rows.then(onfulfilled as any, onrejected as any);
              },
            };
          },
        };
      },
      insert(table: unknown) {
        return {
          values(values: Record<string, any>) {
            return {
              async returning() {
                const row = {
                  id: "merge-1",
                  ...values,
                };
                store.existing = row;
                store.inserted.push(row);
                return [row];
              },
            };
          },
        };
      },
      update(table: unknown) {
        return {
          set(values: Record<string, any>) {
            return {
              where() {
                return {
                  async returning() {
                    const row = {
                      ...(store.existing ?? {}),
                      ...values,
                    };
                    store.existing = row;
                    store.updated.push(row);
                    return [row];
                  },
                };
              },
            };
          },
        };
      },
      delete(table: unknown) {
        return {
          where() {
            return {
              async returning() {
                const deleted = store.existing ?? null;
                if (deleted) store.deleted.push(deleted.issueId);
                store.existing = null;
                return deleted ? [deleted] : [];
              },
            };
          },
        };
      },
    } as any,
  };
}

describe("issue merge candidate service", () => {
  beforeEach(() => {
    // no-op to align test structure
  });

  it("creates a merge candidate decision when none exists", async () => {
    const fixture = createMergeCandidateDbMock();
    const service = issueMergeCandidateService(fixture.db);

    const created = await service.upsertDecision({
      companyId: "company-1",
      issueId: "issue-1",
      state: "pending",
      sourceBranch: "feature/retry",
      automationMetadata: { provider: "github" },
    });

    expect(created).toEqual(expect.objectContaining({
      companyId: "company-1",
      issueId: "issue-1",
      state: "pending",
      sourceBranch: "feature/retry",
      resolvedAt: null,
    }));
    expect(fixture.store.inserted).toHaveLength(1);
  });

  it("updates an existing merge candidate and preserves automation metadata when omitted", async () => {
    const fixture = createMergeCandidateDbMock({
      existing: {
        id: "merge-1",
        issueId: "issue-1",
        automationMetadata: {
          provider: "github",
          prNumber: 42,
        },
      },
    });
    const service = issueMergeCandidateService(fixture.db);

    const updated = await service.upsertDecision({
      companyId: "company-1",
      issueId: "issue-1",
      state: "merged",
      mergeCommitSha: "abc123",
    });

    expect(updated).toEqual(expect.objectContaining({
      id: "merge-1",
      issueId: "issue-1",
      mergeCommitSha: "abc123",
      automationMetadata: {
        provider: "github",
        prNumber: 42,
      },
    }));
    expect(updated?.resolvedAt).toBeInstanceOf(Date);
  });

  it("patches automation metadata and deletes by issue id", async () => {
    const fixture = createMergeCandidateDbMock({
      existing: {
        id: "merge-1",
        issueId: "issue-1",
        automationMetadata: {
          provider: "github",
        },
      },
    });
    const service = issueMergeCandidateService(fixture.db);

    const patched = await service.patchAutomationMetadata("issue-1", {
      reviewDecision: "changes_requested",
    });
    const deleted = await service.deleteByIssueId("issue-1");

    expect(patched).toEqual(expect.objectContaining({
      automationMetadata: {
        provider: "github",
        reviewDecision: "changes_requested",
      },
    }));
    expect(deleted).toEqual(expect.objectContaining({
      issueId: "issue-1",
    }));
    expect(fixture.store.deleted).toEqual(["issue-1"]);
  });

  it("returns null when patching a missing merge candidate", async () => {
    const fixture = createMergeCandidateDbMock();
    const service = issueMergeCandidateService(fixture.db);

    await expect(service.getByIssueId("issue-1")).resolves.toBeNull();
    await expect(service.patchAutomationMetadata("issue-1", { ok: true })).resolves.toBeNull();
  });
});
