import type { RequestHandler } from "express";

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_READ_REQUESTS = 3000;
const DEFAULT_MAX_WRITE_REQUESTS = 300;

type Bucket = {
  count: number;
  resetAt: number;
};

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function resolveClientKey(req: Parameters<RequestHandler>[0]) {
  if (req.actor.type === "board" && req.actor.userId) return `board:${req.actor.userId}`;
  if (req.actor.type === "agent" && req.actor.agentId) return `agent:${req.actor.agentId}`;
  return req.ip || req.socket.remoteAddress || "anonymous";
}

export function apiRateLimit(opts?: {
  windowMs?: number;
  maxReadRequests?: number;
  maxWriteRequests?: number;
  now?: () => number;
}): RequestHandler {
  const windowMs = opts?.windowMs ?? readPositiveIntEnv("SQUADRAIL_RATE_LIMIT_WINDOW_MS", DEFAULT_WINDOW_MS);
  const maxReadRequests =
    opts?.maxReadRequests
    ?? readPositiveIntEnv("SQUADRAIL_RATE_LIMIT_READ_MAX_REQUESTS", DEFAULT_MAX_READ_REQUESTS);
  const maxWriteRequests =
    opts?.maxWriteRequests
    ?? readPositiveIntEnv("SQUADRAIL_RATE_LIMIT_WRITE_MAX_REQUESTS", DEFAULT_MAX_WRITE_REQUESTS);
  const now = opts?.now ?? (() => Date.now());
  const buckets = new Map<string, Bucket>();

  return (req, res, next) => {
    if (req.path === "/health" || req.path.startsWith("/health/")) {
      next();
      return;
    }

    const isReadOnly = req.method === "GET" || req.method === "HEAD";
    const maxRequests = isReadOnly ? maxReadRequests : maxWriteRequests;
    const key = `${resolveClientKey(req)}:${isReadOnly ? "read" : "write"}`;
    const currentTime = now();
    const current = buckets.get(key);
    const bucket =
      current && current.resetAt > currentTime
        ? current
        : { count: 0, resetAt: currentTime + windowMs };

    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, maxRequests - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > maxRequests) {
      res.status(429).json({
        error: "Rate limit exceeded",
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000)),
      });
      return;
    }

    if (buckets.size > 2048) {
      for (const [candidateKey, candidate] of buckets.entries()) {
        if (candidate.resetAt <= currentTime) buckets.delete(candidateKey);
      }
    }

    next();
  };
}
