import { afterEach, describe, expect, it } from "vitest";
import {
  listCursorModels,
  parseCursorModelsOutput,
  resetCursorModelsCacheForTests,
  setCursorModelsRunnerForTests,
} from "../adapters/cursor-models.js";

describe("cursor models adapter helpers", () => {
  afterEach(() => {
    resetCursorModelsCacheForTests();
    setCursorModelsRunnerForTests(null);
  });

  it("parses JSON, available-model lines, and bullet output into unique model rows", () => {
    const parsed = parseCursorModelsOutput(
      JSON.stringify({
        models: [{ id: "\"gpt-5\"" }, { id: "claude-sonnet-4" }],
      }),
      [
        "available models: gpt-5, claude-sonnet-4, gpt-5",
        "- o3-mini",
        "- invalid model name",
      ].join("\n"),
    );

    expect(parsed).toEqual([
      { id: "gpt-5", label: "gpt-5" },
      { id: "claude-sonnet-4", label: "claude-sonnet-4" },
      { id: "o3-mini", label: "o3-mini" },
    ]);
  });

  it("caches discovered CLI models and falls back gracefully when the CLI later fails", async () => {
    let calls = 0;
    setCursorModelsRunnerForTests(() => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 0,
          stdout: JSON.stringify(["gpt-5", "claude-sonnet-4"]),
          stderr: "",
          hasError: false,
        };
      }
      return {
        status: 1,
        stdout: "",
        stderr: "",
        hasError: true,
      };
    });

    const first = await listCursorModels();
    const second = await listCursorModels();

    expect(first).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "gpt-5" }),
      expect.objectContaining({ id: "claude-sonnet-4" }),
    ]));
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });

  it("falls back to bundled models when discovery returns no usable output", async () => {
    setCursorModelsRunnerForTests(() => ({
      status: 1,
      stdout: "",
      stderr: "failed to list models",
      hasError: true,
    }));

    const models = await listCursorModels();

    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => typeof model.id === "string" && model.id.length > 0)).toBe(true);
  });
});
