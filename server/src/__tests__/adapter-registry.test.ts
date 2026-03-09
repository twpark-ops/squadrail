import { describe, expect, it } from "vitest";
import { canDispatchProtocolToAdapter, getServerAdapterCapabilities } from "../adapters/registry.js";

describe("server adapter capabilities", () => {
  it("marks local protocol-capable adapters as dispatchable", () => {
    expect(canDispatchProtocolToAdapter("claude_local")).toBe(true);
    expect(canDispatchProtocolToAdapter("codex_local")).toBe(true);
    expect(canDispatchProtocolToAdapter("cursor")).toBe(true);
    expect(canDispatchProtocolToAdapter("opencode_local")).toBe(true);
  });

  it("keeps non-dispatch adapters disabled", () => {
    expect(canDispatchProtocolToAdapter("process")).toBe(false);
    expect(canDispatchProtocolToAdapter("http")).toBe(false);
    expect(canDispatchProtocolToAdapter("openclaw")).toBe(false);
    expect(canDispatchProtocolToAdapter("missing")).toBe(false);
  });

  it("returns default capabilities for unknown adapters", () => {
    expect(getServerAdapterCapabilities("missing")).toEqual({
      protocolDispatch: false,
    });
  });
});
