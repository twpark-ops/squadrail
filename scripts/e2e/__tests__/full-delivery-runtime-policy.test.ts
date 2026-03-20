import { describe, expect, it } from "vitest";
import {
  classifyFullDeliveryTimeoutAxis,
  resolveFullDeliveryRuntimePolicy,
} from "../full-delivery-runtime-policy.mjs";

describe("resolveFullDeliveryRuntimePolicy", () => {
  it("uses longer default timeouts in CI and supports explicit overrides", () => {
    expect(resolveFullDeliveryRuntimePolicy({ CI: "true" }).e2eTimeoutMs).toBe(15 * 60 * 1000);
    expect(
      resolveFullDeliveryRuntimePolicy({
        E2E_TIMEOUT_MS: "12345",
        E2E_CLOSE_FOLLOWUP_TIMEOUT_MS: "54321",
        E2E_KEEP_TEMP: "1",
      }),
    ).toMatchObject({
      e2eTimeoutMs: 12345,
      closeFollowupTimeoutMs: 54321,
      keepTemp: true,
    });
  });
});

describe("classifyFullDeliveryTimeoutAxis", () => {
  it("maps workflow states to the canonical timeout axes", () => {
    expect(classifyFullDeliveryTimeoutAxis("assigned")).toBe("staffing");
    expect(classifyFullDeliveryTimeoutAxis("implementing")).toBe("implementation");
    expect(classifyFullDeliveryTimeoutAxis("submitted_for_review")).toBe("review");
    expect(classifyFullDeliveryTimeoutAxis("under_qa_review")).toBe("qa");
    expect(classifyFullDeliveryTimeoutAxis("approved")).toBe("closure");
    expect(classifyFullDeliveryTimeoutAxis("mystery")).toBe("unknown");
  });
});
