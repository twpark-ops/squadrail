import type { CompanyRoleTemplate } from "./constants.js";
import type { CompanyRoleTemplateDefinition } from "./types/access.js";

/**
 * Coarse product-role presets over existing PrincipalPermissionGrant.
 * These are NOT stored as a separate DB entity -- they are UI-level labels
 * derived from the current permission grants on a membership.
 */
export const ROLE_TEMPLATE_DEFINITIONS: readonly CompanyRoleTemplateDefinition[] = [
  {
    key: "owner",
    label: "Owner",
    description: "Full control -- company settings, invites, budgets, alerts, access",
    permissions: [
      "agents:create",
      "users:invite",
      "users:manage_permissions",
      "tasks:assign",
      "tasks:assign_scope",
      "joins:approve",
    ],
  },
  {
    key: "admin",
    label: "Admin",
    description: "Invites, budgets, workflow templates, partial settings",
    permissions: [
      "agents:create",
      "users:invite",
      "users:manage_permissions",
      "tasks:assign",
      "joins:approve",
    ],
  },
  {
    key: "operator",
    label: "Operator",
    description: "Issue decisions, approvals, recovery, merge gates",
    permissions: [
      "tasks:assign",
      "tasks:assign_scope",
      "joins:approve",
    ],
  },
  {
    key: "viewer",
    label: "Viewer",
    description: "Read-only access to all surfaces",
    permissions: [],
  },
] as const;

/**
 * Derive the closest matching role template from a member's existing
 * permission grants.  The algorithm walks templates top-down (most
 * privileged first) and returns the first template whose required
 * permission set is a subset of the member's actual grants.
 *
 * If the member has ALL six permission keys -> owner.
 * If the member has 5 of the admin set          -> admin.
 * Operator only needs assign + approve.
 * Fallback is always viewer.
 */
export function resolveRoleTemplate(
  membershipRole: string | null,
  grants: string[],
): CompanyRoleTemplate {
  const grantSet = new Set(grants);

  // Walk from most privileged to least
  for (const template of ROLE_TEMPLATE_DEFINITIONS) {
    // viewer is the fallback -- it requires zero permissions
    if (template.key === "viewer") continue;

    const required = template.permissions;
    if (required.length === 0) continue;

    const match = required.every((p) => grantSet.has(p));
    if (match) return template.key;
  }

  return "viewer";
}

/**
 * Given a role template key, return the permission grants that should
 * be applied to a membership when that template is selected.
 */
export function permissionsForRoleTemplate(
  roleTemplate: CompanyRoleTemplate,
): Array<{ permissionKey: string; scope: null }> {
  const def = ROLE_TEMPLATE_DEFINITIONS.find((d) => d.key === roleTemplate);
  if (!def) return [];
  return def.permissions.map((permissionKey) => ({
    permissionKey,
    scope: null,
  }));
}
