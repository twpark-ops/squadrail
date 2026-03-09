import { describe, expect, it, vi } from "vitest";
import { apiCors } from "../middleware/api-cors.js";

function createRes() {
  const headers = new Map<string, string>();
  return {
    headers,
    statusCode: 200,
    body: null as unknown,
    ended: false,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

describe("apiCors", () => {
  it("allows configured development origins", () => {
    const middleware = apiCors();
    const req = {
      method: "GET",
      header(name: string) {
        if (name.toLowerCase() === "origin") return "http://127.0.0.1:3100";
        if (name.toLowerCase() === "host") return "127.0.0.1:3311";
        return undefined;
      },
    } as any;
    const res = createRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalled();
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3100");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("rejects preflight from untrusted origins", () => {
    const middleware = apiCors();
    const req = {
      method: "OPTIONS",
      header(name: string) {
        if (name.toLowerCase() === "origin") return "https://evil.example.com";
        if (name.toLowerCase() === "host") return "127.0.0.1:3311";
        return undefined;
      },
    } as any;
    const res = createRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Origin is not allowed" });
  });
});
