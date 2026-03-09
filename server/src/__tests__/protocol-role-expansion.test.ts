import { describe, expect, it } from "vitest";
import { ISSUE_PROTOCOL_PARTICIPANT_ROLES } from "@squadrail/shared";
import { buildDefaultRolePackFiles } from "../services/role-packs.js";
import { deriveBriefScope } from "../services/issue-retrieval.js";

describe("new protocol roles (cto, pm, qa)", () => {
  it("includes cto, pm, qa in ISSUE_PROTOCOL_PARTICIPANT_ROLES", () => {
    expect(ISSUE_PROTOCOL_PARTICIPANT_ROLES).toContain("cto");
    expect(ISSUE_PROTOCOL_PARTICIPANT_ROLES).toContain("pm");
    expect(ISSUE_PROTOCOL_PARTICIPANT_ROLES).toContain("qa");
  });

  it("creates role pack files for cto", () => {
    const files = buildDefaultRolePackFiles("cto");
    const role = files.find((file) => file.filename === "ROLE.md");
    expect(role?.content).toContain("CTO");
  });

  it("creates role pack files for pm", () => {
    const files = buildDefaultRolePackFiles("pm");
    const role = files.find((file) => file.filename === "ROLE.md");
    expect(role?.content).toContain("Product Manager");
  });

  it("creates role pack files for qa", () => {
    const files = buildDefaultRolePackFiles("qa");
    const role = files.find((file) => file.filename === "ROLE.md");
    expect(role?.content).toContain("QA");
  });

  it("derives correct brief scope for cto", () => {
    const scope = deriveBriefScope({
      eventType: "on_assignment",
      recipientRole: "cto",
    });
    expect(scope).toBe("cto");
  });

  it("derives correct brief scope for pm", () => {
    const scope = deriveBriefScope({
      eventType: "on_assignment",
      recipientRole: "pm",
    });
    expect(scope).toBe("pm");
  });

  it("derives correct brief scope for qa", () => {
    const scope = deriveBriefScope({
      eventType: "on_assignment",
      recipientRole: "qa",
    });
    expect(scope).toBe("qa");
  });
});
