import {
  companyMemberships,
  instanceUserRoles,
  principalPermissionGrants,
} from "@squadrail/db";
import { describe, expect, it } from "vitest";
import { accessService } from "../services/access.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createAccessDbMock(input: {
  selectResults?: unknown[][];
  insertResults?: unknown[][];
  updateResults?: unknown[][];
  deleteResults?: unknown[][];
}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const insertQueue = [...(input.insertResults ?? [])];
  const updateQueue = [...(input.updateResults ?? [])];
  const deleteQueue = [...(input.deleteResults ?? [])];
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];
  const deletedTables: unknown[] = [];

  const db = {
    select: () => createResolvedChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        return {
          returning: async () => insertQueue.shift() ?? [],
        };
      },
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateSets.push({ table, value });
        return {
          where: () => ({
            returning: async () => updateQueue.shift() ?? [],
          }),
        };
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        deletedTables.push(table);
        return {
          returning: async () => deleteQueue.shift() ?? [],
        };
      },
    }),
    transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
  };

  return { db, insertValues, updateSets, deletedTables };
}

describe("access service", () => {
  it("checks instance admin and permission grants across missing, inactive, and granted members", async () => {
    const activeMember = {
      id: "member-1",
      companyId: "company-1",
      principalType: "user",
      principalId: "user-2",
      status: "active",
      membershipRole: "member",
    };
    const { db } = createAccessDbMock({
      selectResults: [
        [activeMember],
        [{ id: "grant-1" }],
      ],
    });
    const service = accessService(db as never);

    await expect(service.isInstanceAdmin(null)).resolves.toBe(false);
    await expect(service.canUser("company-1", undefined, "joins:approve")).resolves.toBe(false);
    await expect(service.hasPermission("company-1", "user", "user-2", "joins:approve")).resolves.toBe(true);
  });

  it("grants access to instance admins without membership lookup", async () => {
    const { db } = createAccessDbMock({
      selectResults: [[{ id: "role-1" }]],
    });
    const service = accessService(db as never);

    await expect(service.canUser("company-1", "user-1", "joins:approve")).resolves.toBe(true);
  });

  it("replaces member grants inside a transaction", async () => {
    const member = {
      id: "member-1",
      companyId: "company-1",
      principalType: "user",
      principalId: "user-1",
      status: "active",
      membershipRole: "owner",
    };
    const { db, insertValues, deletedTables } = createAccessDbMock({
      selectResults: [[member]],
    });
    const service = accessService(db as never);

    const result = await service.setMemberPermissions(
      "company-1",
      "member-1",
      [
        { permissionKey: "joins:approve" },
        { permissionKey: "agents:hire", scope: { lane: "review" } },
      ],
      "board-1",
    );

    expect(result).toEqual(member);
    expect(deletedTables).toContain(principalPermissionGrants);
    expect(insertValues.find((entry) => entry.table === principalPermissionGrants)?.value).toEqual([
      expect.objectContaining({
        companyId: "company-1",
        principalType: "user",
        principalId: "user-1",
        permissionKey: "joins:approve",
        grantedByUserId: "board-1",
      }),
      expect.objectContaining({
        permissionKey: "agents:hire",
        scope: { lane: "review" },
      }),
    ]);
  });

  it("synchronizes user company access by deleting stale rows and adding missing ones", async () => {
    const { db, insertValues, deletedTables } = createAccessDbMock({
      selectResults: [
        [
          {
            id: "membership-1",
            companyId: "company-1",
            principalType: "user",
            principalId: "user-1",
            status: "active",
            membershipRole: "member",
          },
          {
            id: "membership-2",
            companyId: "company-2",
            principalType: "user",
            principalId: "user-1",
            status: "active",
            membershipRole: "member",
          },
        ],
        [
          {
            id: "membership-1",
            companyId: "company-1",
            principalType: "user",
            principalId: "user-1",
            status: "active",
            membershipRole: "member",
          },
          {
            id: "membership-3",
            companyId: "company-3",
            principalType: "user",
            principalId: "user-1",
            status: "active",
            membershipRole: "member",
          },
        ],
      ],
    });
    const service = accessService(db as never);

    const rows = await service.setUserCompanyAccess("user-1", ["company-1", "company-3"]);

    expect(rows).toHaveLength(2);
    expect(deletedTables).toContain(companyMemberships);
    expect(insertValues.find((entry) => entry.table === companyMemberships)?.value).toMatchObject({
      companyId: "company-3",
      principalType: "user",
      principalId: "user-1",
      status: "active",
      membershipRole: "member",
    });
  });

  it("updates existing membership state and can promote or demote instance admins", async () => {
    const existing = {
      id: "membership-1",
      companyId: "company-1",
      principalType: "agent",
      principalId: "agent-1",
      status: "pending",
      membershipRole: "member",
    };
    const promoted = {
      id: "role-1",
      userId: "user-1",
      role: "instance_admin",
    };
    const demoted = {
      id: "role-1",
      userId: "user-1",
      role: "instance_admin",
    };
    const { db, updateSets, insertValues, deletedTables } = createAccessDbMock({
      selectResults: [
        [existing],
        [],
        [promoted],
      ],
      updateResults: [[{
        ...existing,
        status: "active",
        membershipRole: "owner",
      }]],
      deleteResults: [[demoted]],
      insertResults: [[promoted]],
    });
    const service = accessService(db as never);

    const membership = await service.ensureMembership("company-1", "agent", "agent-1", "owner", "active");
    const createdRole = await service.promoteInstanceAdmin("user-1");
    const removedRole = await service.demoteInstanceAdmin("user-1");

    expect(membership).toMatchObject({
      status: "active",
      membershipRole: "owner",
    });
    expect(updateSets.find((entry) => entry.table === companyMemberships)?.value).toMatchObject({
      status: "active",
      membershipRole: "owner",
    });
    expect(insertValues.find((entry) => entry.table === instanceUserRoles)?.value).toMatchObject({
      userId: "user-1",
      role: "instance_admin",
    });
    expect(createdRole).toEqual(promoted);
    expect(deletedTables).toContain(instanceUserRoles);
    expect(removedRole).toEqual(demoted);
  });

  it("lists user access, inserts missing memberships, and can write principal grants directly", async () => {
    const existingMembership = {
      id: "membership-1",
      companyId: "company-1",
      principalType: "user",
      principalId: "user-1",
      status: "active",
      membershipRole: "member",
    };
    const refreshedMemberships = [
      existingMembership,
      {
        id: "membership-2",
        companyId: "company-2",
        principalType: "user",
        principalId: "user-1",
        status: "active",
        membershipRole: "member",
      },
    ];
    const { db, insertValues, deletedTables } = createAccessDbMock({
      selectResults: [
        [existingMembership],
        [existingMembership],
        refreshedMemberships,
      ],
    });
    const service = accessService(db as never);

    await expect(service.listUserCompanyAccess("user-1")).resolves.toEqual([existingMembership]);
    await expect(service.setUserCompanyAccess("user-1", ["company-1", "company-2"])).resolves.toEqual(
      refreshedMemberships,
    );
    await expect(service.setPrincipalGrants("company-1", "user", "user-1", [
      { permissionKey: "agents:hire", scope: { lane: "review" } },
    ], "board-1")).resolves.toBeUndefined();

    expect(insertValues).toContainEqual({
      table: companyMemberships,
      value: expect.objectContaining({
        companyId: "company-2",
        principalId: "user-1",
      }),
    });
    expect(insertValues).toContainEqual({
      table: principalPermissionGrants,
      value: [
        expect.objectContaining({
          companyId: "company-1",
          principalType: "user",
          principalId: "user-1",
          permissionKey: "agents:hire",
        }),
      ],
    });
    expect(deletedTables).toContain(principalPermissionGrants);
  });

  it("returns existing memberships unchanged and reuses existing admin rows", async () => {
    const existingMembership = {
      id: "membership-1",
      companyId: "company-1",
      principalType: "agent",
      principalId: "agent-1",
      status: "active",
      membershipRole: "owner",
    };
    const existingRole = {
      id: "role-1",
      userId: "user-1",
      role: "instance_admin",
    };
    const { db, insertValues, updateSets } = createAccessDbMock({
      selectResults: [
        [existingMembership],
        [existingRole],
      ],
    });
    const service = accessService(db as never);

    await expect(service.ensureMembership("company-1", "agent", "agent-1", "owner", "active")).resolves.toEqual(
      existingMembership,
    );
    await expect(service.promoteInstanceAdmin("user-1")).resolves.toEqual(existingRole);

    expect(insertValues).toEqual([]);
    expect(updateSets).toEqual([]);
  });
});
