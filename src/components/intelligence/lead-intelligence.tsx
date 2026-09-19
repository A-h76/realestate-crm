"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScoreRail } from "@/components/editorial";
import { formatCurrency } from "@/lib/format";

type Analysis = {
  fitScore: number;
  intentScore: number;
  valueScore: number;
  confidence: number;
  niche: string;
  likelyNeed: string;
  painPoints: string[];
  recommendedAction: string;
  reasoning: string;
};

type Match = {
  property: {
    id: string;
    title: string;
    area: string | null;
    price: string | number;
    bedrooms: number | null;
    bathrooms: number | null;
    status: string;
    propertyType: string;
  };
  matchScore: number;
  reasons: Array<{ factor: string; detail: string }>;
  caution: string | null;
};

type History = { previousScore: number; newScore: number; reason: string; createdAt: string };

export function LeadIntelligencePanel({
  leadId,
  conversationId,
  fitScore,
  intentScore,
  valueScore,
  leadScore,
  analysis,
  matches,
  history,
}: {
  leadId: string;
  conversationId: string;
  fitScore: number;
  intentScore: number;
  valueScore: number;
  leadScore: number;
  analysis: Analysis | null;
  matches: Match[];
  history: History[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [liveAnalysis, setLiveAnalysis] = useState(analysis);
  const [liveMatches, setLiveMatches] = useState(matches);
  const [draft, setDraft] = useState("");
  const [draftChannel, setDraftChannel] = useState<"WHATSAPP" | "EMAIL" | "LINKEDIN">("WHATSAPP");
  const [prep, setPrep] = useState<Record<string, unknown> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: string, extra?: Record<string, unknown>) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, leadId, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      if (kind === "LEAD_ANALYSIS") setLiveAnalysis(data.output);
      if (kind === "PROPERTY_MATCH") {
        setLiveMatches(data.scored ?? []);
      }
      if (kind === "FOLLOW_UP_DRAFT" || kind === "EMAIL_DRAFT" || kind === "LINKEDIN_DRAFT") {
        setDraft(data.output?.body ?? "");
        setNotice("Draft only. Edit before sending — nothing was sent.");
      }
      if (kind === "CALL_PREPARATION" || kind === "SITE_VISIT_PREPARATION") {
        setPrep(data.output);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function rescore() {
    setBusy("score");
    setError(null);
    try {
      const res = await fetch("/api/scoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scoring failed");
      setNotice(`Score ${data.previousScore} → ${data.lead.leadScore}. ${data.history.reason}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!draft.trim()) return;
    setBusy("save-draft");
    try {
      const res = await fetch("/api/whatsapp/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, leadId, body: draft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save draft");
      setNotice("WhatsApp draft saved. Review it in the thread before sending.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function scheduleVisit() {
    setBusy("visit");
    try {
      const start = new Date(Date.now() + 36 * 3600000);
      start.setMinutes(0, 0, 0);
      const end = new Date(start.getTime() + 2 * 3600000);
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Site visit",
          type: "SITE_VISIT",
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          location: liveMatches[0]?.property.area ?? "To confirm",
          leadId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not schedule");
      setNotice(data.message ?? "Site visit scheduled in Demo Calendar.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const a = liveAnalysis;

  return (
    <div className="space-y-8">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="section-kicker">Lead intelligence</div>
            <h2 className="section mt-1">Who needs attention, and why</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("LEAD_ANALYSIS")}>
              {busy === "LEAD_ANALYSIS" ? "Analyzing…" : "Analyze lead"}
            </Button>
            <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void rescore()}>
              Recalculate score
            </Button>
            <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("PROPERTY_MATCH")}>
              Find property match
            </Button>
          </div>
        </div>
        <div className="mt-6 grid gap-8 sm:grid-cols-4">
          <ScoreRail label="Fit" value={a?.fitScore ?? fitScore} />
          <ScoreRail label="Intent" value={a?.intentScore ?? intentScore} />
          <ScoreRail label="Value" value={a?.valueScore ?? valueScore} />
          <ScoreRail label="Confidence" value={a?.confidence ?? leadScore} />
        </div>
        {a ? (
          <div className="mt-8 space-y-4">
            <div className="section-kicker">Recommended action</div>
            <p className="section">{a.recommendedAction}</p>
            <p className="max-w-3xl text-[14px] leading-[22px] text-muted">{a.reasoning}</p>
            <div className="meta">
              {a.niche} · {a.likelyNeed}
            </div>
            {a.painPoints?.length ? (
              <ul className="space-y-1 text-sm text-muted">
                {a.painPoints.map((p) => (
                  <li key={p}>— {p}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted">Run analysis to ground a recommendation in this lead’s CRM record.</p>
        )}
        {history[0] ? (
          <p className="meta mt-4">
            {history[0].previousScore} → {history[0].newScore} · {history[0].reason}
          </p>
        ) : null}
      </section>

      <div className="hairline" />

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="section-kicker">Property match</div>
            <h3 className="section mt-1">What fits this brief</h3>
          </div>
        </div>
        {liveMatches.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No available listings passed the deterministic filter.</p>
        ) : (
          <div className="mt-6 divide-y divide-border">
            {liveMatches.map((m) => (
              <div key={m.property.id} className="grid gap-6 py-5 md:grid-cols-[140px_1fr]">
                <div>
                  <div className="section-kicker">Match</div>
                  <div className="display mt-1">{m.matchScore}%</div>
                </div>
                <div>
                  <div className="section">{m.property.title}</div>
                  <div className="mt-1 text-[14px] text-muted">{m.property.area}</div>
                  <div className="money mt-2 text-[18px] font-medium">{formatCurrency(Number(m.property.price))}</div>
                  <div className="meta mt-1">
                    {m.property.bedrooms ?? "—"} Beds · {m.property.bathrooms ?? "—"} Baths · {m.property.status}
                  </div>
                  <div className="mt-4">
                    <div className="section-kicker">Why this matches</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {m.reasons.map((r) => (
                        <div key={r.factor} className="text-sm">
                          <span className="text-muted">{r.factor}</span>
                          <span className="mx-2 text-border">/</span>
                          {r.detail}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="hairline" />

      <section>
        <div className="section-kicker">Preparation</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("CALL_PREPARATION")}>
            Prepare for call
          </Button>
          <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("SITE_VISIT_PREPARATION")}>
            Prepare for site visit
          </Button>
          <Button size="sm" variant="accent" disabled={Boolean(busy)} onClick={() => void scheduleVisit()}>
            Schedule site visit
          </Button>
        </div>
        {prep ? (
          <div className="mt-5 max-w-3xl space-y-3 text-sm leading-relaxed">
            {"leadSummary" in prep ? <p>{String(prep.leadSummary)}</p> : null}
            {"recommendedNextStep" in prep ? (
              <p className="text-muted">Next: {String(prep.recommendedNextStep)}</p>
            ) : null}
            {"questions" in prep && Array.isArray(prep.questions) ? (
              <ul className="space-y-1 text-muted">
                {(prep.questions as string[]).slice(0, 4).map((q) => (
                  <li key={q}>— {q}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="hairline" />

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="section-kicker">Follow-up draft</div>
            <h3 className="section mt-1">Write, then send</h3>
          </div>
          <div className="flex gap-2">
            {(["WHATSAPP", "EMAIL", "LINKEDIN"] as const).map((ch) => (
              <Button
                key={ch}
                size="sm"
                variant={draftChannel === ch ? "default" : "outline"}
                onClick={() => setDraftChannel(ch)}
              >
                {ch === "WHATSAPP" ? "WhatsApp" : ch === "EMAIL" ? "Email" : "LinkedIn"}
              </Button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="accent"
            disabled={Boolean(busy)}
            onClick={() =>
              void run(
                draftChannel === "EMAIL"
                  ? "EMAIL_DRAFT"
                  : draftChannel === "LINKEDIN"
                    ? "LINKEDIN_DRAFT"
                    : "FOLLOW_UP_DRAFT",
              )
            }
          >
            Draft {draftChannel === "WHATSAPP" ? "WhatsApp follow-up" : draftChannel.toLowerCase()}
          </Button>
          {draftChannel === "WHATSAPP" ? (
            <Button size="sm" variant="outline" disabled={!draft.trim() || Boolean(busy)} onClick={() => void saveDraft()}>
              Save as WhatsApp draft
            </Button>
          ) : null}
        </div>
        <Textarea
          className="mt-4"
          rows={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Draft appears here. Edit before anything is sent."
        />
        <p className="meta mt-2">Never auto-sent. Approve in the thread if you want it logged as a demo message.</p>
      </section>

      {notice ? <p className="text-sm text-accent">{notice}</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
