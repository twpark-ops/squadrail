import { describe, expect, it } from "vitest";
import {
  permissionsForRoleTemplate,
  resolveRoleTemplate,
} from "@squadrail/shared";

describe("resolveRoleTemplate", () => {
  it("returns viewer for memberships with no grants", () => {
    expect(resolveRoleTemplate("member", [])).toBe("viewer");
  });

  it("returns the concrete template only for exact grant matches", () => {
    const ownerGrants = permissionsForRoleTemplate("owner").map((grant) => grant.permissionKey);
    expect(resolveRoleTemplate("member", ownerGrants)).toBe("owner");
  });

  it("returns custom for partial template grant sets", () => {
    const partialOperator = ["tasks:assign", "joins:approve"];
    expect(resolveRoleTemplate("member", partialOperator)).toBe("custom");
  });

  it("returns custom for template supersets that add extra privileges", () => {
    const operatorWithExtra = [
      ...permissionsForRoleTemplate("operator").map((grant) => grant.permissionKey),
      "users:invite",
    ];
    expect(resolveRoleTemplate("member", operatorWithExtra)).toBe("custom");
  });
});
