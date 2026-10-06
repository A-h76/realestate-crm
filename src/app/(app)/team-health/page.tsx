import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAppAccess } from "@/lib/app-access";
import { roleHasPermission } from "@/lib/authz";
import { loadTeamHealth } from "@/lib/attention/team-health";
import { LEDGER_SCOPE, loadLeakLedger } from "@/lib/attention/leak-ledger";
import { loadJobStatus } from "@/lib/jobs/heartbeat";
import { PageHeader, SectionHeading } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";

function Stat({
  label,
  value,
  note,
  href,
  bad,
}: {
  label: string;
  value: number;
  note?: string;
  href?: string;
  bad?: boolean;
}) {
  const body = (
    <div className="rounded-xl border border-border bg-surface px-4 py-3 hover:bg-background">
      <div className={`text-[24px] font-bold tabular-nums ${bad && value > 0 ? "text-danger" : ""}`}>{value}</div>
      <div className="text-[13px] font-medium">{label}</div>
      {note ? <div className="meta mt-0.5">{note}</div> : null}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function TeamHealthPage() {
  const access = await requireAppAccess();
  // Manager view. The same check gates the data: nothing here is loaded for agents or viewers.
  if (!roleHasPermission(access.role, "leads:assign")) redirect("/dashboard");

  const [h, jobs, ledger] = await Promise.all([
    loadTeamHealth(access.workspaceId, access.workspace.timezone),
    loadJobStatus(),
    loadLeakLedger(access.workspaceId),
  ]);
  const f = h.followUpHealth;
  const d = h.dataHealth;

  return (
    <div className="page-in space-y-10 p-6 md:p-10">
      <PageHeader
        eyebrow="Manager"
        title="Team Health"
        description="Where leads are slipping, who is carrying the load, and which records need cleaning up. Every number is counted from live records."
      />

      <section>
        <SectionHeading>Leak ledger</SectionHeading>
        <p className="meta mb-3">Last {ledger.windowDays} days. {LEDGER_SCOPE}</p>
        {ledger.demoWorkspace ? (
          <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">Demo workspace: seeded and simulated data is never measured.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Leads in the CRM" value={ledger.leads} />
              <Stat
                label="First response within 5 min"
                value={ledger.firstResponse.withinSla}
                note={`of ${ledger.firstResponse.measured} with a recorded first contact${ledger.firstResponse.medianMin != null ? ` · median ${ledger.firstResponse.medianMin} min, 90th pct ${ledger.firstResponse.p90Min} min` : ""}`}
              />
              <Stat label="Unknown first contact" value={ledger.unknown.count} note="No recorded first contact; no time is guessed" />
              <Stat label="Unowned right now" value={ledger.unowned.count} bad />
              <Stat label="Customer waiting for a reply" value={ledger.unanswered.count} bad />
              <Stat
                label="SLA breaches notified"
                value={ledger.sweeper.slaBreaches}
                note={ledger.sweeper.since ? `Since the sweeper first ran, ${ledger.sweeper.since.toLocaleDateString("en-US", { timeZone: access.workspace.timezone })}` : "Sweeper has never run: breaches are not measured"}
              />
              <Stat label="Escalations to managers" value={ledger.sweeper.escalations} />
            </div>
            {([
              ["Unknown first contact", ledger.unknown, "Created"],
              ["Unowned", ledger.unowned, "Created"],
              ["Customer waiting", ledger.unanswered, "Waiting since"],
            ] as const).map(([title, group, atLabel]) =>
              group.count === 0 ? null : (
                <div key={title} className="overflow-x-auto rounded-xl border border-border bg-surface">
                  <div className="px-4 py-2 text-[13px] font-semibold">
                    {title} ({group.count}
                    {group.count > group.sample.length ? `, oldest ${group.sample.length} shown` : ""})
                  </div>
                  <ul className="divide-y divide-border text-sm">
                    {group.sample.map((l) => (
                      <li key={l.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                        <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                          {l.name || "Lead"}
                        </Link>
                        <span className="meta">
                          {l.ownerName ?? "No owner"} · {atLabel} {l.at.toLocaleString("en-US", { timeZone: access.workspace.timezone })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      <section>
        <SectionHeading>Background jobs</SectionHeading>
        <p className="meta mb-3">SLA escalation and WhatsApp recovery only work while these run. Platform-wide; each should run every 5 minutes.</p>
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface text-sm">
          {jobs.map((j) => (
            <li key={j.name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span className="font-medium">{j.label}</span>
              <span className="flex items-center gap-2">
                <span className="meta">{j.lastRanAt ? `Last ran ${j.lastRanAt.toLocaleString("en-US", { timeZone: access.workspace.timezone })}` : "Never ran"}</span>
                <Badge tone={j.state === "ok" ? "success" : "danger"}>{{ ok: "Running", failing: "Last run had errors", stale: "Stopped", never: "Not scheduled" }[j.state]}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionHeading>Lead response & follow-up</SectionHeading>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Leads without an owner" value={f.unassigned} href="/leads?filter=unassigned" bad />
          <Stat
            label="New leads not contacted"
            value={f.uncontacted}
            note={f.oldestUncontactedDays != null ? `Oldest: ${f.oldestUncontactedDays} days` : undefined}
            href="/leads?filter=uncontacted"
            bad
          />
          <Stat label="Waiting for a reply" value={f.needsReply} href="/conversations" bad />
          <Stat label="Overdue follow-ups" value={f.overdueFollowUps} href="/tasks" bad />
          <Stat label="Going cold" value={f.goingCold} note="No activity for 2+ weeks" href="/leads?filter=going-cold" />
          <Stat label="Deals with no next action" value={f.opportunitiesWithoutNextAction} href="/opportunities" />
        </div>
      </section>

      <section>
        <SectionHeading>Lead flow</SectionHeading>
        <p className="meta mb-3">Leads created in the last {h.leadFlow.windowDays} days, and how far they have got.</p>
        {h.leadFlow.steps.length === 0 || !h.leadFlow.enoughData ? (
          <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">
            Not enough activity data yet.
            {h.leadFlow.cohort > 0 ? ` Only ${h.leadFlow.cohort} new ${h.leadFlow.cohort === 1 ? "lead" : "leads"} in this period.` : ""}
          </p>
        ) : (
          <ol className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            {h.leadFlow.steps.map((s) => (
              <li key={s.label} className="rounded-xl border border-border bg-surface px-4 py-3">
                <div className="text-[22px] font-bold tabular-nums">{s.count ?? "—"}</div>
                <div className="text-[13px] font-medium">{s.label}</div>
                {s.count == null ? <div className="meta mt-0.5">Not enough activity data yet</div> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <SectionHeading>Agent workload</SectionHeading>
        {h.workload.length === 0 ? (
          <p className="text-sm text-muted">No team members yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.1em] text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Agent</th>
                  <th className="px-4 py-2 font-semibold">Open leads</th>
                  <th className="px-4 py-2 font-semibold">Waiting for reply</th>
                  <th className="px-4 py-2 font-semibold">Overdue</th>
                  <th className="px-4 py-2 font-semibold">No next action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {h.workload.map((w) => (
                  <tr key={w.userId ?? "unassigned"}>
                    <td className="px-4 py-2 font-medium">{w.name}</td>
                    <td className="px-4 py-2 tabular-nums">{w.openLeads}</td>
                    <td className="px-4 py-2 tabular-nums">{w.needsReply}</td>
                    <td className="px-4 py-2 tabular-nums">{w.overdueFollowUps > 0 ? <Badge tone="danger">{w.overdueFollowUps}</Badge> : 0}</td>
                    <td className="px-4 py-2 tabular-nums">{w.noNextAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <SectionHeading>Data health</SectionHeading>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Leads without an owner" value={d.leadsWithoutOwner} href="/leads?filter=unassigned" />
          <Stat label="Leads without a next action" value={d.leadsWithoutNextAction} href="/leads?filter=no-next-action" />
          <Stat label="Leads with no phone or email" value={d.leadsWithoutContactInfo} />
          <Stat label="Possible duplicate contacts" value={d.duplicateContactGroups} note="Same phone number or email" href="/contacts" />
          <Stat label="Stale deals" value={d.staleOpportunities} note="No movement for 30+ days" href="/opportunities" />
        </div>
      </section>
    </div>
  );
}
