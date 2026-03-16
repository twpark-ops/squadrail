import { describe, expect, it } from "vitest";
import { defaultPermissionsForRole, normalizeAgentPermissions } from "../services/agent-permissions.js";

describe("agent-permissions", () => {
  describe("defaultPermissionsForRole", () => {
    it("ceo role grants canCreateAgents", () => {
      const perms = defaultPermissionsForRole("ceo");
      expect(perms.canCreateAgents).toBe(true);
    });

    it("engineer role does not grant canCreateAgents", () => {
      const perms = defaultPermissionsForRole("engineer");
      expect(perms.canCreateAgents).toBe(false);
    });
  });

  describe("normalizeAgentPermissions", () => {
    it("handles null input", () => {
      const result = normalizeAgentPermissions(null, "engineer");
      expect(result).toEqual({ canCreateAgents: false });
    });

    it("handles undefined input", () => {
      const result = normalizeAgentPermissions(undefined, "ceo");
      expect(result).toEqual({ canCreateAgents: true });
    });

    it("handles array input by returning defaults", () => {
      const result = normalizeAgentPermissions([], "engineer");
      expect(result).toEqual({ canCreateAgents: false });
    });

    it("preserves valid boolean canCreateAgents from input", () => {
      const result = normalizeAgentPermissions({ canCreateAgents: true }, "engineer");
      expect(result.canCreateAgents).toBe(true);
    });

    it("falls back to role default when canCreateAgents is non-boolean", () => {
      const result = normalizeAgentPermissions({ canCreateAgents: "yes" }, "ceo");
      expect(result.canCreateAgents).toBe(true);
    });
  });
});
