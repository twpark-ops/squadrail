import { afterEach, describe, expect, it, vi } from "vitest";
import { testEnvironment } from "../adapters/http/test.js";

describe("http adapter environment test", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails when the adapter url is missing", async () => {
    const result = await testEnvironment({
      adapterType: "http",
      config: {},
    } as never);

    expect(result.status).toBe("fail");
    expect(result.checks).toEqual([
      expect.objectContaining({
        code: "http_url_missing",
        level: "error",
      }),
    ]);
  });

  it("fails on invalid urls and protocols before probing", async () => {
    const invalidUrl = await testEnvironment({
      adapterType: "http",
      config: {
        url: "not a url",
      },
    } as never);
    const invalidProtocol = await testEnvironment({
      adapterType: "http",
      config: {
        url: "ftp://example.com/adapter",
      },
    } as never);

    expect(invalidUrl.status).toBe("fail");
    expect(invalidUrl.checks.some((check) => check.code === "http_url_invalid")).toBe(true);
    expect(invalidProtocol.status).toBe("fail");
    expect(invalidProtocol.checks.some((check) => check.code === "http_url_protocol_invalid")).toBe(true);
  });

  it("passes when a valid endpoint answers the probe", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    }));

    const result = await testEnvironment({
      adapterType: "http",
      config: {
        url: "https://example.com/adapter",
        method: " patch ",
      },
    } as never);

    expect(result.status).toBe("pass");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "http_url_valid",
          message: "Configured endpoint: https://example.com/adapter",
        }),
        expect.objectContaining({
          code: "http_method_configured",
          message: "Configured method: PATCH",
        }),
        expect.objectContaining({
          code: "http_endpoint_probe_ok",
          level: "info",
        }),
      ]),
    );
  });

  it("warns when the endpoint probe fails or returns an unexpected status", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
      })
      .mockRejectedValueOnce(new Error("network blocked")));

    const unexpected = await testEnvironment({
      adapterType: "http",
      config: {
        url: "https://example.com/adapter",
      },
    } as never);
    const failed = await testEnvironment({
      adapterType: "http",
      config: {
        url: "https://example.com/adapter",
      },
    } as never);

    expect(unexpected.status).toBe("warn");
    expect(unexpected.checks.some((check) => check.code === "http_endpoint_probe_unexpected_status")).toBe(true);
    expect(failed.status).toBe("warn");
    expect(failed.checks.some((check) => check.code === "http_endpoint_probe_failed")).toBe(true);
  });
});
