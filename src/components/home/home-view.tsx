import Link from "next/link";
import { CalendarDays, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { elapsedLabel, type AttentionItem } from "@/lib/attention/rules";
import type { HomeData } from "@/lib/attention/loader";
import { formatDate, formatTime } from "@/lib/format";

const SINCE_PREFIX: Record<string, string> = {
  RESPOND_NOW: "Replied",
  MISSED_CALL: "Missed call",
  NEW_UNCONTACTED: "Not contacted for",
  UNASSIGNED: "Waiting",
};

function Section({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-2xl border border-border bg-surface shadow-[var(--shadow)]">
      <header className="flex items-baseline justify-between gap-3 px-5 pb-1 pt-4">
        <div>
          <h2 className="section">{title}</h2>
          <p className="meta mt-0.5">{hint}</p>
        </div>
        <span className="meta shrink-0">{count}</span>
      </header>
      <div className="divide-y divide-border px-5 pb-2">{children}</div>
    </section>
  );
}

function Row({
  name,
  line,
  quote,
  href,
  action,
  badge,
}: {
  name: string;
  line: string;
  quote?: string | null;
  href: string;
  action: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14px] font-semibold">{name}</span>
          {badge}
        </div>
        <p className="meta mt-0.5">{line}</p>
        {quote ? <p className="mt-1 truncate text-[13px] text-foreground/80">{quote}</p> : null}
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <Link href={href}>{action}</Link>
      </Button>
    </div>
  );
}

function attentionLine(item: AttentionItem, now: Date) {
  const prefix = SINCE_PREFIX[item.category];
  const owner = item.ownerName ? `Owner: ${item.ownerName}` : "No owner";
  const when = item.since
    ? item.category === "NEW_UNCONTACTED"
      ? `${prefix} ${elapsedLabel(item.since, now)}`
      : `${prefix} ${elapsedLabel(item.since, now)} ago`
    : item.headline;
  return `${when} · ${owner}`;
}

function AllClear({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 py-4 text-[13px] text-muted">
      <Check className="h-4 w-4 text-accent-text" aria-hidden />
      {children}
    </p>
  );
}

export function HomeView({
  data,
  greeting,
  firstName,
  timeZone,
  canSeeTeam,
  canWrite,
}: {
  data: HomeData;
  greeting: string;
  firstName: string;
  timeZone: string;
  canSeeTeam: boolean;
  canWrite: boolean;
}) {
  const { now } = data;
  const n = data.attentionCount;
  const team = data.scope === "team";

  return (
    <div className="page-in mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-8 md:py-10">
      <header>
        <h1 className="text-[28px] font-bold tracking-tight md:text-[32px]">
          {greeting}, {firstName}
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          {n === 0
            ? "You're all caught up. Nothing needs your attention right now."
            : `You have ${n} ${n === 1 ? "thing" : "things"} that ${n === 1 ? "needs" : "need"} your attention${team ? " across the team" : ""}.`}
        </p>
        {canSeeTeam ? (
          <nav aria-label="Scope" className="mt-3 inline-flex rounded-full border border-border bg-surface p-0.5 text-[12px]">
            {[
              { label: "My work", href: "/dashboard", on: !team },
              { label: "Whole team", href: "/dashboard?scope=team", on: team },
            ].map((t) => (
              <Link
                key={t.label}
                href={t.href}
                aria-current={t.on ? "page" : undefined}
                className={`rounded-full px-3 py-1 font-medium ${t.on ? "bg-brand text-white" : "text-muted hover:text-foreground"}`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      <Section title="Respond now" hint="Leads waiting on you" count={data.respondNow.length}>
        {data.respondNow.length === 0 ? (
          <AllClear>Everyone has been answered.</AllClear>
        ) : (
          data.respondNow.map((item) => (
            <Row
              key={item.leadId}
              name={item.leadName}
              line={attentionLine(item, now)}
              quote={item.detail}
              href={item.action.href}
              action={item.action.label}
              badge={
                item.category === "MISSED_CALL" ? (
                  <Badge tone="danger">Missed call</Badge>
                ) : item.category === "NEW_UNCONTACTED" ? (
                  <Badge tone="accent">New lead</Badge>
                ) : null
              }
            />
          ))
        )}
      </Section>

      <Section title="Follow up today" hint="Due today or overdue" count={data.followUps.length}>
        {data.followUps.length === 0 ? (
          <AllClear>No follow-ups due.</AllClear>
        ) : (
          data.followUps.map((f) => (
            <Row
              key={f.key}
              name={f.title}
              line={`${f.overdue ? "Overdue since" : "Due"} ${f.dueAt ? formatDate(f.dueAt, timeZone) : "today"}${f.context ? ` · ${f.context}` : ""}`}
              href={f.href}
              action={f.actionLabel}
              badge={f.overdue ? <Badge tone="danger">Overdue</Badge> : null}
            />
          ))
        )}
      </Section>

      <Section title="Today" hint="Appointments" count={data.appointments.length}>
        {data.appointments.length === 0 ? (
          <p className="flex items-center gap-2 py-4 text-[13px] text-muted">
            <CalendarDays className="h-4 w-4" aria-hidden /> No appointments today.
          </p>
        ) : (
          data.appointments.map((a) => (
            <Row
              key={a.id}
              name={`${formatTime(a.startAt, timeZone)} · ${a.title}`}
              line={a.contactName ?? "No contact linked"}
              href={a.href}
              action="Open"
            />
          ))
        )}
      </Section>

      {data.unassigned.length > 0 ? (
        <Section title="Needs an owner" hint="Nobody is working these yet" count={data.unassigned.length}>
          {data.unassigned.map((item) => (
            <Row
              key={item.leadId}
              name={item.leadName}
              line={`Added ${item.since ? elapsedLabel(item.since, now) : "recently"} ago`}
              href={item.action.href}
              action={canWrite ? "Assign" : "Open"}
            />
          ))}
        </Section>
      ) : null}

      <Section title="Going cold" hint="No activity for 2+ weeks and nothing scheduled" count={data.goingCold.length}>
        {data.goingCold.length === 0 ? (
          <AllClear>No leads are going cold.</AllClear>
        ) : (
          data.goingCold.map((item) => (
            <Row
              key={item.leadId}
              name={item.leadName}
              line={`${item.detail ?? ""}${item.ownerName ? ` · Owner: ${item.ownerName}` : ""}`}
              href={item.action.href}
              action={item.action.label}
            />
          ))
        )}
      </Section>
    </div>
  );
}
