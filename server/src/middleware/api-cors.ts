import type { Request, RequestHandler } from "express";

const DEFAULT_DEV_ORIGINS = [
  "http://localhost:3100",
  "http://127.0.0.1:3100",
];

function normalizeOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function parseConfiguredOrigins() {
  return (process.env.SQUADRAIL_ALLOWED_ORIGINS ?? "")
    .split(/[,\s]+/)
    .map((entry) => normalizeOrigin(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function resolveAllowedOrigins(req: Request) {
  const allowed = new Set<string>(DEFAULT_DEV_ORIGINS.map((entry) => entry.toLowerCase()));
  for (const configured of parseConfiguredOrigins()) allowed.add(configured);
  const host = req.header("host")?.trim().toLowerCase();
  if (host) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }
  return allowed;
}

function applyCorsHeaders(res: Parameters<RequestHandler>[1], origin: string) {
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Squadrail-Run-Id",
  );
}

export function apiCors(): RequestHandler {
  return (req, res, next) => {
    const origin = normalizeOrigin(req.header("origin"));
    const allowedOrigins = resolveAllowedOrigins(req);
    const originAllowed = origin ? allowedOrigins.has(origin) : false;

    if (origin && originAllowed) {
      applyCorsHeaders(res, origin);
    }

    if (req.method.toUpperCase() === "OPTIONS") {
      if (origin && !originAllowed) {
        res.status(403).json({ error: "Origin is not allowed" });
        return;
      }
      if (origin && originAllowed) applyCorsHeaders(res, origin);
      res.status(204).end();
      return;
    }

    next();
  };
}
