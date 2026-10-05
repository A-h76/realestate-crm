"use client";

import { createContext, useContext, useMemo } from "react";
import type { Permission } from "@/lib/authz";

/**
 * UI-only mirror of the signed-in member's permissions, so controls the server would refuse (403) are
 * hidden or disabled instead of offered. It is NOT a security boundary: every route still calls
 * requirePermission(). Outside the provider nothing is permitted (fails closed).
 */
const PermissionsContext = createContext<ReadonlySet<Permission>>(new Set());

export function PermissionsProvider({
  permissions,
  children,
}: {
  permissions: readonly Permission[];
  children: React.ReactNode;
}) {
  const set = useMemo(() => new Set(permissions), [permissions]);
  return <PermissionsContext.Provider value={set}>{children}</PermissionsContext.Provider>;
}

export function useCan(permission: Permission): boolean {
  return useContext(PermissionsContext).has(permission);
}
