import { describe, expect, it } from "vitest";
import { ROLE_PACK_FILE_NAMES } from "@squadrail/shared";
import { buildDefaultRolePackFiles } from "../services/role-packs.js";

describe("role pack defaults", () => {
  it("creates the full file set for tech lead", () => {
    const files = buildDefaultRolePackFiles("tech_lead");
    expect(files.map((file) => file.filename).sort()).toEqual([...ROLE_PACK_FILE_NAMES].sort());

    const agents = files.find((file) => file.filename === "AGENTS.md");
    const role = files.find((file) => file.filename === "ROLE.md");

    expect(agents?.content).toContain("structured squad workflow");
    expect(role?.content).toContain("Tech Lead");
    expect(role?.content).toContain("Assign tasks");
  });

  it("creates reviewer-specific review guidance", () => {
    const files = buildDefaultRolePackFiles("reviewer");
    const review = files.find((file) => file.filename === "REVIEW.md");
    const role = files.find((file) => file.filename === "ROLE.md");

    expect(review?.content).toContain("Approval requires acceptance criteria coverage");
    expect(role?.content).toContain("Reviewer");
    expect(role?.content).toContain("Escalate to human decision");
  });

  it("adds product squad-specific guidance when the preset requests product delivery mode", () => {
    const files = buildDefaultRolePackFiles("engineer", "example_product_squad_v1");
    const agents = files.find((file) => file.filename === "AGENTS.md");
    const role = files.find((file) => file.filename === "ROLE.md");

    expect(agents?.content).toContain("Example Product Squad Delivery Context");
    expect(role?.content).toContain("Example Product Squad Engineer Addendum");
    expect(role?.content).toContain("Report changed files, executed tests, and residual risk");
  });

  it("creates CTO and QA role packs for the large org preset", () => {
    const ctoFiles = buildDefaultRolePackFiles("cto", "example_large_org_v1");
    const qaFiles = buildDefaultRolePackFiles("qa", "example_large_org_v1");

    expect(ctoFiles.find((file) => file.filename === "ROLE.md")?.content).toContain("Example Large Org CTO Addendum");
    expect(ctoFiles.find((file) => file.filename === "AGENTS.md")?.content).toContain("Example Product Squad Delivery Context");
    expect(qaFiles.find((file) => file.filename === "ROLE.md")?.content).toContain("Example Large Org QA Addendum");
    expect(qaFiles.find((file) => file.filename === "REVIEW.md")?.content).toContain("Approval requires acceptance criteria coverage");
  });
});
