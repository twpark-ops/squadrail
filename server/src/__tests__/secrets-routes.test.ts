import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListProviders,
  mockListSecrets,
  mockGetSecretById,
  mockCreateSecret,
  mockRotateSecret,
  mockUpdateSecret,
  mockRemoveSecret,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockListProviders: vi.fn(),
  mockListSecrets: vi.fn(),
  mockGetSecretById: vi.fn(),
  mockCreateSecret: vi.fn(),
  mockRotateSecret: vi.fn(),
  mockUpdateSecret: vi.fn(),
  mockRemoveSecret: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  logActivity: mockLogActivity,
  secretService: () => ({
    listProviders: mockListProviders,
    list: mockListSecrets,
    getById: mockGetSecretById,
    create: mockCreateSecret,
    rotate: mockRotateSecret,
    update: mockUpdateSecret,
    remove: mockRemoveSecret,
  }),
}));

import { secretRoutes } from "../routes/secrets.js";

function buildBoardActor() {
  return {
    type: "board" as const,
    source: "local_implicit" as const,
    isInstanceAdmin: true,
    userId: "user-1",
    companyIds: ["company-1"],
    runId: null,
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = buildBoardActor();
    next();
  });
  app.use(secretRoutes({} as never));
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Unhandled error" });
  });
  return app;
}

describe("secret routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SQUADRAIL_SECRETS_PROVIDER;
  });

  it("lists configured secret providers", async () => {
    mockListProviders.mockReturnValue([
      { provider: "local_encrypted", label: "Local encrypted" },
      { provider: "aws_secrets_manager", label: "AWS Secrets Manager" },
    ]);
    const app = createApp();

    const response = await request(app).get("/companies/company-1/secret-providers");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({ provider: "local_encrypted" }),
      expect.objectContaining({ provider: "aws_secrets_manager" }),
    ]);
  });

  it("falls back to local encrypted storage when the default provider env is invalid", async () => {
    process.env.SQUADRAIL_SECRETS_PROVIDER = "invalid-provider";
    mockCreateSecret.mockResolvedValue({
      id: "secret-1",
      companyId: "company-1",
      name: "OPENAI_API_KEY",
      provider: "local_encrypted",
    });
    const app = createApp();

    const response = await request(app)
      .post("/companies/company-1/secrets")
      .send({
        name: "OPENAI_API_KEY",
        value: "secret-value",
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: "secret-1",
      provider: "local_encrypted",
    });
    expect(mockCreateSecret).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        name: "OPENAI_API_KEY",
        provider: "local_encrypted",
        value: "secret-value",
      }),
      { userId: "user-1", agentId: null },
    );
  });

  it("returns 404 when rotating an unknown secret", async () => {
    mockGetSecretById.mockResolvedValue(null);
    const app = createApp();

    const response = await request(app)
      .post("/secrets/secret-missing/rotate")
      .send({
        value: "next-secret",
      });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: "Secret not found",
    });
    expect(mockRotateSecret).not.toHaveBeenCalled();
  });

  it("updates secret metadata and returns the persisted record", async () => {
    mockGetSecretById.mockResolvedValue({
      id: "secret-1",
      companyId: "company-1",
      name: "OPENAI_API_KEY",
    });
    mockUpdateSecret.mockResolvedValue({
      id: "secret-1",
      companyId: "company-1",
      name: "OPENAI_API_KEY",
      description: "Primary provider credential",
    });
    const app = createApp();

    const response = await request(app)
      .patch("/secrets/secret-1")
      .send({
        description: "Primary provider credential",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: "secret-1",
      description: "Primary provider credential",
    });
    expect(mockUpdateSecret).toHaveBeenCalledWith("secret-1", {
      name: undefined,
      description: "Primary provider credential",
      externalRef: undefined,
    });
  });

  it("deletes an existing secret and returns an ok envelope", async () => {
    mockGetSecretById.mockResolvedValue({
      id: "secret-1",
      companyId: "company-1",
      name: "OPENAI_API_KEY",
    });
    mockRemoveSecret.mockResolvedValue({
      id: "secret-1",
      companyId: "company-1",
      name: "OPENAI_API_KEY",
    });
    const app = createApp();

    const response = await request(app).delete("/secrets/secret-1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(mockRemoveSecret).toHaveBeenCalledWith("secret-1");
  });
});
