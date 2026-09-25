"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DemoBanner } from "@/components/demo-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ASSIGNABLE_ROLES, memberChangeDenial } from "@/lib/authz";
import type { WorkspaceRole } from "@prisma/client";

export type BrandingFields = {
  companyName: string;
  displayName: string;
  logoUrl?: string | null;
  accentColor: string;
};

type Tab = "workspace" | "pipeline" | "team" | "integrations" | "branding";

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
}: {
  viewer: { userId: string; role: WorkspaceRole; canEditWorkspace: boolean; canResetDemo: boolean };
  branding: BrandingFields | null;
  workspaceName: string;
  timezone: string;
  currency: string;
  isDemo: boolean;
  members: Array<{ userId: string; name: string; email: string; role: WorkspaceRole }>;
  stages: Array<{ name: string; probability: number }>;
  integrations: {
    calendar: string;
    calendarDemo: boolean;
    whatsapp: string;
    whatsappDemo: boolean;
  };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("branding");
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

  const tabs: Tab[] = ["workspace", "pipeline", "team", "integrations", "branding"];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-4 text-sm">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={tab === t ? "text-foreground" : "text-muted"}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "workspace" ? (
        <section className="space-y-3">
          <DemoBanner
            label="Demo Mode"
            detail="WhatsApp and Calendar providers are demo-only unless credentials are configured"
          />
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="section-kicker">Workspace</dt>
              <dd className="mt-1 text-sm">{workspaceName}</dd>
            </div>
            <div>
              <dt className="section-kicker">Timezone</dt>
              <dd className="mt-1 text-sm">{timezone}</dd>
            </div>
            <div>
              <dt className="section-kicker">Currency</dt>
              <dd className="mt-1 text-sm">{currency}</dd>
            </div>
            <div>
              <dt className="section-kicker">isDemo</dt>
              <dd className="mt-1">
                <Badge tone={isDemo ? "accent" : "neutral"}>{isDemo ? "ON" : "OFF"}</Badge>
              </dd>
            </div>
          </dl>
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
        <section className="divide-y divide-border">
          {members.map((m) => {
            const editable =
              memberChangeDenial({ actorId: viewer.userId, actorRole: viewer.role, targetId: m.userId, targetRole: m.role }) ===
              null;
            return (
              <div key={m.userId} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>
                  {m.name}
                  <span className="meta ml-2">{m.email}</span>
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
        </section>
      ) : null}

      {tab === "integrations" ? (
        <section className="space-y-6">
          <div>
            <div className="text-sm font-medium">WhatsApp</div>
            <p className="mt-1 text-sm text-muted">
              Provider {integrations.whatsapp}
              {integrations.whatsappDemo ? " · demo (no Cloud API send)" : " · production architecture armed"}
            </p>
          </div>
          <div>
            <div className="text-sm font-medium">Calendar</div>
            <p className="mt-1 text-sm text-muted">
              Provider {integrations.calendar}
              {integrations.calendarDemo ? " · demo (no Google write)" : " · Google architecture armed"}
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

      {message ? <p className="text-sm text-accent">{message}</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
