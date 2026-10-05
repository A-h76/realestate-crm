import { mock } from "node:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkspaceRole } from "@prisma/client";
import { PermissionsProvider } from "../../src/components/providers/permissions";
import { permissionsForRole } from "../../src/lib/authz";

/**
 * Component tests without a browser: components are rendered to static HTML (initial render, effects do not run)
 * inside the same PermissionsProvider the app layout uses. This proves what each role is OFFERED, not what happens
 * on click; request behaviour is covered by the HTTP tests. next/navigation has no router outside Next, so it is
 * stubbed (call mockNextNavigation() BEFORE importing a component that uses it).
 */
let navigationMocked = false;
export function mockNextNavigation(): void {
  if (navigationMocked) return;
  navigationMocked = true;
  mock.module("next/navigation", {
    namedExports: {
      useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, forward() {}, prefetch() {} }),
      usePathname: () => "/",
      useSearchParams: () => new URLSearchParams(),
      redirect() {
        throw new Error("redirect");
      },
      notFound() {
        throw new Error("notFound");
      },
    },
  });
}

export function renderAs(role: WorkspaceRole, element: ReactElement): string {
  return renderToStaticMarkup(<PermissionsProvider permissions={[...permissionsForRole(role)]}>{element}</PermissionsProvider>);
}

export function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/**
 * Form controls with no accessible name: no aria-label/aria-labelledby, no <label for=id>, and not wrapped in a
 * <label>. Buttons and hidden inputs are ignored. Returns a short description of each offender.
 */
export function unlabelledControls(html: string): string[] {
  const offenders: string[] = [];
  const controlRe = /<(input|select|textarea)\b([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = controlRe.exec(html))) {
    const attrs = match[2];
    const type = /\btype="([^"]*)"/.exec(attrs)?.[1];
    if (type && ["hidden", "submit", "button", "reset"].includes(type)) continue;
    if (/\baria-label="[^"]+"/.test(attrs) || /\baria-labelledby="[^"]+"/.test(attrs)) continue;
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    if (id && new RegExp(`<label\\b[^>]*\\bfor="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(html)) continue;
    const before = html.slice(0, match.index);
    const opened = (before.match(/<label\b/g) ?? []).length;
    const closed = (before.match(/<\/label>/g) ?? []).length;
    if (opened > closed) continue; // wrapped by a <label>
    offenders.push(`<${match[1]}${id ? ` id="${id}"` : ""}${type ? ` type="${type}"` : ""}>`);
  }
  return offenders;
}

export const ALL_ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"];
/** Written out by hand (from README "Roles"), not derived from src/lib/authz.ts. */
export const SALES_ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "AGENT"];
export const MANAGER_ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER"];
