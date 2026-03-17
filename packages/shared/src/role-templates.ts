import type { CompanyRoleTemplate } from "./constants.js";
import type { CompanyRoleTemplateDefinition } from "./types/access.js";

export type ResolvedRoleTemplate = CompanyRoleTemplate | "custom";

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
 * Derive the visible role template from the current grant set.
 *
 * We only show a concrete template when the member's grants exactly
 * match one of the coarse presets. Any non-empty partial/custom grant
 * set is surfaced as "custom" so the UI does not silently label a
 * writable member as Viewer.
 */
export function resolveRoleTemplate(
  _membershipRole: string | null,
  grants: string[],
): ResolvedRoleTemplate {
  const grantSet = new Set(grants);

  for (const template of ROLE_TEMPLATE_DEFINITIONS) {
    const required = template.permissions;
    const match = required.length === grantSet.size
      && required.every((permissionKey) => grantSet.has(permissionKey));
    if (match) return template.key;
  }

  return grantSet.size === 0 ? "viewer" : "custom";
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
