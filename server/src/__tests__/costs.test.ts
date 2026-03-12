import { agents, companies, costEvents } from "@squadrail/db";
import { describe, expect, it } from "vitest";
import { buildMonthlyCostForecast, costService } from "../services/costs.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    as: () => rows,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createCostDbMock(input: {
  selectResults?: unknown[][];
  insertResults?: unknown[][];
  updateResults?: unknown[][];
}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const insertQueue = [...(input.insertResults ?? [])];
  const updateQueue = [...(input.updateResults ?? [])];
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];

  return {
    db: {
      select: () => createResolvedChain(selectQueue.shift() ?? []),
      selectDistinctOn: () => createResolvedChain(selectQueue.shift() ?? []),
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
          const chain = {
            where: async () => updateQueue.shift() ?? [],
            returning: async () => updateQueue.shift() ?? [],
          };
          return chain;
        },
      }),
    },
    insertValues,
    updateSets,
  };
}

describe("cost forecast", () => {
  it("projects month-end spend from current monthly pace", () => {
    const forecast = buildMonthlyCostForecast({
      spendCentsToDate: 15_000,
      budgetCents: 40_000,
      now: new Date("2026-03-15T12:00:00.000Z"),
    });

    expect(forecast.elapsedDays).toBe(15);
    expect(forecast.totalDays).toBe(31);
    expect(forecast.projectedSpendCents).toBe(31_000);
    expect(forecast.projectedUtilizationPercent).toBe(77.5);
    expect(forecast.status).toBe("on_track");
  });

  it("marks forecasts over budget when the projected month exceeds the cap", () => {
    const forecast = buildMonthlyCostForecast({
      spendCentsToDate: 45_000,
      budgetCents: 50_000,
      now: new Date("2026-03-20T12:00:00.000Z"),
    });

    expect(forecast.projectedSpendCents).toBeGreaterThan(50_000);
    expect(forecast.status).toBe("over_budget");
  });

  it("returns unbounded when no monthly budget is configured", () => {
    const forecast = buildMonthlyCostForecast({
      spendCentsToDate: 12_000,
      budgetCents: 0,
      now: new Date("2026-03-10T12:00:00.000Z"),
    });

    expect(forecast.projectedUtilizationPercent).toBe(0);
    expect(forecast.status).toBe("unbounded");
  });

  it("builds summary payloads from persisted company and event spend", async () => {
    const { db } = createCostDbMock({
      selectResults: [
        [{
          id: "company-1",
          budgetMonthlyCents: 40_000,
        }],
        [{
          total: 12_500,
        }],
        [{
          monthTotal: 10_000,
        }],
      ],
    });
    const service = costService(db as never);

    const summary = await service.summary("company-1");

    expect(summary).toMatchObject({
      companyId: "company-1",
      spendCents: 12_500,
      budgetCents: 40_000,
      utilizationPercent: 31.25,
      monthlyForecast: expect.objectContaining({
        projectedSpendCents: expect.any(Number),
      }),
    });
  });

  it("records cost events, updates company spend, and pauses over-budget agents", async () => {
    const { db, insertValues, updateSets } = createCostDbMock({
      selectResults: [
        [{
          id: "agent-1",
          companyId: "company-1",
          budgetMonthlyCents: 1_000,
          spentMonthlyCents: 900,
          status: "active",
        }],
        [{
          id: "agent-1",
          companyId: "company-1",
          budgetMonthlyCents: 1_000,
          spentMonthlyCents: 1_100,
          status: "active",
        }],
      ],
      insertResults: [[{
        id: "event-1",
        companyId: "company-1",
        agentId: "agent-1",
        costCents: 200,
      }]],
    });
    const service = costService(db as never);

    const event = await service.createEvent("company-1", {
      agentId: "agent-1",
      projectId: null,
      issueId: null,
      source: "usage_report",
      model: "gpt-5",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: "2.00",
      costCents: 200,
      occurredAt: new Date("2026-03-13T12:00:00.000Z"),
      metadata: { source: "test" },
    });

    expect(event).toMatchObject({
      id: "event-1",
      companyId: "company-1",
      agentId: "agent-1",
      costCents: 200,
    });
    expect(insertValues).toContainEqual({
      table: costEvents,
      value: expect.objectContaining({
        companyId: "company-1",
        agentId: "agent-1",
        costCents: 200,
      }),
    });
    expect(updateSets).toContainEqual({
      table: agents,
      value: expect.objectContaining({
        updatedAt: expect.any(Date),
      }),
    });
    expect(updateSets).toContainEqual({
      table: companies,
      value: expect.objectContaining({
        updatedAt: expect.any(Date),
      }),
    });
    expect(updateSets).toContainEqual({
      table: agents,
      value: expect.objectContaining({
        status: "paused",
        updatedAt: expect.any(Date),
      }),
    });
  });

  it("rejects cost events for agents that belong to another company", async () => {
    const { db } = createCostDbMock({
      selectResults: [[{
        id: "agent-1",
        companyId: "company-2",
        budgetMonthlyCents: 0,
        spentMonthlyCents: 0,
        status: "active",
      }]],
    });
    const service = costService(db as never);

    await expect(
      service.createEvent("company-1", {
        agentId: "agent-1",
        projectId: null,
        issueId: null,
        source: "usage_report",
        model: "gpt-5",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: "2.00",
        costCents: 200,
        occurredAt: new Date("2026-03-13T12:00:00.000Z"),
        metadata: null,
      }),
    ).rejects.toThrow("Agent does not belong to company");
  });

  it("merges cost rows with heartbeat usage counts in byAgent summaries", async () => {
    const { db } = createCostDbMock({
      selectResults: [
        [
          {
            agentId: "agent-1",
            agentName: "Engineer One",
            agentStatus: "active",
            costCents: 2_500,
            inputTokens: 1_000,
            outputTokens: 500,
          },
          {
            agentId: "agent-2",
            agentName: "Reviewer Two",
            agentStatus: "active",
            costCents: 900,
            inputTokens: 400,
            outputTokens: 120,
          },
        ],
        [
          {
            agentId: "agent-1",
            apiRunCount: 2,
            subscriptionRunCount: 1,
            subscriptionInputTokens: 800,
            subscriptionOutputTokens: 300,
          },
        ],
      ],
    });
    const service = costService(db as never);

    const result = await service.byAgent("company-1");

    expect(result).toEqual([
      {
        agentId: "agent-1",
        agentName: "Engineer One",
        agentStatus: "active",
        costCents: 2_500,
        inputTokens: 1_000,
        outputTokens: 500,
        apiRunCount: 2,
        subscriptionRunCount: 1,
        subscriptionInputTokens: 800,
        subscriptionOutputTokens: 300,
      },
      {
        agentId: "agent-2",
        agentName: "Reviewer Two",
        agentStatus: "active",
        costCents: 900,
        inputTokens: 400,
        outputTokens: 120,
        apiRunCount: 0,
        subscriptionRunCount: 0,
        subscriptionInputTokens: 0,
        subscriptionOutputTokens: 0,
      },
    ]);
  });

  it("returns project usage summaries from heartbeat-linked rows", async () => {
    const { db } = createCostDbMock({
      selectResults: [
        [{
          runId: "run-1",
          projectId: "project-1",
        }],
        [{
          projectId: "project-1",
          projectName: "Swiftsight Cloud",
          costCents: 3_400,
          inputTokens: 2_000,
          outputTokens: 700,
        }],
      ],
    });
    const service = costService(db as never);

    const result = await service.byProject("company-1");

    expect(result).toEqual([
      {
        projectId: "project-1",
        projectName: "Swiftsight Cloud",
        costCents: 3_400,
        inputTokens: 2_000,
        outputTokens: 700,
      },
    ]);
  });
});
