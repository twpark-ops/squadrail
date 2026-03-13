import { describe, expect, it } from "vitest";
import * as middleware from "../middleware/index.js";
import * as routes from "../routes/index.js";

describe("barrel exports", () => {
  it("re-exports middleware helpers", () => {
    expect(middleware).toEqual(expect.objectContaining({
      errorHandler: expect.any(Function),
      httpLogger: expect.any(Function),
      logger: expect.any(Object),
      validate: expect.any(Function),
    }));
  });

  it("re-exports route factories", () => {
    expect(routes).toEqual(expect.objectContaining({
      accessRoutes: expect.any(Function),
      activityRoutes: expect.any(Function),
      agentRoutes: expect.any(Function),
      approvalRoutes: expect.any(Function),
      companyRoutes: expect.any(Function),
      costRoutes: expect.any(Function),
      dashboardRoutes: expect.any(Function),
      goalRoutes: expect.any(Function),
      healthRoutes: expect.any(Function),
      issueRoutes: expect.any(Function),
      llmRoutes: expect.any(Function),
      projectRoutes: expect.any(Function),
      secretRoutes: expect.any(Function),
      sidebarBadgeRoutes: expect.any(Function),
    }));
  });
});
