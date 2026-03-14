import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mergeSquadrailEnvEntries, readSquadrailEnvEntries } from "../config/env.js";

describe("Squadrail env file rendering", () => {
  const cleanupFiles = new Set<string>();

  afterEach(() => {
    for (const filePath of cleanupFiles) {
      fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
    }
    cleanupFiles.clear();
  });

  it("quotes values with special characters so dotenv parsing stays stable", () => {
    const filePath = path.join(
      os.tmpdir(),
      `squadrail-env-file-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ".env",
    );
    cleanupFiles.add(filePath);

    mergeSquadrailEnvEntries(
      {
        SQUADRAIL_BRAND_COLOR: "#0C3C60",
        SQUADRAIL_GREETING: "hello world",
      },
      filePath,
    );

    const raw = fs.readFileSync(filePath, "utf8");
    expect(raw).toContain('SQUADRAIL_BRAND_COLOR="#0C3C60"');
    expect(raw).toContain('SQUADRAIL_GREETING="hello world"');

    const values = readSquadrailEnvEntries(filePath);
    expect(values.SQUADRAIL_BRAND_COLOR).toBe("#0C3C60");
    expect(values.SQUADRAIL_GREETING).toBe("hello world");
  });
});
