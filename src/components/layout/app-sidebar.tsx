"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarDays,
  Contact,
  Home,
  Kanban,
  LayoutDashboard,
  MessageCircle,
  ScrollText,
  Settings,
  Target,
  Users,
  CheckSquare,
  FileText,
  Sparkles,
  Workflow,
  BarChart3,
  Rocket,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/dashboard-ui";
import { roleHasPermission, type Permission } from "@/lib/authz";
import type { WorkspaceRole } from "@prisma/client";

const nav: Array<{ href: string; label: string; icon: typeof Rocket; permission?: Permission }> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/golden-path", label: "Golden Path", icon: Rocket },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/opportunities", label: "Opportunities", icon: Target },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/properties", label: "Properties", icon: Home },
  { href: "/accounts", label: "Accounts", icon: Building2 },
  { href: "/contacts", label: "Contacts", icon: Contact },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/proposals", label: "Proposals", icon: FileText },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/insights", label: "Insights", icon: Sparkles },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/automations", label: "Automations", icon: Workflow },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/audit", label: "Audit Log", icon: ScrollText, permission: "audit:read" },
];

export function AppSidebar({
  userName,
  workspaceName,
  companyName,
  calendarDemo,
  whatsappDemo,
  userRole,
  onNavigate,
}: {
  userRole?: string | null;
  userName: string;
  workspaceName: string;
  companyName?: string;
  calendarDemo: boolean;
  whatsappDemo: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-fg">
      <div className="shrink-0 px-5 py-6">
        <div className="text-[15px] font-bold tracking-tight text-accent">{companyName ?? "Synas Realty"}</div>
        <div className="mt-0.5 text-[15px] font-semibold">Lead-to-Sale</div>
        <div className="mt-1 text-[11px] text-sidebar-muted">Real Estate CRM · Pakistan</div>
      </div>
      <nav className="sidebar-scroll flex-1 space-y-0.5 px-3 pb-4">
        {nav
          .filter((item) => !item.permission || (userRole && roleHasPermission(userRole as WorkspaceRole, item.permission)))
          .map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-[12px] px-3 py-2 text-[13px] font-medium",
                active ? "bg-[var(--sidebar-active)] text-white" : "text-sidebar-muted hover:bg-[var(--sidebar-hover)] hover:text-white",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg",
                  active ? "bg-white/15" : "bg-transparent",
                )}
              >
                <Icon className={cn("h-4 w-4", item.label === "WhatsApp" && "text-[#25D366]")} />
              </span>
              {item.label === "WhatsApp" ? (
                <span className="text-[#25D366]">{item.label}</span>
              ) : (
                item.label
              )}
            </Link>
          );
        })}
      </nav>
      <div className="shrink-0 border-t border-[var(--sidebar-line)] px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="relative h-8 w-8 shrink-0" aria-hidden>
            <svg viewBox="0 0 36 36" className="h-8 w-8">
              <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2.25" />
              <path
                d="M18 2.25 a15.75 15.75 0 0 0 0 31.5"
                fill="none"
                stroke="#25D366"
                strokeWidth="2.25"
                strokeLinecap="round"
                opacity={whatsappDemo ? 0.5 : 1}
              />
              <path
                d="M18 2.25 a15.75 15.75 0 0 1 0 31.5"
                fill="none"
                stroke="#00dccd"
                strokeWidth="2.25"
                strokeLinecap="round"
                opacity={calendarDemo ? 0.5 : 1}
              />
            </svg>
            <div className="absolute inset-[4px] flex items-center justify-center rounded-full bg-accent text-[9px] font-bold text-[#042f2e]">
              {initials(userName)}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold leading-tight" title={workspaceName}>
              {userName}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="text-[8px] font-semibold uppercase tracking-[0.16em] text-sidebar-muted">On desk</span>
              <DeskLamp channel="whatsapp" demo={whatsappDemo} />
              <DeskLamp channel="calendar" demo={calendarDemo} />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function DeskLamp({
  channel,
  demo,
}: {
  channel: "whatsapp" | "calendar";
  demo: boolean;
}) {
  let label: string;
  let tone: string;
  let Icon: typeof MessageCircle;
  switch (channel) {
    case "whatsapp":
      label = demo ? "WhatsApp demo" : "WhatsApp connected";
      tone = "text-[#25D366]";
      Icon = MessageCircle;
      break;
    case "calendar":
      label = demo ? "Calendar demo" : "Calendar connected";
      tone = "text-accent";
      Icon = CalendarDays;
      break;
    default: {
      const _exhaustive: never = channel;
      throw new Error(`Unhandled desk channel: ${String(_exhaustive)}`);
    }
  }
  return (
    <span title={label} className={cn("inline-flex", tone, !demo && "desk-lamp-live")}>
      <Icon className="h-3 w-3" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function useCommandOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

export type SearchHit = {
  leads: Array<{ id: string; firstName: string; lastName?: string | null; company?: string | null }>;
  accounts: Array<{ id: string; company: string }>;
  contacts: Array<{ id: string; firstName: string; lastName?: string | null }>;
  properties: Array<{ id: string; title: string; area?: string | null }>;
  opportunities: Array<{ id: string; name: string }>;
  tasks: Array<{ id: string; title: string }>;
  proposals: Array<{ id: string; proposalNumber: string }>;
};

const COMMANDS = [
  { href: "/golden-path", label: "Run Golden Path", hint: "Lead-to-sale demo" },
  { href: "/leads", label: "Create Lead", hint: "Open leads" },
  { href: "/opportunities", label: "Create Opportunity" },
  { href: "/properties", label: "Create Property" },
  { href: "/tasks", label: "Create Task" },
  { href: "/calendar", label: "Schedule Site Visit" },
  // Lead-scoped: open the lead being viewed, otherwise the lead list (no hard-coded seed lead id).
  { href: "lead", label: "Analyze Lead" },
  { href: "lead", label: "Find Property Match" },
  { href: "lead", label: "Draft WhatsApp Follow-up" },
  { href: "/proposals", label: "Create Proposal" },
  { href: "/tasks", label: "Show Overdue" },
  { href: "/leads", label: "Show High-Value Leads" },
];

export function CommandCenter({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const currentLeadId = /^\/leads\/([^/]+)/.exec(pathname)?.[1];
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (!q.trim()) {
        setHits(null);
        return;
      }
      void fetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then(setHits)
        .catch(() => setHits(null));
    }, 120);
    return () => clearTimeout(t);
  }, [q, open]);

  const filteredCommands = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return COMMANDS;
    return COMMANDS.filter((c) => c.label.toLowerCase().includes(n));
  }, [q]);

  if (!open) return null;

  function go(href: string) {
    onOpenChange(false);
    setQ("");
    router.push(href);
  }

  return (
    <div className="fixed inset-0 z-[80] bg-foreground/20 p-4 backdrop-blur-[2px]" onClick={() => onOpenChange(false)}>
      <div
        role="dialog"
        aria-label="Command center"
        className="mx-auto mt-[12vh] w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search leads, properties, opportunities…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-[14px] outline-none"
        />
        <div className="max-h-[52vh] overflow-y-auto py-2">
          <p className="section-kicker px-4 py-2">Commands</p>
          {filteredCommands.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => go(c.href !== "lead" ? c.href : currentLeadId ? `/leads/${currentLeadId}` : "/leads")}
              className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-background"
            >
              <span>{c.label}</span>
              <span className="meta">{c.hint ?? (c.href === "lead" && !currentLeadId ? "Pick a lead" : "")}</span>
            </button>
          ))}
          {hits ? (
            <>
              {hits.leads.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => go(`/leads/${l.id}`)}
                  className="flex w-full px-4 py-2 text-left text-sm hover:bg-background"
                >
                  Lead · {l.firstName} {l.lastName ?? ""}
                </button>
              ))}
              {hits.properties.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => go(`/properties/${p.id}`)}
                  className="flex w-full px-4 py-2 text-left text-sm hover:bg-background"
                >
                  Property · {p.title}
                </button>
              ))}
              {hits.opportunities.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => go(`/opportunities/${o.id}`)}
                  className="flex w-full px-4 py-2 text-left text-sm hover:bg-background"
                >
                  Opportunity · {o.name}
                </button>
              ))}
              {hits.accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => go(`/accounts/${a.id}`)}
                  className="flex w-full px-4 py-2 text-left text-sm hover:bg-background"
                >
                  Account · {a.company}
                </button>
              ))}
              {hits.contacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => go(`/contacts/${c.id}`)}
                  className="flex w-full px-4 py-2 text-left text-sm hover:bg-background"
                >
                  Contact · {c.firstName} {c.lastName ?? ""}
                </button>
              ))}
              {hits.tasks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => go("/tasks")}
                  className="flex w-full px-4 py-2 text-left text-sm hover:bg-background"
                >
                  Task · {t.title}
                </button>
              ))}
              {hits.proposals.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => go("/proposals")}
                  className="flex w-full px-4 py-2 text-left text-sm hover:bg-background"
                >
                  Proposal · {p.proposalNumber}
                </button>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
