import { describe, expect, it } from "vitest";

import {
  computeRateLimitRetryDelayMs,
  extractRetryAfterSeconds,
  isMissingMergeCandidateError,
} from "../e2e-api-utils.mjs";

describe("e2e-api-utils", () => {
  it("reads retryAfterSeconds from JSON bodies", () => {
    expect(extractRetryAfterSeconds({ retryAfterSeconds: 2 })).toBe(2);
    expect(extractRetryAfterSeconds({ retryAfterSeconds: -1 })).toBeNull();
    expect(extractRetryAfterSeconds("oops")).toBeNull();
  });

  it("uses retryAfterSeconds when computing rate-limit delay", () => {
    expect(
      computeRateLimitRetryDelayMs({
        status: 429,
        body: { retryAfterSeconds: 2 },
        attempt: 0,
      }),
    ).toBe(2000);
  });

  it("falls back to exponential backoff when retryAfterSeconds is missing", () => {
    expect(
      computeRateLimitRetryDelayMs({
        status: 429,
        body: {},
        attempt: 0,
      }),
    ).toBe(500);
    expect(
      computeRateLimitRetryDelayMs({
        status: 429,
        body: {},
        attempt: 2,
      }),
    ).toBe(2000);
  });

  it("detects missing merge candidate errors", () => {
    expect(isMissingMergeCandidateError(new Error("Issue has no merge candidate"))).toBe(true);
    expect(isMissingMergeCandidateError(new Error("Merge candidate not found"))).toBe(true);
    expect(isMissingMergeCandidateError(new Error("Different error"))).toBe(false);
  });
});
