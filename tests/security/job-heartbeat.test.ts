import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { loadJobStatus, recordHeartbeat } from "../../src/lib/jobs/heartbeat";

const MIN = 60_000;
const state = async (now: Date) => (await loadJobStatus(now)).find((j) => j.name === "custody-sweep")!.state;

describe("job heartbeat", () => {
  let saved: { lastRanAt: Date; lastOkAt: Date | null } | null;
  before(async () => {
    saved = await prisma.jobHeartbeat.findUnique({ where: { name: "custody-sweep" } });
    await prisma.jobHeartbeat.deleteMany({ where: { name: "custody-sweep" } });
  });
  after(async () => {
    await prisma.jobHeartbeat.deleteMany({ where: { name: "custody-sweep" } });
    if (saved) await prisma.jobHeartbeat.create({ data: { name: "custody-sweep", ...saved } });
  });

  it("never -> ok -> failing -> stale", async () => {
    const t = new Date(Date.now() - 60 * MIN);
    assert.equal(await state(t), "never");
    await recordHeartbeat("custody-sweep", true, t);
    assert.equal(await state(new Date(t.getTime() + 4 * MIN)), "ok");
    await recordHeartbeat("custody-sweep", false, new Date(t.getTime() + 5 * MIN));
    assert.equal(await state(new Date(t.getTime() + 6 * MIN)), "failing");
    assert.equal(await state(new Date(t.getTime() + 5 * MIN + 16 * MIN)), "stale", "no run for 3 intervals");
  });
});
