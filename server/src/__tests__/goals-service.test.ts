import { beforeEach, describe, expect, it } from "vitest";
import { goals } from "@squadrail/db";
import { goalService } from "../services/goals.js";

function createGoalDbMock(seed?: { existing?: Record<string, any> | null }) {
  let existing = seed?.existing ?? null;

  return {
    db: {
      select() {
        return {
          from(table: unknown) {
            if (table !== goals) throw new Error("unexpected table");
            return {
              where() {
                return Promise.resolve(existing ? [existing] : []);
              },
              then<TResult1 = unknown, TResult2 = never>(
                onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
                onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
              ) {
                return Promise.resolve(existing ? [existing] : []).then(onfulfilled as any, onrejected as any);
              },
            };
          },
        };
      },
      insert(table: unknown) {
        if (table !== goals) throw new Error("unexpected table");
        return {
          values(values: Record<string, any>) {
            return {
              async returning() {
                existing = {
                  id: "goal-1",
                  ...values,
                };
                return [existing];
              },
            };
          },
        };
      },
      update(table: unknown) {
        if (table !== goals) throw new Error("unexpected table");
        return {
          set(values: Record<string, any>) {
            return {
              where() {
                return {
                  async returning() {
                    existing = existing ? { ...existing, ...values } : null;
                    return existing ? [existing] : [];
                  },
                };
              },
            };
          },
        };
      },
      delete(table: unknown) {
        if (table !== goals) throw new Error("unexpected table");
        return {
          where() {
            return {
              async returning() {
                const deleted = existing;
                existing = null;
                return deleted ? [deleted] : [];
              },
            };
          },
        };
      },
    } as any,
  };
}

describe("goal service", () => {
  beforeEach(() => {
    // no-op
  });

  it("creates and lists goals inside a company scope", async () => {
    const fixture = createGoalDbMock();
    const service = goalService(fixture.db);

    const created = await service.create("company-1", {
      title: "Reach coverage target",
      description: "Push server coverage over sixty percent",
      parentId: null,
      status: "active",
      progressPercent: 75,
      targetDate: null,
      sprintName: "stability",
      capacityPlanJson: null,
      metadata: null,
    } as any);
    const listed = await service.list("company-1");

    expect(created).toEqual(expect.objectContaining({
      id: "goal-1",
      companyId: "company-1",
      title: "Reach coverage target",
    }));
    expect(listed).toEqual([
      expect.objectContaining({
        id: "goal-1",
        companyId: "company-1",
      }),
    ]);
  });

  it("gets, updates, and removes goals", async () => {
    const fixture = createGoalDbMock({
      existing: {
        id: "goal-1",
        companyId: "company-1",
        title: "Reach coverage target",
        status: "active",
      },
    });
    const service = goalService(fixture.db);

    const found = await service.getById("goal-1");
    const updated = await service.update("goal-1", { title: "Reach 60 percent" } as any);
    const removed = await service.remove("goal-1");

    expect(found).toEqual(expect.objectContaining({
      id: "goal-1",
      title: "Reach coverage target",
    }));
    expect(updated).toEqual(expect.objectContaining({
      id: "goal-1",
      title: "Reach 60 percent",
    }));
    expect(removed).toEqual(expect.objectContaining({
      id: "goal-1",
      title: "Reach 60 percent",
    }));
  });
});
