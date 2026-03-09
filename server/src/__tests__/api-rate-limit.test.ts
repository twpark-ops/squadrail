import { describe, expect, it, vi } from "vitest";
import { apiRateLimit } from "../middleware/api-rate-limit.js";

function createRes() {
  const headers = new Map<string, string>();
  return {
    headers,
    statusCode: 200,
    body: null as unknown,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe("apiRateLimit", () => {
  it("returns 429 after the write budget is exhausted", () => {
    const middleware = apiRateLimit({
      windowMs: 60_000,
      maxReadRequests: 10,
      maxWriteRequests: 2,
      now: () => 1_000,
    });
    const next = vi.fn();

    const makeReq = () => ({
      path: "/issues",
      method: "POST",
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      actor: {
        type: "board",
        source: "session",
        userId: "board-user",
        isInstanceAdmin: false,
      },
    }) as any;

    const res1 = createRes();
    middleware(makeReq(), res1 as any, next);
    const res2 = createRes();
    middleware(makeReq(), res2 as any, next);
    const blocked = createRes();
    middleware(makeReq(), blocked as any, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toMatchObject({
      error: "Rate limit exceeded",
    });
    expect(blocked.headers.get("x-ratelimit-limit")).toBe("2");
    expect(blocked.headers.get("x-ratelimit-remaining")).toBe("0");
  });

  it("keeps a larger budget for GET polling routes", () => {
    const middleware = apiRateLimit({
      windowMs: 60_000,
      maxReadRequests: 3,
      maxWriteRequests: 1,
      now: () => 1_000,
    });
    const next = vi.fn();

    const makeReq = () => ({
      path: "/issues/abc/live-runs",
      method: "GET",
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      actor: {
        type: "board",
        source: "session",
        userId: "board-user",
        isInstanceAdmin: false,
      },
    }) as any;

    const res1 = createRes();
    middleware(makeReq(), res1 as any, next);
    const res2 = createRes();
    middleware(makeReq(), res2 as any, next);
    const res3 = createRes();
    middleware(makeReq(), res3 as any, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(res3.headers.get("x-ratelimit-limit")).toBe("3");
    expect(res3.headers.get("x-ratelimit-remaining")).toBe("0");
  });
});
