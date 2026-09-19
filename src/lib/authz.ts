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
