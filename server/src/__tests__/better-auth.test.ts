import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBetterAuth, mockDrizzleAdapter, mockToNodeHandler } = vi.hoisted(() => ({
  mockBetterAuth: vi.fn(),
  mockDrizzleAdapter: vi.fn(),
  mockToNodeHandler: vi.fn(),
}));

vi.mock("better-auth", () => ({
  betterAuth: mockBetterAuth,
}));

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: mockDrizzleAdapter,
}));

vi.mock("better-auth/node", () => ({
  toNodeHandler: mockToNodeHandler,
}));

import { createBetterAuthHandler, createBetterAuthInstance, resolveBetterAuthSession, resolveBetterAuthSessionFromHeaders } from "../auth/better-auth.js";

describe("better auth helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.SQUADRAIL_AGENT_JWT_SECRET;
    mockBetterAuth.mockImplementation((config: unknown) => ({ config }));
    mockDrizzleAdapter.mockReturnValue({ kind: "drizzle-adapter" });
  });

  it("builds an auth instance with explicit public base url and secret", () => {
    process.env.BETTER_AUTH_SECRET = "explicit-secret";

    const auth = createBetterAuthInstance({ kind: "db" } as never, {
      authBaseUrlMode: "explicit",
      authPublicBaseUrl: "https://squadrail.example.com",
      authRequireEmailVerification: true,
    } as never);

    expect(mockDrizzleAdapter).toHaveBeenCalledWith(
      { kind: "db" },
      expect.objectContaining({
        provider: "pg",
        schema: expect.any(Object),
      }),
    );
    expect(mockBetterAuth).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: "https://squadrail.example.com",
      secret: "explicit-secret",
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
      },
    }));
    expect(auth).toEqual(expect.objectContaining({
      config: expect.objectContaining({
        baseURL: "https://squadrail.example.com",
      }),
    }));
  });

  it("omits baseURL when auth base url mode is not explicit and falls back to managed jwt secret", () => {
    process.env.SQUADRAIL_AGENT_JWT_SECRET = "managed-secret";

    createBetterAuthInstance({ kind: "db" } as never, {
      authBaseUrlMode: "auto",
      authPublicBaseUrl: "https://ignored.example.com",
      authRequireEmailVerification: false,
    } as never);

    expect(mockBetterAuth).toHaveBeenCalledWith(expect.objectContaining({
      secret: "managed-secret",
    }));
    const authConfig = mockBetterAuth.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("baseURL" in authConfig).toBe(false);
  });

  it("throws when better-auth secret is missing", () => {
    expect(() => createBetterAuthInstance({ kind: "db" } as never, {
      authBaseUrlMode: "auto",
      authPublicBaseUrl: undefined,
      authRequireEmailVerification: false,
    } as never)).toThrow(/BETTER_AUTH_SECRET/i);
  });

  it("wraps the node handler and forwards async failures to next", async () => {
    const boom = new Error("boom");
    mockToNodeHandler.mockReturnValue(() => Promise.reject(boom));
    const auth = { kind: "auth" } as never;
    const handler = createBetterAuthHandler(auth);
    const next = vi.fn();

    handler({} as never, {} as never, next);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockToNodeHandler).toHaveBeenCalledWith(auth);
    expect(next).toHaveBeenCalledWith(boom);
  });

  it("normalizes resolved session payloads from auth headers", async () => {
    const headers = new Headers({
      authorization: "Bearer token",
    });
    const auth = {
      api: {
        getSession: vi.fn().mockResolvedValue({
          session: { id: "session-1", userId: "user-1" },
          user: { id: "user-1", email: "user@example.com", name: "User One" },
        }),
      },
    } as never;

    const session = await resolveBetterAuthSessionFromHeaders(auth, headers);

    expect(session).toEqual({
      session: { id: "session-1", userId: "user-1" },
      user: { id: "user-1", email: "user@example.com", name: "User One" },
    });
  });

  it("returns null when auth api is missing or the payload is incomplete", async () => {
    await expect(resolveBetterAuthSessionFromHeaders({} as never, new Headers())).resolves.toBeNull();
    await expect(resolveBetterAuthSessionFromHeaders({
      api: {
        getSession: vi.fn().mockResolvedValue({
          session: { id: "session-1", userId: "user-1" },
          user: null,
        }),
      },
    } as never, new Headers())).resolves.toBeNull();
  });

  it("builds headers from express requests when resolving sessions", async () => {
    const getSession = vi.fn().mockResolvedValue({
      session: { id: "session-1", userId: "user-1" },
      user: { id: "user-1", email: null, name: "Board User" },
    });

    const session = await resolveBetterAuthSession({
      api: { getSession },
    } as never, {
      headers: {
        authorization: "Bearer abc",
        "x-forwarded-host": ["squadrail.example.com", "proxy.example.com"],
      },
    } as never);

    expect(session).toEqual({
      session: { id: "session-1", userId: "user-1" },
      user: { id: "user-1", email: null, name: "Board User" },
    });
    const passedHeaders = getSession.mock.calls[0]?.[0]?.headers as Headers;
    expect(passedHeaders.get("authorization")).toBe("Bearer abc");
    expect(passedHeaders.get("x-forwarded-host")).toBe("squadrail.example.com, proxy.example.com");
  });
});
