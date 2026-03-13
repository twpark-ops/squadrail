import { describe, expect, it } from "vitest";
import { REDACTED_EVENT_VALUE } from "../redaction.js";
import {
  buildConfigSnapshot,
  configPatchFromSnapshot,
  containsRedactedMarker,
  diffConfigSnapshot,
  hasConfigPatchFields,
} from "../services/agents.js";

describe("agent service helper exports", () => {
  it("builds redacted config snapshots and detects changed keys", () => {
    const before = buildConfigSnapshot({
      name: "Runtime Captain",
      role: "engineer",
      title: "Captain",
      reportsTo: null,
      capabilities: "Builds things",
      adapterType: "codex_local",
      adapterConfig: {
        cwd: "/workspace/runtime",
        apiKey: "secret-key",
      },
      runtimeConfig: {
        authToken: "jwt-token",
      },
      budgetMonthlyCents: 1200,
      metadata: {
        authorization: "Bearer abc",
        safe: true,
      },
    } as never);
    const after = {
      ...before,
      title: "Senior Captain",
      runtimeConfig: {
        authToken: REDACTED_EVENT_VALUE,
        extra: true,
      },
    };

    expect(before.adapterConfig).toEqual({
      cwd: "/workspace/runtime",
      apiKey: REDACTED_EVENT_VALUE,
    });
    expect(before.runtimeConfig).toEqual({
      authToken: REDACTED_EVENT_VALUE,
    });
    expect(before.metadata).toEqual({
      authorization: REDACTED_EVENT_VALUE,
      safe: true,
    });
    expect(diffConfigSnapshot(before, after)).toEqual(["title", "runtimeConfig"]);
    expect(containsRedactedMarker(after)).toBe(true);
  });

  it("identifies config patches and validates revision snapshots", () => {
    expect(hasConfigPatchFields({ status: "idle" } as never)).toBe(false);
    expect(hasConfigPatchFields({ adapterConfig: { cwd: "/workspace/runtime" } } as never)).toBe(true);
    expect(configPatchFromSnapshot({
      name: "Runtime Captain",
      role: "engineer",
      title: "Captain",
      reportsTo: null,
      capabilities: "Builds things",
      adapterType: "codex_local",
      adapterConfig: { cwd: "/workspace/runtime" },
      runtimeConfig: { verbose: true },
      budgetMonthlyCents: 1550.9,
      metadata: { safe: true },
    })).toEqual({
      name: "Runtime Captain",
      role: "engineer",
      title: "Captain",
      reportsTo: null,
      capabilities: "Builds things",
      adapterType: "codex_local",
      adapterConfig: { cwd: "/workspace/runtime" },
      runtimeConfig: { verbose: true },
      budgetMonthlyCents: 1550,
      metadata: { safe: true },
    });
    expect(() => configPatchFromSnapshot({ role: "engineer" })).toThrow("Invalid revision snapshot: name");
  });
});
