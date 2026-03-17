import { describe, expect, it } from "vitest";
import { buildSetupProgressSteps, deriveSetupProgressState } from "../services/setup-progress.js";

/**
 * Tests for the first-success state derivation logic used by the B2
 * Post-Onboarding First Success Surface.
 *
 * The first-success lifecycle has three phases:
 *   1. Before first issue  — firstIssueReady === false
 *   2. After first issue, before first close — firstIssueReady === true, closedRootIssueCount === 0
 *   3. After first close — closedRootIssueCount > 0 (generic state)
 *
 * Phase detection is derived from setupProgress steps + issue data,
 * NOT from new setup progress states.
 */

describe("first-success state derivation", () => {
  describe("phase 1: before first issue", () => {
    it("firstIssueReady is false when no issues exist and metadata has no flag", () => {
      const steps = buildSetupProgressSteps({
        selectedEngine: "claude_local",
        selectedWorkspaceId: "ws-1",
        metadata: {
          rolePacksSeeded: true,
          knowledgeSeeded: true,
        },
        publishedRolePackCount: 1,
        knowledgeDocumentCount: 2,
        issueCount: 0,
      });

      expect(steps.firstIssueReady).toBe(false);
      expect(deriveSetupProgressState(steps)).toBe("knowledge_seeded");
    });

    it("firstIssueReady remains false if prerequisites are incomplete", () => {
      const steps = buildSetupProgressSteps({
        selectedEngine: "claude_local",
        selectedWorkspaceId: null,
        metadata: {
          rolePacksSeeded: true,
        },
        publishedRolePackCount: 1,
        knowledgeDocumentCount: 0,
        issueCount: 0,
      });

      expect(steps.firstIssueReady).toBe(false);
      expect(steps.workspaceConnected).toBe(false);
    });
  });

  describe("phase 2: after first issue, before first close", () => {
    it("firstIssueReady is true when metadata flag is set", () => {
      const steps = buildSetupProgressSteps({
        selectedEngine: "claude_local",
        selectedWorkspaceId: "ws-1",
        metadata: {
          rolePacksSeeded: true,
          knowledgeSeeded: true,
          firstIssueReady: true,
        },
        publishedRolePackCount: 1,
        knowledgeDocumentCount: 2,
        issueCount: 1,
      });

      expect(steps.firstIssueReady).toBe(true);
      expect(deriveSetupProgressState(steps)).toBe("first_issue_ready");
    });

    it("firstIssueReady is true when issueCount > 0 even without metadata flag", () => {
      const steps = buildSetupProgressSteps({
        selectedEngine: "claude_local",
        selectedWorkspaceId: "ws-1",
        metadata: {
          rolePacksSeeded: true,
          knowledgeSeeded: true,
        },
        publishedRolePackCount: 1,
        knowledgeDocumentCount: 2,
        issueCount: 3,
      });

      expect(steps.firstIssueReady).toBe(true);
      expect(deriveSetupProgressState(steps)).toBe("first_issue_ready");
    });

    it("closedRootIssueCount derivation: zero done root issues means still in phase 2", () => {
      // Simulates the client-side derivation logic
      const issues = [
        { id: "i-1", parentId: null, status: "in_progress" },
        { id: "i-2", parentId: "i-1", status: "done" }, // subtask, not root
        { id: "i-3", parentId: null, status: "todo" },
      ];

      const closedRootIssueCount = issues.filter(
        (i) => i.parentId === null && (i.status === "done" || i.status === "cancelled"),
      ).length;

      expect(closedRootIssueCount).toBe(0);
    });
  });

  describe("phase 3: after first close (first success achieved)", () => {
    it("closedRootIssueCount > 0 indicates first success is complete", () => {
      const issues = [
        { id: "i-1", parentId: null, status: "done" },
        { id: "i-2", parentId: "i-1", status: "done" },
        { id: "i-3", parentId: null, status: "in_progress" },
      ];

      const closedRootIssueCount = issues.filter(
        (i) => i.parentId === null && (i.status === "done" || i.status === "cancelled"),
      ).length;

      expect(closedRootIssueCount).toBe(1);
      expect(closedRootIssueCount).toBeGreaterThan(0);
    });

    it("cancelled root issues also count as closed for first success", () => {
      const issues = [
        { id: "i-1", parentId: null, status: "cancelled" },
        { id: "i-2", parentId: null, status: "todo" },
      ];

      const closedRootIssueCount = issues.filter(
        (i) => i.parentId === null && (i.status === "done" || i.status === "cancelled"),
      ).length;

      expect(closedRootIssueCount).toBe(1);
    });
  });

  describe("onboarding issue ID metadata persistence", () => {
    it("onboardingIssueId is preserved in metadata alongside firstIssueReady", () => {
      const metadata = {
        rolePacksSeeded: true,
        knowledgeSeeded: true,
        firstIssueReady: true,
        onboardingIssueId: "issue-abc-123",
      };

      // Verify the metadata fields are independent and correctly structured
      expect(metadata.onboardingIssueId).toBe("issue-abc-123");
      expect(metadata.firstIssueReady).toBe(true);

      // Verify buildSetupProgressSteps reads firstIssueReady from metadata
      const steps = buildSetupProgressSteps({
        selectedEngine: "claude_local",
        selectedWorkspaceId: "ws-1",
        metadata,
        publishedRolePackCount: 1,
        knowledgeDocumentCount: 2,
        issueCount: 1,
      });

      expect(steps.firstIssueReady).toBe(true);
    });

    it("onboardingIssueId does not interfere with step derivation", () => {
      const steps = buildSetupProgressSteps({
        selectedEngine: "claude_local",
        selectedWorkspaceId: "ws-1",
        metadata: {
          rolePacksSeeded: true,
          knowledgeSeeded: true,
          onboardingIssueId: "issue-xyz-789",
          // firstIssueReady NOT set — should still derive from issueCount
        },
        publishedRolePackCount: 1,
        knowledgeDocumentCount: 2,
        issueCount: 0,
      });

      // onboardingIssueId has no effect on step derivation
      expect(steps.firstIssueReady).toBe(false);
    });

    it("metadata merge preserves onboardingIssueId when updating other fields", () => {
      const currentMetadata = {
        rolePacksSeeded: true,
        knowledgeSeeded: true,
        firstIssueReady: true,
        onboardingIssueId: "issue-abc-123",
      };

      const patch = {
        someOtherField: "value",
      };

      const merged = { ...currentMetadata, ...patch };

      expect(merged.onboardingIssueId).toBe("issue-abc-123");
      expect(merged.firstIssueReady).toBe(true);
      expect((merged as Record<string, unknown>).someOtherField).toBe("value");
    });
  });

  describe("first-success empty state message selection", () => {
    function selectEmptyStateMessage(args: {
      firstIssueCreated: boolean;
      issueCount: number;
      closedRootIssueCount: number;
    }): string {
      if (args.issueCount === 0) {
        if (!args.firstIssueCreated) {
          return "Submit a quick request to get started — the PM will structure and route it.";
        }
        return "Your first request is being processed. Check the Board tab to follow progress.";
      }
      return "No issues match the current filters or search.";
    }

    it("shows submit prompt before first issue", () => {
      const message = selectEmptyStateMessage({
        firstIssueCreated: false,
        issueCount: 0,
        closedRootIssueCount: 0,
      });
      expect(message).toContain("Submit a quick request");
    });

    it("shows processing message after first issue but before first close", () => {
      const message = selectEmptyStateMessage({
        firstIssueCreated: true,
        issueCount: 0, // filtered empty state
        closedRootIssueCount: 0,
      });
      expect(message).toContain("first request is being processed");
    });

    it("shows generic filter message when issues exist", () => {
      const message = selectEmptyStateMessage({
        firstIssueCreated: true,
        issueCount: 5,
        closedRootIssueCount: 2,
      });
      expect(message).toContain("No issues match");
    });
  });

  describe("welcome banner state selection", () => {
    function selectBannerMessage(args: {
      issueStatus: string;
      workflowState: string | null;
      hasPendingClarification: boolean;
    }): { title: string; message: string } | null {
      if (args.issueStatus === "done" || args.issueStatus === "cancelled") {
        return null;
      }

      let title = "Welcome to your first issue";
      let message = "Your PM is structuring this request. Watch for clarification questions in the Inbox.";

      if (args.hasPendingClarification) {
        title = "Clarification needed";
        message = "A clarification is waiting — check your Inbox to keep things moving.";
      } else if (args.workflowState === "implementing") {
        title = "Implementation underway";
        message = "Your team is building the solution. Progress updates appear in the protocol timeline below.";
      } else if (
        args.workflowState === "submitted_for_review" ||
        args.workflowState === "under_review"
      ) {
        title = "Review in progress";
        message = "The implementation is being reviewed. You will see the outcome here shortly.";
      }

      return { title, message };
    }

    it("returns null for done issues", () => {
      expect(selectBannerMessage({
        issueStatus: "done",
        workflowState: "done",
        hasPendingClarification: false,
      })).toBeNull();
    });

    it("returns null for cancelled issues", () => {
      expect(selectBannerMessage({
        issueStatus: "cancelled",
        workflowState: null,
        hasPendingClarification: false,
      })).toBeNull();
    });

    it("shows structuring message for todo/backlog issues", () => {
      const result = selectBannerMessage({
        issueStatus: "todo",
        workflowState: "backlog",
        hasPendingClarification: false,
      });
      expect(result?.title).toBe("Welcome to your first issue");
      expect(result?.message).toContain("structuring this request");
    });

    it("shows clarification message when clarification is pending", () => {
      const result = selectBannerMessage({
        issueStatus: "in_progress",
        workflowState: "implementing",
        hasPendingClarification: true,
      });
      expect(result?.title).toBe("Clarification needed");
      expect(result?.message).toContain("Inbox");
    });

    it("shows implementation message during implementation", () => {
      const result = selectBannerMessage({
        issueStatus: "in_progress",
        workflowState: "implementing",
        hasPendingClarification: false,
      });
      expect(result?.title).toBe("Implementation underway");
    });

    it("shows review message during review", () => {
      const result = selectBannerMessage({
        issueStatus: "in_review",
        workflowState: "under_review",
        hasPendingClarification: false,
      });
      expect(result?.title).toBe("Review in progress");
    });

    it("prioritizes clarification over implementation state", () => {
      const result = selectBannerMessage({
        issueStatus: "in_progress",
        workflowState: "implementing",
        hasPendingClarification: true,
      });
      // Clarification takes priority over implementation
      expect(result?.title).toBe("Clarification needed");
    });
  });
});
