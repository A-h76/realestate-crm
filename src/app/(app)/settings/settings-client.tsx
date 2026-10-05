"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DemoBanner } from "@/components/demo-banner";
import { Badge } from "@/components/ui/badge";
import { InvitationBadge, type MemberInvitation } from "@/components/team/invitation-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ASSIGNABLE_ROLES, memberChangeDenial } from "@/lib/authz";
import { US_TIME_ZONES as US_TIME_ZONE_OPTIONS } from "@/lib/validations/common";
import type { WorkspaceRole } from "@prisma/client";

export type BrandingFields = {
  companyName: string;
  displayName: string;
  logoUrl?: string | null;
  accentColor: string;
};

export type Tab = "workspace" | "pipeline" | "team" | "integrations" | "branding";

export function SettingsClient({
  branding,
  workspaceName,
  timezone,
  currency,
  isDemo,
  viewer,
  members,
  stages,
  integrations,
  initialTab = "branding",
  tabs = ["workspace", "pipeline", "team", "integrations", "branding"],
}: {
  viewer: { userId: string; role: WorkspaceRole; canEditWorkspace: boolean; canResetDemo: boolean; canManageMembers: boolean };
  branding: BrandingFields | null;
  workspaceName: string;
  timezone: string;
  currency: string;
  isDemo: boolean;
  members: Array<{
    userId: string;
    name: string;
    email: string;
    role: WorkspaceRole;
    invitation: MemberInvitation | null;
  }>;
  stages: Array<{ name: string; probability: number }>;
  integrations: {
    calendar: string;
    calendarDemo: boolean;
    whatsapp: string;
    whatsappDemo: boolean;
    whatsappMode: "live" | "misconfigured" | "demo" | "disabled";
    whatsappDetail: string;
  };
  /** Which section is open first (tests render the Team section directly). */
  initialTab?: Tab;
  /** Sections shown in the section switcher; /team and /integrations each render a single section. */
  tabs?: Tab[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [resetting, setResetting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    companyName: branding?.companyName ?? workspaceName,
    displayName: branding?.displayName ?? workspaceName,
    logoUrl: branding?.logoUrl ?? "",
    accentColor: branding?.accentColor ?? "#0D9488",
  });
  const [locale, setLocale] = useState({ timezone, currency });
  const [savingLocale, setSavingLocale] = useState(false);
  const [invite, setInvite] = useState({ email: "", name: "", role: "AGENT" as WorkspaceRole });
  const [inviting, setInviting] = useState(false);
  const [setupLink, setSetupLink] = useState<{ url: string; expiresAt: string; email: string } | null>(null);
  const [reissuing, setReissuing] = useState<string | null>(null);

  async function inviteMember(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setMessage(null);
    setError(null);
    setSetupLink(null);
    try {
      const res = await fetch("/api/workspace/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invite),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to add member");
      setInvite({ email: "", name: "", role: "AGENT" });
      if (data.setupUrl) {
        setSetupLink({ url: data.setupUrl, expiresAt: data.setupExpiresAt, email: data.member.email });
      } else {
        setMessage(`${data.member.email} added to the workspace.`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setInviting(false);
    }
  }

  async function resetDemo() {
    if (!confirm("Reset demo data? This will restore seed demo records. Continue?")) return;
    setResetting(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to reset demo");
      setMessage("Demo workspace reset complete.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset demo");
    } finally {
      setResetting(false);
    }
  }

  /** Issues a fresh one-time link for a member who never finished setup (the old link stops working). */
  async function reissueLink(m: { userId: string; name: string; email: string; role: WorkspaceRole }) {
    setReissuing(m.userId);
    setMessage(null);
    setError(null);
    setSetupLink(null);
    try {
      const res = await fetch("/api/workspace/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: m.email, name: m.name, role: m.role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not create a new link");
      if (data.setupUrl) setSetupLink({ url: data.setupUrl, expiresAt: data.setupExpiresAt, email: m.email });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a new link");
    } finally {
      setReissuing(null);
    }
  }

  async function changeMember(userId: string, role: WorkspaceRole | null) {
    if (role === null && !confirm("Remove this member from the workspace?")) return;
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/members/${userId}`, {
        method: role ? "PATCH" : "DELETE",
        headers: role ? { "Content-Type": "application/json" } : undefined,
        body: role ? JSON.stringify({ role }) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      setMessage(role ? "Role updated." : "Member removed.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function saveBranding(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.companyName,
          displayName: form.displayName,
          logoUrl: form.logoUrl || null,
          accentColor: form.accentColor,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMessage("Branding updated. CRM data is unchanged.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  /** Writes only the locale fields; branding is left untouched by this request. */
  async function saveLocale(e: React.FormEvent) {
    e.preventDefault();
    setSavingLocale(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: locale.timezone, currency: locale.currency }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMessage("Workspace locale updated. Dates and times now display in this time zone.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingLocale(false);
    }
  }

  return (
    <div className="space-y-8">
      {tabs.length > 1 ? (
      <nav aria-label="Settings sections" className="flex flex-wrap gap-4 text-sm">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? "true" : undefined}
            className={tab === t ? "font-medium text-foreground underline underline-offset-4" : "text-muted hover:text-foreground"}
          >
            {t === "pipeline" ? "Pipeline stages" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      ) : null}

      {tab === "workspace" ? (
        <section className="space-y-3">
          {isDemo ? (
            <DemoBanner
              label="Demo Mode"
              detail="WhatsApp uses the demo provider unless live mode is configured (see Integrations). The calendar is internal only."
            />
          ) : null}
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="section-kicker">Workspace</dt>
              <dd className="mt-1 text-sm">{workspaceName}</dd>
            </div>
            <div>
              <dt className="section-kicker">Demo mode</dt>
              <dd className="mt-1">
                <Badge tone={isDemo ? "accent" : "neutral"}>{isDemo ? "ON" : "OFF"}</Badge>
              </dd>
            </div>
          </dl>
          {viewer.canEditWorkspace ? (
            <form onSubmit={saveLocale} className="space-y-3 border-t border-border pt-6">
              <div>
                <div className="section-kicker">Locale</div>
                <p className="mt-2 text-sm text-muted">
                  Every date, time and SLA clock in the app is shown in this time zone. Amounts are
                  formatted in this currency.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="ws-timezone">Time zone</Label>
                  <select
                    id="ws-timezone"
                    className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm"
                    value={locale.timezone}
                    onChange={(e) => setLocale((s) => ({ ...s, timezone: e.target.value }))}
                  >
                    {US_TIME_ZONE_OPTIONS.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone.split("/").pop()?.replaceAll("_", " ")} ({zone})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ws-currency">Currency</Label>
                  <select
                    id="ws-currency"
                    className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm"
                    value={locale.currency}
                    onChange={(e) => setLocale((s) => ({ ...s, currency: e.target.value }))}
                  >
                    <option value="USD">USD — US Dollar</option>
                  </select>
                </div>
              </div>
              <Button type="submit" disabled={savingLocale}>
                {savingLocale ? "Saving…" : "Save locale"}
              </Button>
            </form>
          ) : null}
          {isDemo && viewer.canResetDemo ? (
            <div className="pt-6">
              <div className="section-kicker">Danger zone</div>
              <p className="mt-2 text-sm text-muted">Restore the deterministic known-good demo.</p>
              <Button type="button" variant="danger" className="mt-4" disabled={resetting} onClick={() => void resetDemo()}>
                {resetting ? "Resetting…" : "Reset Demo"}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "pipeline" ? (
        <section className="divide-y divide-border">
          {stages.map((s) => (
            <div key={s.name} className="flex justify-between py-3 text-sm">
              <span>{s.name}</span>
              <span className="mono text-muted">{s.probability}%</span>
            </div>
          ))}
        </section>
      ) : null}

      {tab === "team" ? (
        <section className="space-y-6">
          {viewer.canManageMembers ? (
            <form onSubmit={(e) => void inviteMember(e)} className="max-w-md space-y-3 border-b border-border pb-6">
              <div className="section-kicker">Add a team member</div>
              {setupLink ? (
                <div className="space-y-2 text-sm text-muted" role="status">
                  <p>
                    Setup link for {setupLink.email}. No email is sent: copy it and share it privately. It works once,
                    expires {new Date(setupLink.expiresAt).toLocaleString()}, and is shown only now.
                  </p>
                  <Input readOnly aria-label="One-time setup link" value={setupLink.url} onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(setupLink.url)}>
                    Copy link
                  </Button>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="inviteName">Name</Label>
                  <Input
                    id="inviteName"
                    required
                    value={invite.name}
                    onChange={(e) => setInvite((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inviteEmail">Email</Label>
                  <Input
                    id="inviteEmail"
                    type="email"
                    required
                    value={invite.email}
                    onChange={(e) => setInvite((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="inviteRole">Role</Label>
                  <select
                    id="inviteRole"
                    className="h-9 border border-border bg-surface px-2 text-sm"
                    value={invite.role}
                    onChange={(e) => setInvite((f) => ({ ...f, role: e.target.value as WorkspaceRole }))}
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" size="sm" disabled={inviting}>
                  {inviting ? "Adding…" : "Add member"}
                </Button>
              </div>
            </form>
          ) : null}
          <div className="divide-y divide-border">
          {members.map((m) => {
            const editable =
              memberChangeDenial({ actorId: viewer.userId, actorRole: viewer.role, targetId: m.userId, targetRole: m.role }) ===
              null;
            return (
              <div key={m.userId} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>
                  {m.name}
                  <span className="meta ml-2">{m.email}</span>
                  <InvitationBadge invitation={m.invitation} />
                </span>
                {editable ? (
                  <span className="flex items-center gap-2">
                    <select
                      aria-label={`Role for ${m.name}`}
                      className="h-7 border border-border bg-surface px-2 text-xs"
                      value={m.role}
                      onChange={(e) => void changeMember(m.userId, e.target.value as WorkspaceRole)}
                    >
                      {ASSIGNABLE_ROLES.filter(
                        (r) =>
                          r === m.role ||
                          memberChangeDenial({
                            actorId: viewer.userId,
                            actorRole: viewer.role,
                            targetId: m.userId,
                            targetRole: m.role,
                            newRole: r,
                          }) === null,
                      ).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    {m.invitation ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={reissuing === m.userId}
                        onClick={() => void reissueLink(m)}
                      >
                        {reissuing === m.userId ? "Creating..." : "New setup link"}
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" onClick={() => void changeMember(m.userId, null)}>
                      Remove
                    </Button>
                  </span>
                ) : (
                  <span className="text-muted">
                    {m.role}
                    {m.userId === viewer.userId ? " · you" : ""}
                  </span>
                )}
              </div>
            );
          })}
          </div>
        </section>
      ) : null}

      {tab === "integrations" ? (
        <section className="space-y-6">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              WhatsApp
              <Badge tone={integrations.whatsappMode === "live" ? "success" : integrations.whatsappMode === "demo" ? "accent" : "warning"}>
                {integrations.whatsappMode === "live" ? "Live" : integrations.whatsappMode === "demo" ? "Demo" : "Not connected"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{integrations.whatsappDetail}</p>
          </div>
          <div>
            <div className="text-sm font-medium">Calendar</div>
            <p className="mt-1 text-sm text-muted">
              Provider {integrations.calendar}
              {" · internal CRM calendar. Events are not synced with Google Calendar or any other external calendar."}
            </p>
          </div>
          <div>
            <div className="text-sm font-medium">Not available yet</div>
            <p className="mt-1 text-sm text-muted">
              These are planned and are not connected: SMS, email (Gmail / Outlook), Google and Outlook calendar sync,
              webhooks / Zapier, lead-source integrations (Zillow, Realtor.com, Homes.com, Facebook Lead Ads) and
              MLS / IDX. Leads from those sources can be entered or imported manually and tagged with the source.
            </p>
          </div>
        </section>
      ) : null}

      {tab === "branding" ? (
        <form onSubmit={(e) => void saveBranding(e)} className="max-w-lg space-y-4">
          <p className="text-sm text-muted">
            Re-skin the product for a client. Underlying CRM records do not change.
            {viewer.canEditWorkspace ? null : " Only the workspace owner or an admin can change branding."}
          </p>
          <fieldset disabled={!viewer.canEditWorkspace} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="companyName">Company name</Label>
            <Input
              id="companyName"
              value={form.companyName}
              onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="logoUrl">Logo URL</Label>
            <Input
              id="logoUrl"
              value={form.logoUrl}
              onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="accentColor">Accent color</Label>
            <Input
              id="accentColor"
              value={form.accentColor}
              onChange={(e) => setForm((f) => ({ ...f, accentColor: e.target.value }))}
            />
          </div>
          <Button type="submit" variant="accent" disabled={saving}>
            {saving ? "Saving…" : "Save branding"}
          </Button>
          </fieldset>
        </form>
      ) : null}

      {message ? (
        <p role="status" className="text-sm text-accent-text">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
