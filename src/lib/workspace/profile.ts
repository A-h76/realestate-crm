import { industryOf } from "./industries";
import { NAV_NEEDS, can, packageOf, type Capability } from "./packages";

/** Everything the UI and gates need to know about a workspace's package + industry, from the two stored strings. */
export function workspaceProfile(w: { industry: string; package: string }) {
  const industry = industryOf(w.industry);
  const plan = packageOf(w.package);
  const hiddenNav = new Set(industry.hideNav);
  for (const [href, need] of Object.entries(NAV_NEEDS)) if (!can(plan, need)) hiddenNav.add(href);
  return {
    industry,
    plan,
    /** UI only, not a security boundary: a hidden module's URL still resolves. */
    hiddenNav: [...hiddenNav],
    can: (c: Capability) => can(plan, c),
  };
}

/** Plain, serializable slice passed from the server layout to the client shell. */
export type ShellProfile = { leadsLabel: string; tagline: string; searchHint: string; hiddenNav: string[] };

export function shellProfile(w: { industry: string; package: string }): ShellProfile {
  const p = workspaceProfile(w);
  return {
    leadsLabel: p.industry.leadsLabel,
    tagline: p.industry.tagline,
    searchHint: p.industry.searchHint,
    hiddenNav: p.hiddenNav,
  };
}
