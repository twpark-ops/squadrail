import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { healthRoutes } from "../routes/health.js";

describe("GET /health", () => {
  const app = express();
  app.use("/health", healthRoutes());

  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("reports authenticated bootstrap state when instance admins are missing", async () => {
    const chain = {
      from: () => chain,
      where: () => chain,
      then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve([{ count: 0 }]).then(resolve),
    };
    const db = {
      select: () => chain,
    };
    const authenticatedApp = express();
    authenticatedApp.use("/health", healthRoutes(db as never, {
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      authReady: false,
      companyDeletionEnabled: false,
    }));

    const res = await request(authenticatedApp).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      authReady: false,
      bootstrapStatus: "bootstrap_pending",
      features: {
        companyDeletionEnabled: false,
      },
    });
  });
});
