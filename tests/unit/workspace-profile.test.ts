import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INDUSTRIES, INDUSTRY_IDS, type IndustryId } from "../../src/lib/workspace/industries";
import { PACKAGES, PACKAGE_IDS } from "../../src/lib/workspace/packages";
import { workspaceProfile } from "../../src/lib/workspace/profile";

describe("workspace profile (package + industry)", () => {
  it("every industry starts at a real package and has a pipeline and questions", () => {
    for (const id of INDUSTRY_IDS) {
      const i = INDUSTRIES[id];
      assert.equal(i.id, id);
      assert.ok(PACKAGE_IDS.includes(i.startsWith), id);
      assert.ok(i.stages.length >= 3 && i.intake.length >= 1, id);
    }
  });

  it("starts-with packages match the sold pricing sheet", () => {
    const ids: IndustryId[] = ["real_estate", "retail", "hospital", "clinic", "pharmacy", "coaching", "school", "college"];
    assert.deepEqual(
      ids.map((id) => INDUSTRIES[id].startsWith),
      ["growth", "starter", "advanced", "growth", "starter", "growth", "growth", "advanced"],
    );
  });

  it("capabilities only grow with the package", () => {
    const [s, g, a] = PACKAGE_IDS.map((id) => PACKAGES[id].capabilities);
    assert.ok(s.every((c) => g.includes(c)) && g.every((c) => a.includes(c)));
    assert.ok(!workspaceProfile({ industry: "clinic", package: "starter" }).can("autoFollowUp"));
    assert.ok(workspaceProfile({ industry: "clinic", package: "growth" }).can("autoFollowUp"));
  });

  it("Starter hides Growth-only modules; Growth shows them", () => {
    const starter = workspaceProfile({ industry: "real_estate", package: "starter" }).hiddenNav;
    for (const h of ["/automations", "/reports", "/team-health", "/insights"]) assert.ok(starter.includes(h), h);
    assert.deepEqual(workspaceProfile({ industry: "real_estate", package: "growth" }).hiddenNav, []);
  });

  it("non-real-estate industries hide listings and proposals; real estate keeps them", () => {
    assert.ok(workspaceProfile({ industry: "clinic", package: "advanced" }).hiddenNav.includes("/properties"));
    assert.ok(!workspaceProfile({ industry: "real_estate", package: "advanced" }).hiddenNav.includes("/properties"));
  });

  it("sold seat limits: Starter 3, Growth 5, Advanced as agreed", () => {
    assert.deepEqual(PACKAGE_IDS.map((id) => PACKAGES[id].seats), [3, 5, null]);
  });

  it("unknown values fail safe: general industry, least-privilege package", () => {
    for (const bad of ["", "constructor", "__proto__", "enterprise"]) {
      const p = workspaceProfile({ industry: bad, package: bad });
      assert.equal(p.industry.id, "general");
      assert.equal(p.plan.id, "starter");
    }
  });
});
