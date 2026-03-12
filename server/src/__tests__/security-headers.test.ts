import { describe, expect, it, vi } from "vitest";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  securityHeaders,
} from "../middleware/security-headers.js";

function createRes() {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
  };
}

describe("security headers middleware", () => {
  it("builds a tighter CSP for static UI mode", () => {
    const csp = buildContentSecurityPolicy("static");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self' https: wss:");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("relaxes CSP for vite dev middleware and adds HSTS only on https", () => {
    const headers = buildSecurityHeaders({
      uiMode: "vite-dev",
      forwardedProto: "https",
    });
    expect(headers["Content-Security-Policy"]).toContain("'unsafe-eval'");
    expect(headers["Content-Security-Policy"]).toContain("ws:");
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");

    const httpHeaders = buildSecurityHeaders({
      uiMode: "none",
      forwardedProto: "http",
    });
    expect(httpHeaders["Strict-Transport-Security"]).toBeUndefined();
  });

  it("writes the configured headers onto the response", () => {
    const middleware = securityHeaders({ uiMode: "none" });
    const req = {
      header(name: string) {
        return name.toLowerCase() === "x-forwarded-proto" ? "https" : undefined;
      },
    } as any;
    const res = createRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalled();
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  });
});
