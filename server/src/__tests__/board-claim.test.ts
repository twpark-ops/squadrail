import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companies, companyMemberships, instanceUserRoles } from "@squadrail/db";
import {
  claimBoardOwnership,
  getBoardClaimWarningUrl,
  initializeBoardClaimChallenge,
  inspectBoardClaimChallenge,
} from "../board-claim.js";

function createBoardClaimDb(input?: {
  adminRows?: Array<{ userId: string }>;
  companyRows?: Array<{ id: string }>;
  targetAdminRow?: { id: string } | null;
  membershipRows?: Array<{ id: string; status: string } | null>;
}) {
  const state = {
    adminRows: input?.adminRows ?? [],
    companyRows: input?.companyRows ?? [],
    membershipRows: [...(input?.membershipRows ?? [])],
    targetAdminRow: input?.targetAdminRow ?? null,
    inserted: [] as Array<{ table: unknown; values: unknown }>,
    deleted: [] as Array<{ table: unknown }>,
    updated: [] as Array<{ table: unknown; values: unknown }>,
  };

  const makeSelect = (mode: "root" | "tx") => ({
    from(table: unknown) {
      const resolveRows = () => {
        if (table === instanceUserRoles) {
          if (mode === "root") return state.adminRows;
          return state.targetAdminRow ? [state.targetAdminRow] : [];
        }
        if (table === companies) return state.companyRows;
        if (table === companyMemberships) {
          const next = state.membershipRows.shift() ?? null;
          return next ? [next] : [];
        }
        return [];
      };
      const rows = Promise.resolve(resolveRows());
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
  });

  const tx = {
    select() {
      return makeSelect("tx");
    },
    insert(table: unknown) {
      return {
        async values(values: unknown) {
          state.inserted.push({ table, values });
        },
      };
    },
    delete(table: unknown) {
      return {
        async where() {
          state.deleted.push({ table });
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: unknown) {
          return {
            async where() {
              state.updated.push({ table, values });
            },
          };
        },
      };
    },
  };

  return {
    state,
    db: {
      select() {
        return makeSelect("root");
      },
      async transaction<T>(callback: (value: typeof tx) => Promise<T>) {
        return callback(tx);
      },
    } as any,
  };
}

function parseClaimUrl(url: string) {
  const parsed = new URL(url);
  const token = parsed.pathname.split("/").pop() ?? "";
  const code = parsed.searchParams.get("code") ?? "";
  return { token, code };
}

describe("board claim", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T00:00:00.000Z"));
  });

  afterEach(async () => {
    const { db } = createBoardClaimDb();
    await initializeBoardClaimChallenge(db, { deploymentMode: "local_trusted" as any });
    vi.useRealTimers();
  });

  it("creates a claim challenge only when local-board is the sole instance admin", async () => {
    const ready = createBoardClaimDb({
      adminRows: [{ userId: "local-board" }],
    });
    const blocked = createBoardClaimDb({
      adminRows: [{ userId: "local-board" }, { userId: "user-2" }],
    });

    await initializeBoardClaimChallenge(ready.db, { deploymentMode: "authenticated" as any });
    const warningUrl = getBoardClaimWarningUrl("0.0.0.0", 3144);
    expect(warningUrl).toContain("http://localhost:3144/board-claim/");

    await initializeBoardClaimChallenge(blocked.db, { deploymentMode: "authenticated" as any });
    expect(getBoardClaimWarningUrl("0.0.0.0", 3144)).toBeNull();
  });

  it("reports available and expired claim challenge states", async () => {
    const fixture = createBoardClaimDb({
      adminRows: [{ userId: "local-board" }],
    });
    await initializeBoardClaimChallenge(fixture.db, { deploymentMode: "authenticated" as any });

    const warningUrl = getBoardClaimWarningUrl("127.0.0.1", 3144);
    expect(warningUrl).not.toBeNull();
    const { token, code } = parseClaimUrl(warningUrl!);

    expect(inspectBoardClaimChallenge(token, code)).toEqual(expect.objectContaining({
      status: "available",
      requiresSignIn: true,
    }));

    vi.advanceTimersByTime(1000 * 60 * 60 * 25);
    expect(inspectBoardClaimChallenge(token, code)).toEqual(expect.objectContaining({
      status: "expired",
    }));
    expect(getBoardClaimWarningUrl("127.0.0.1", 3144)).toBeNull();
  });

  it("claims ownership, promotes the new admin, and fixes memberships", async () => {
    const fixture = createBoardClaimDb({
      adminRows: [{ userId: "local-board" }],
      companyRows: [
        { id: "company-1" },
        { id: "company-2" },
      ],
      targetAdminRow: null,
      membershipRows: [
        { id: "membership-1", status: "inactive" },
        null,
      ],
    });

    await initializeBoardClaimChallenge(fixture.db, { deploymentMode: "authenticated" as any });
    const warningUrl = getBoardClaimWarningUrl("127.0.0.1", 3144);
    const { token, code } = parseClaimUrl(warningUrl!);

    const claimed = await claimBoardOwnership(fixture.db, {
      token,
      code,
      userId: "user-2",
    });

    expect(claimed).toEqual({
      status: "claimed",
      claimedByUserId: "user-2",
    });
    expect(inspectBoardClaimChallenge(token, code)).toEqual(expect.objectContaining({
      status: "claimed",
      claimedByUserId: "user-2",
    }));
    expect(fixture.state.inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: instanceUserRoles,
        values: expect.objectContaining({
          userId: "user-2",
          role: "instance_admin",
        }),
      }),
      expect.objectContaining({
        table: companyMemberships,
        values: expect.objectContaining({
          companyId: "company-2",
          principalType: "user",
          principalId: "user-2",
          membershipRole: "owner",
        }),
      }),
    ]));
    expect(fixture.state.deleted).toEqual([
      expect.objectContaining({
        table: instanceUserRoles,
      }),
    ]);
    expect(fixture.state.updated).toEqual([
      expect.objectContaining({
        table: companyMemberships,
        values: expect.objectContaining({
          status: "active",
          membershipRole: "owner",
        }),
      }),
    ]);
  });
});
