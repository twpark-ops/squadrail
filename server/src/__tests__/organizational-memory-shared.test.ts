import { describe, expect, it } from "vitest";
import { deriveOrganizationalMemorySourceType } from "../services/organizational-memory-shared.js";

describe("organizational-memory-shared", () => {
  describe("deriveOrganizationalMemorySourceType", () => {
    it("classifies APPROVE_IMPLEMENTATION as review type", () => {
      expect(deriveOrganizationalMemorySourceType("APPROVE_IMPLEMENTATION")).toBe("review");
    });

    it("classifies SUBMIT_FOR_REVIEW as review type", () => {
      expect(deriveOrganizationalMemorySourceType("SUBMIT_FOR_REVIEW")).toBe("review");
    });

    it("classifies REQUEST_CHANGES as review type", () => {
      expect(deriveOrganizationalMemorySourceType("REQUEST_CHANGES")).toBe("review");
    });

    it("classifies ASSIGN_TASK as protocol_message type", () => {
      expect(deriveOrganizationalMemorySourceType("ASSIGN_TASK")).toBe("protocol_message");
    });

    it("classifies ESCALATE_BLOCKER as protocol_message type", () => {
      expect(deriveOrganizationalMemorySourceType("ESCALATE_BLOCKER")).toBe("protocol_message");
    });

    it("returns null for unrecognized message types", () => {
      expect(deriveOrganizationalMemorySourceType("SYSTEM_REMINDER")).toBeNull();
    });
  });
});
