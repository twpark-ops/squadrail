import { describe, expect, it } from "vitest";
import {
  buildMergeAutomationToast,
  buildMergeCandidateToast,
  buildProtocolMessageToast,
  buildProtocolTimeoutToast,
  buildRunStatusToast,
  sanitizeExternalToastHref,
  type IssueToastContext,
} from "./live-update-toast-builders";

const issue: IssueToastContext = {
  ref: "CLO-25",
  title: "Fix Siemens mapping",
  label: "CLO-25 - Fix Siemens mapping",
  href: "/work/CLO-25",
  changesHref: "/changes/CLO-25",
};

describe("live update toast builders", () => {
  it("allows only http and https external URLs", () => {
    expect(sanitizeExternalToastHref("https://example.com/pr/123")).toBe("https://example.com/pr/123");
    expect(sanitizeExternalToastHref("http://example.com/pr/123")).toBe("http://example.com/pr/123");
    expect(sanitizeExternalToastHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeExternalToastHref("data:text/html,boom")).toBeNull();
    expect(sanitizeExternalToastHref("/changes/CLO-25")).toBeNull();
  });

  it("builds protocol message toasts with workflow-aware labels", () => {
    const toast = buildProtocolMessageToast("Delivery PM", issue, {
      messageType: "ASK_CLARIFICATION",
      summary: "Need vendor-specific mapping details",
      workflowStateAfter: "clarification_needed",
    });

    expect(toast).toMatchObject({
      title: "CLO-25 needs clarification",
      tone: "warn",
      action: {
        label: "View CLO-25",
        href: "/work/CLO-25",
      },
    });
    expect(toast?.body).toContain("Need vendor-specific mapping details");
  });

  it("routes change-request protocol toasts to the changes surface", () => {
    const toast = buildProtocolMessageToast("Reviewer", issue, {
      messageType: "REQUEST_CHANGES",
      summary: "Vendor fallback needs another pass",
      workflowStateAfter: "changes_requested",
    });

    expect(toast?.action).toEqual({
      label: "Open CLO-25 changes",
      href: "/changes/CLO-25",
    });
  });

  it("builds merge candidate toasts with merge commit suffix", () => {
    const toast = buildMergeCandidateToast(issue, {
      actionType: "resolved",
      targetBaseBranch: "main",
      mergeCommitSha: "1234567890abcdef",
    });

    expect(toast).toMatchObject({
      title: "CLO-25 merge candidate resolved",
      tone: "info",
      action: {
        label: "Open CLO-25 changes",
        href: "/changes/CLO-25",
      },
    });
    expect(toast.body).toBe("Base branch: main (1234567)");
  });

  it("falls back to internal changes link when external URL is invalid", () => {
    const toast = buildMergeAutomationToast(issue, {
      actionType: "deploy_started",
      externalProvider: "github",
      targetBranch: "main",
      externalUrl: "javascript:alert(1)",
    });

    expect(toast.action).toEqual({
      label: "Open CLO-25 changes",
      href: "/changes/CLO-25",
    });
  });

  it("uses a validated external change URL when present", () => {
    const toast = buildMergeAutomationToast(issue, {
      actionType: "deploy_started",
      externalProvider: "github",
      targetBranch: "main",
      externalUrl: "https://github.com/org/repo/pull/1",
    });

    expect(toast.action).toEqual({
      label: "Open external change",
      href: "https://github.com/org/repo/pull/1",
    });
  });

  it("builds timeout toasts with escalation context", () => {
    const toast = buildProtocolTimeoutToast(issue, {
      timeoutCode: "changes_ack_timeout",
      recipientRole: "engineer",
    }, true);

    expect(toast).toMatchObject({
      title: "CLO-25 needs recovery",
      tone: "warn",
      action: {
        label: "Open CLO-25 changes",
        href: "/changes/CLO-25",
      },
    });
    expect(toast.body).toContain("changes ack timeout");
    expect(toast.body).toContain("target: engineer");
  });

  it("builds run-status toasts for terminal runs", () => {
    const toast = buildRunStatusToast(
      {
        runId: "run_123",
        agentId: "agent_12345678",
        status: "failed",
        error: "Vitest reported a regression in Siemens normalization",
      },
      () => "Delivery Engineer",
    );

    expect(toast).toMatchObject({
      title: "Delivery Engineer run failed",
      tone: "error",
      ttlMs: 7000,
      action: {
        label: "View run",
        href: "/agents/agent_12345678/runs/run_123",
      },
    });
    expect(toast?.body).toContain("Vitest reported a regression");
  });
});
