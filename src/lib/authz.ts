import type { WorkspaceRole } from "@prisma/client";

export const PERMISSIONS = [
  "crm:read",
  "crm:write",
  "crm:delete",
  "csv:import",
  "csv:export",
  "whatsapp:read",
  "whatsapp:send",
  "calendar:read",
  "calendar:write",
  "intelligence:read",
  "intelligence:run",
  "intelligence:review",
  "scoring:run",
  "automations:read",
  "automations:manage",
  "automations:execute",
  "audit:read",
  "workspace:read",
  "workspace:write",
  "members:manage",
  "leads:assign",
  "demo:reset",
  "notifications:read",
  "search:use",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL_PERMISSIONS = new Set<Permission>(PERMISSIONS);

const ADMIN_PERMISSIONS = new Set<Permission>(PERMISSIONS);

const AGENT_PERMISSIONS = new Set<Permission>([
  "crm:read",
  "crm:write",
  "crm:delete",
  "csv:import",
  "csv:export",
  "whatsapp:read",
  "whatsapp:send",
  "calendar:read",
  "calendar:write",
  "intelligence:read",
  "intelligence:run",
  "scoring:run",
  "automations:read",
  "workspace:read",
  "notifications:read",
  "search:use",
]);

/**
 * Sales/team manager: every AGENT workflow plus team-level operations
 * (lead assignment, AI review, running automations, audit visibility).
 * Deliberately excluded: workspace:write, members:manage,
 * automations:manage and demo:reset — those stay with OWNER/ADMIN.
 */
const MANAGER_PERMISSIONS = new Set<Permission>([
  ...AGENT_PERMISSIONS,
  "leads:assign",
  "intelligence:review",
  "automations:execute",
  "audit:read",
]);

const VIEWER_PERMISSIONS = new Set<Permission>([
  "crm:read",
  "whatsapp:read",
  "calendar:read",
  "intelligence:read",
  "automations:read",
  "workspace:read",
  "notifications:read",
  "search:use",
]);

export function permissionsForRole(role: WorkspaceRole): ReadonlySet<Permission> {
  switch (role) {
    case "OWNER":
      return ALL_PERMISSIONS;
    case "ADMIN":
      return ADMIN_PERMISSIONS;
    case "MANAGER":
      return MANAGER_PERMISSIONS;
    case "AGENT":
      return AGENT_PERMISSIONS;
    case "VIEWER":
      return VIEWER_PERMISSIONS;
    default: {
      const _exhaustive: never = role;
      void _exhaustive;
      return VIEWER_PERMISSIONS;
    }
  }
}

export function roleHasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return permissionsForRole(role).has(permission);
}

export function roleHasAnyPermission(role: WorkspaceRole, permissions: Permission[]): boolean {
  return permissions.some((permission) => roleHasPermission(role, permission));
}

/** Roles a member manager may hand out. OWNER is never assignable: ownership transfer is out of scope. */
export const ASSIGNABLE_ROLES = ["ADMIN", "MANAGER", "AGENT", "VIEWER"] as const satisfies readonly WorkspaceRole[];

/**
 * Guard rails for PATCH/DELETE /api/workspace/members/:userId, on top of
 * members:manage. Returns the reason the change is refused, or null.
 * - nobody edits their own membership (no self-promotion / self-lockout)
 * - the OWNER membership is immutable
 * - only an OWNER may grant ADMIN or change an existing ADMIN
 */
export function memberChangeDenial(input: {
  actorId: string;
  actorRole: WorkspaceRole;
  targetId: string;
  targetRole: WorkspaceRole;
  newRole?: WorkspaceRole;
}): string | null {
  if (!roleHasPermission(input.actorRole, "members:manage")) return "Insufficient permissions";
  if (input.actorId === input.targetId) return "You cannot change your own membership";
  if (input.targetRole === "OWNER") return "The workspace owner cannot be changed";
  if (input.newRole === "OWNER") return "Ownership cannot be assigned";
  if ((input.targetRole === "ADMIN" || input.newRole === "ADMIN") && input.actorRole !== "OWNER") {
    return "Only the owner can manage admins";
  }
  return null;
}
