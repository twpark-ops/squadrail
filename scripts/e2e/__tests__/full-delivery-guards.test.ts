import { describe, expect, it } from "vitest";
import { assertBypassOnlyOnLocalhost } from "../full-delivery-guards.mjs";

describe("full delivery localhost bypass guard", () => {
  it("allows localhost-style base URLs", () => {
    expect(() => assertBypassOnlyOnLocalhost("http://127.0.0.1:3312")).not.toThrow();
    expect(() => assertBypassOnlyOnLocalhost("http://localhost:3312")).not.toThrow();
    expect(() => assertBypassOnlyOnLocalhost("http://[::1]:3312")).not.toThrow();
  });

  it("rejects non-local hosts when bypass mode is requested", () => {
    expect(() => assertBypassOnlyOnLocalhost("http://10.0.0.5:3312")).toThrow(
      /restricted to localhost runs/,
    );
    expect(() => assertBypassOnlyOnLocalhost("https://example.com")).toThrow(
      /restricted to localhost runs/,
    );
  });
});
