import { describe, expect, it } from "vitest";
import { buildMonthlyCostForecast } from "../services/costs.js";

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
});
