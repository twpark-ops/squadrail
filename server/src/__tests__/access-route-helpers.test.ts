import { describe, expect, it } from "vitest";
import {
  buildOnboardingDiscoveryDiagnostics,
  buildInviteOnboardingManifest,
  buildInviteOnboardingTextDocument,
  buildJoinConnectivityDiagnostics,
  grantsFromDefaults,
  isLoopbackHost,
  normalizeAgentDefaultsForJoin,
  normalizeHeaderMap,
  normalizeHostname,
  requestBaseUrl,
  toInviteSummaryResponse,
} from "../routes/access.js";

function createRequest(overrides?: {
  protocol?: string;
  headers?: Record<string, string | undefined>;
}) {
  const headers = overrides?.headers ?? {};
  return {
    protocol: overrides?.protocol ?? "http",
    header(name: string) {
      return headers[name.toLowerCase()] ?? headers[name] ?? undefined;
    },
  } as any;
}

function createInvite(overrides?: Record<string, unknown>) {
  return {
    id: "invite-1",
    companyId: "company-1",
    inviteType: "company_join",
    allowedJoinTypes: "agent",
    defaultsPayload: null,
    invitedByUserId: "user-1",
    acceptedAt: null,
    revokedAt: null,
    expiresAt: new Date("2026-03-20T00:00:00.000Z"),
    createdAt: new Date("2026-03-13T00:00:00.000Z"),
    updatedAt: new Date("2026-03-13T00:00:00.000Z"),
    ...overrides,
  } as any;
}

describe("access route helpers", () => {
  it("normalizes request urls, hostnames, and header maps", () => {
    const req = createRequest({
      protocol: "http",
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "squadrail.example.com",
      },
    });

    expect(requestBaseUrl(req)).toBe("https://squadrail.example.com");
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(normalizeHostname("[::1]:3000")).toBe("::1");
    expect(normalizeHostname("Squadrail.EXAMPLE.com:443")).toBe("squadrail.example.com");
    expect(normalizeHostname("")).toBeNull();
    expect(normalizeHeaderMap({
      " x-api-key ": " secret ",
      empty: "   ",
      invalid: 3,
    })).toEqual({
      "x-api-key": "secret",
    });
  });

  it("produces join connectivity diagnostics for private and public exposure mismatches", () => {
    const privateDiagnostics = buildJoinConnectivityDiagnostics({
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
      callbackUrl: new URL("https://agent.internal.example/webhook"),
    });
    const publicDiagnostics = buildJoinConnectivityDiagnostics({
      deploymentMode: "authenticated",
      deploymentExposure: "public",
      bindHost: "0.0.0.0",
      allowedHostnames: ["agent.internal.example"],
      callbackUrl: new URL("http://public.example/webhook"),
    });

    expect(privateDiagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "openclaw_deployment_context",
      "openclaw_private_bind_loopback",
      "openclaw_private_allowed_hostnames_empty",
    ]));
    expect(publicDiagnostics.map((entry) => entry.code)).toContain("openclaw_public_http_callback");
  });

  it("normalizes openclaw defaults and falls back cleanly for non-openclaw adapters", () => {
    const generic = normalizeAgentDefaultsForJoin({
      adapterType: "codex_local",
      defaultsPayload: { cwd: "/workspace/project" },
      deploymentMode: "local_trusted",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    });
    const openclaw = normalizeAgentDefaultsForJoin({
      adapterType: "openclaw",
      defaultsPayload: {
        url: "https://claw.example.com/webhook",
        method: "patch",
        timeoutSec: 500,
        headers: {
          Authorization: "Bearer token",
          ignored: " ",
        },
        webhookAuthHeader: "x-openclaw-auth",
        payloadTemplate: {
          runId: "{{run.id}}",
        },
      },
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "squadrail.internal",
      allowedHostnames: ["squadrail.internal"],
    });

    expect(generic).toEqual({
      normalized: { cwd: "/workspace/project" },
      diagnostics: [],
    });
    expect(openclaw.normalized).toEqual(expect.objectContaining({
      url: "https://claw.example.com/webhook",
      method: "PATCH",
      timeoutSec: 120,
      headers: {
        Authorization: "Bearer token",
      },
      webhookAuthHeader: "x-openclaw-auth",
      payloadTemplate: {
        runId: "{{run.id}}",
      },
    }));
    expect(openclaw.diagnostics.map((entry) => entry.code)).toContain("openclaw_callback_url_configured");
  });

  it("builds invite manifests and text onboarding documents with discovery diagnostics", () => {
    const req = createRequest({
      protocol: "http",
      headers: {
        host: "localhost:3144",
      },
    });
    const invite = createInvite({ allowedJoinTypes: "both" });

    const summary = toInviteSummaryResponse(req, "token-1", invite);
    const manifest = buildInviteOnboardingManifest(req, "token-1", invite, {
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    });
    const text = buildInviteOnboardingTextDocument(req, "token-1", invite, {
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    });

    expect(summary).toEqual(expect.objectContaining({
      onboardingUrl: "http://localhost:3144/api/invites/token-1/onboarding",
      skillIndexUrl: "http://localhost:3144/api/skills/index",
    }));
    expect(manifest.onboarding.connectivity.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "openclaw_onboarding_api_loopback",
      "openclaw_onboarding_private_loopback_bind",
    ]));
    expect(text).toContain("## Step 1: Submit agent join request");
    expect(text).toContain("GET http://localhost:3144/api/skills/squadrail");
    expect(text).toContain("## Connectivity diagnostics");
  });

  it("reports onboarding host mismatches and safely ignores malformed api urls", () => {
    const warnDiagnostics = buildOnboardingDiscoveryDiagnostics({
      apiBaseUrl: "https://preview.example.com",
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "preview.internal",
      allowedHostnames: ["preview.internal"],
    });
    const ignoredDiagnostics = buildOnboardingDiscoveryDiagnostics({
      apiBaseUrl: "not-a-url",
      deploymentMode: "local_trusted",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    });

    expect(warnDiagnostics).toEqual([
      expect.objectContaining({
        code: "openclaw_onboarding_private_host_not_allowed",
        level: "warn",
      }),
    ]);
    expect(ignoredDiagnostics).toEqual([]);
    expect(normalizeHeaderMap(null)).toBeUndefined();
  });

  it("derives scoped grants from invite defaults", () => {
    const defaults = {
      human: {
        grants: [
          { permissionKey: "users:invite", scope: null },
          { permissionKey: "invalid:key", scope: null },
        ],
      },
      agent: {
        grants: [
          { permissionKey: "agents:create", scope: { scopeType: "company" } },
          { permissionKey: "joins:approve", scope: null },
        ],
      },
    };

    expect(grantsFromDefaults(defaults, "human")).toEqual([
      {
        permissionKey: "users:invite",
        scope: null,
      },
    ]);
    expect(grantsFromDefaults(defaults, "agent")).toEqual([
      {
        permissionKey: "agents:create",
        scope: { scopeType: "company" },
      },
      {
        permissionKey: "joins:approve",
        scope: null,
      },
    ]);
  });
});
