import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { describe, it } from "node:test";
import { leadSourceEnum } from "../../src/lib/validations/common";
import { sourceLabel } from "../../src/lib/dashboard-ui";

const read = (p: string) => readFileSync(p, "utf8");

describe("US real-estate CRM foundation", () => {
  it("accepts the conventional US lead-source categories", () => {
    for (const s of ["WEB_FORM", "ZILLOW", "REALTOR_COM", "HOMES_COM", "FACEBOOK_ADS", "GOOGLE_ADS", "REFERRAL", "OPEN_HOUSE", "PHONE", "MANUAL", "OTHER"]) {
      assert.ok(leadSourceEnum.safeParse(s).success, s);
    }
    assert.equal(leadSourceEnum.safeParse("NOT_A_SOURCE").success, false);
    assert.equal(sourceLabel("GOOGLE_ADS"), "Google");
    assert.equal(sourceLabel("MANUAL"), "Manual entry");
  });

  it("sidebar keeps four everyday screens up front, every other module under More, and no internal names", () => {
    const nav = read("src/components/layout/app-sidebar.tsx");
    for (const label of ["Home", "Leads", "Inbox", "Calendar", "Contacts", "Opportunities", "Properties", "Pipeline", "Tasks", "Reports", "Team Health", "Automations", "Team", "Integrations", "Settings"]) {
      assert.ok(nav.includes(`label: "${label}"`), label);
    }
    assert.ok(!/Golden Path|Audit Log|label: "WhatsApp"|label: "Dashboard"/.test(nav));
    // Progressive disclosure: only these four are primary; everything else is in moreNav.
    const primary = nav.slice(nav.indexOf("primaryNav"), nav.indexOf("moreNav"));
    assert.equal((primary.match(/label: "/g) ?? []).length, 4);
  });

  it("renamed routes exist and legacy URLs redirect", () => {
    for (const p of ["conversations", "lead-journey", "team", "integrations"]) {
      assert.ok(existsSync(`src/app/(app)/${p}/page.tsx`), p);
    }
    const cfg = read("next.config.ts");
    assert.match(cfg, /\/whatsapp[\s\S]*\/conversations/);
    assert.match(cfg, /\/golden-path[\s\S]*\/lead-journey/);
  });

  it("Integrations page never lists unbuilt providers as connected", () => {
    const c = read("src/app/(app)/settings/settings-client.tsx");
    assert.match(c, /Not available yet/);
  });
});
