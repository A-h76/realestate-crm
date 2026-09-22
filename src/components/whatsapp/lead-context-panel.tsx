import Link from "next/link";
import type { Lead } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { SourceName } from "@/components/source-name";
import { formatCurrency, formatPKR } from "@/lib/format";
import type { ScoredPropertyMatch } from "@/lib/matching/properties";
import type { NextBestAction } from "@/lib/automation/next-best-action";
import type { ParsedHandoff } from "@/lib/whatsapp/inbox-list";

type LeadWithRelations = Lead & {
  owner: { id: string; name: string } | null;
  account: { id: string; company: string } | null;
  contact: { id: string; firstName: string; lastName: string | null } | null;
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="section-kicker">{label}</dt>
      <dd className="mt-0.5 text-[13px]">{value}</dd>
    </div>
  );
}

export function LeadContextPanel({
  lead,
  matches,
  nba,
  handoff,
}: {
  lead: LeadWithRelations;
  matches: ScoredPropertyMatch[];
  nba: NextBestAction | null;
  handoff?: ParsedHandoff | null;
}) {
  const fullName = `${lead.firstName} ${lead.lastName ?? ""}`.trim();
  const requirementFields: Array<[string, React.ReactNode]> = [
    ["Intent", lead.intentType !== "UNKNOWN" ? lead.intentType : "—"],
    ["Purpose", lead.propertyPurpose ?? "—"],
    ["Property type", lead.propertyTypePref ?? "—"],
    ["Area", lead.preferredArea ?? "—"],
    [
      "Budget",
      lead.budgetMin || lead.budgetMax
        ? `${formatPKR(lead.budgetMin != null ? Number(lead.budgetMin) : null)} – ${formatPKR(lead.budgetMax != null ? Number(lead.budgetMax) : null)}`
        : "—",
    ],
    [
      "Size",
      lead.sizePrefMin || lead.sizePrefMax
        ? `${lead.sizePrefMin ?? lead.sizePrefMax}${lead.sizePrefMax && lead.sizePrefMin && lead.sizePrefMax !== lead.sizePrefMin ? `–${lead.sizePrefMax}` : ""} ${lead.sizeUnitPref ?? ""}`.trim()
        : "—",
    ],
    ["Bedrooms", lead.bedroomPref ?? "—"],
  ];

  return (
    <div className="space-y-8 p-5">
      <section>
        <h3 className="section-kicker mb-3">Lead</h3>
        <dl className="space-y-3">
          <Field label="Name" value={<Link href={`/leads/${lead.id}`} className="hover:text-accent">{fullName}</Link>} />
          <Field label="Phone" value={lead.whatsappNumber ?? lead.phone ?? "—"} />
          <Field label="Source" value={<SourceName source={lead.source} />} />
          <Field label="Owner" value={lead.owner?.name ?? "Unassigned"} />
          <Field label="Stage" value={<Badge tone="neutral">{lead.stage}</Badge>} />
        </dl>
      </section>

      {handoff ? (
        <section>
          <h3 className="section-kicker mb-3">Handoff reason</h3>
          <dl className="space-y-3">
            <Field label="Reason" value={handoff.reasonLabel} />
            {handoff.actionLabel ? <Field label="Suggested action" value={handoff.actionLabel} /> : null}
            {handoff.triggerMessage ? <Field label="Trigger message" value={`"${handoff.triggerMessage}"`} /> : null}
          </dl>
        </section>
      ) : null}

      <section>
        <h3 className="section-kicker mb-3">Requirement</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {requirementFields.map(([label, value]) => (
            <Field key={label} label={label} value={value} />
          ))}
        </dl>
      </section>

      <section>
        <h3 className="section-kicker mb-3">Matched properties</h3>
        {matches.length === 0 ? (
          <p className="text-[13px] text-muted">No matches yet.</p>
        ) : (
          <div className="space-y-2">
            {matches.slice(0, 4).map((m) => (
              <Link
                key={m.property.id}
                href={`/properties/${m.property.id}`}
                className="block border border-border bg-background px-3 py-2 hover:border-accent"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{m.property.title}</span>
                  <span className="score shrink-0 text-accent">{m.matchScore}%</span>
                </div>
                <div className="mt-0.5 text-[12px] text-muted">
                  {[m.property.area, formatCurrency(Number(m.property.price), m.property.currency)]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                <div className="mt-1">
                  <Badge tone={m.property.status === "AVAILABLE" ? "success" : "neutral"}>{m.property.status}</Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {nba ? (
        <section>
          <h3 className="section-kicker mb-3">Next action</h3>
          <Link href={nba.href} className="block border border-border bg-background px-3 py-2 hover:border-accent">
            <div className="text-[13px] font-medium">{nba.title}</div>
            <div className="mt-0.5 text-[12px] text-muted">{nba.reason}</div>
          </Link>
        </section>
      ) : null}

      <section>
        <Link href={`/leads/${lead.id}`} className="text-[13px] font-medium text-accent hover:underline">
          View full lead timeline →
        </Link>
      </section>
    </div>
  );
}
