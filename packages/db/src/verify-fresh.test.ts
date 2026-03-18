import { describe, expect, it } from "vitest";
import { parseEnvValue, resolveDatabaseUrlFromSources } from "./verify-fresh.js";

describe("verify-fresh helpers", () => {
  it("parses DATABASE_URL from plain or exported env lines", () => {
    const contents = [
      "# comment",
      "export DATABASE_URL=\"postgres://squadrail:squadrail@localhost:5432/squadrail\"",
      "OTHER_KEY=value",
    ].join("\n");

    expect(parseEnvValue(contents, "DATABASE_URL")).toBe(
      "postgres://squadrail:squadrail@localhost:5432/squadrail",
    );
  });

  it("prefers the live environment value over file candidates", () => {
    expect(
      resolveDatabaseUrlFromSources({
        envValue: "postgres://env/value",
        envFileValues: ["postgres://file/value"],
      }),
    ).toBe("postgres://env/value");
  });

  it("falls back to the first non-empty env-file candidate", () => {
    expect(
      resolveDatabaseUrlFromSources({
        envFileValues: [null, "", "postgres://file/value"],
      }),
    ).toBe("postgres://file/value");
  });

  it("throws when no DATABASE_URL source is available", () => {
    expect(() => resolveDatabaseUrlFromSources({ envFileValues: [null, ""] })).toThrow(
      "DATABASE_URL is required for db:verify-fresh",
    );
  });
});
