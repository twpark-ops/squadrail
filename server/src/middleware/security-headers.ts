import type { RequestHandler } from "express";

type UiMode = "none" | "static" | "vite-dev";

function isHttpsRequest(forwardedProto: string | null | undefined) {
  if (!forwardedProto) return false;
  const normalized = forwardedProto.split(",")[0]?.trim().toLowerCase();
  return normalized === "https";
}

export function buildContentSecurityPolicy(uiMode: UiMode) {
  const sharedDirectives = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
  ];

  if (uiMode === "vite-dev") {
    return [
      ...sharedDirectives,
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' http: https: ws: wss:",
    ].join("; ");
  }

  return [
    ...sharedDirectives,
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https: wss:",
  ].join("; ");
}

export function buildSecurityHeaders(input: {
  uiMode: UiMode;
  forwardedProto?: string | null;
}) {
  const headers: Record<string, string> = {
    "Content-Security-Policy": buildContentSecurityPolicy(input.uiMode),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Origin-Agent-Cluster": "?1",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };

  if (isHttpsRequest(input.forwardedProto)) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }

  return headers;
}

export function securityHeaders(input: { uiMode: UiMode }): RequestHandler {
  return (req, res, next) => {
    const forwardedProtoHeader = req.header("x-forwarded-proto");
    const headers = buildSecurityHeaders({
      uiMode: input.uiMode,
      forwardedProto: typeof forwardedProtoHeader === "string" ? forwardedProtoHeader : null,
    });
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
    next();
  };
}
