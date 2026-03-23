export function extractRetryAfterSeconds(body) {
  if (!body || typeof body !== "object") return null;
  const candidate = body.retryAfterSeconds;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) return null;
  return candidate;
}

export function computeRateLimitRetryDelayMs(input) {
  if (input.status !== 429) return 0;
  const retryAfterSeconds = extractRetryAfterSeconds(input.body);
  if (retryAfterSeconds !== null) {
    return Math.max(250, Math.round(retryAfterSeconds * 1000));
  }
  const attempt = Math.max(0, input.attempt ?? 0);
  const baseDelayMs = Math.max(250, input.baseDelayMs ?? 500);
  return baseDelayMs * (2 ** attempt);
}

export function isMissingMergeCandidateError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Issue has no merge candidate")
    || message.includes("Merge candidate not found");
}
