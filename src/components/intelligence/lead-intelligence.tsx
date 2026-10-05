"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCan } from "@/components/providers/permissions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScoreRail } from "@/components/editorial";
import { formatMoney } from "@/lib/format";
import { plainMatchSummary } from "@/lib/matching/properties";

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
  reasons: Array<{ factor: string; detail: string; points?: number }>;
  caution: string | null;
};

type History = { previousScore: number; newScore: number; reason: string; createdAt: string };

/** The stored run behind the analysis shown, so a manager can approve or reject it (POST /api/intelligence/review). */
export type AnalysisRunInfo = {
  id: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

export function reviewStatusLabel(run: AnalysisRunInfo): string {
  if (run.status === "APPROVED") return `Approved${run.reviewedBy ? ` by ${run.reviewedBy}` : ""}`;
  if (run.status === "REJECTED") return `Rejected${run.reviewedBy ? ` by ${run.reviewedBy}` : ""}`;
  return "Not yet reviewed";
}

export function LeadIntelligencePanel({
  leadId,
  conversationId,
  fitScore,
  intentScore,
  valueScore,
  leadScore,
  analysis,
  analysisRun,
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
  analysisRun: AnalysisRunInfo | null;
  matches: Match[];
  history: History[];
}) {
  const router = useRouter();
  const canRun = useCan("intelligence:run");
  const canScore = useCan("scoring:run");
  const canSchedule = useCan("calendar:write");
  const canSend = useCan("whatsapp:send");
  const canReview = useCan("intelligence:review");
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
      const data = await res.json().catch(() => ({}));
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
    setNotice(null);
    try {
      const res = await fetch("/api/scoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const data = await res.json().catch(() => ({}));
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
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/whatsapp/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, leadId, body: draft.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save draft");
      setNotice("WhatsApp draft saved. Review it in the thread before sending.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function review(status: "APPROVED" | "REJECTED") {
    if (!analysisRun) return;
    setBusy("review");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/intelligence/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: analysisRun.id, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not record the review");
      setNotice(data.notice ?? "Review recorded.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the review");
    } finally {
      setBusy(null);
    }
  }

  async function scheduleVisit() {
    setBusy("visit");
    setError(null);
    setNotice(null);
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not schedule");
      setNotice(data.message ?? "Site visit saved to the CRM calendar.");
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
            <div className="section-kicker">Lead Qualification</div>
            <h2 className="section mt-1">What we know about this lead</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {canRun ? (
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("LEAD_ANALYSIS")}>
                {busy === "LEAD_ANALYSIS" ? "Reviewing…" : "Review lead"}
              </Button>
            ) : null}
            {canScore ? (
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void rescore()}>
                Refresh score
              </Button>
            ) : null}
            {canRun ? (
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("PROPERTY_MATCH")}>
                Find property matches
              </Button>
            ) : null}
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
            {analysisRun ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
                <span className="meta" data-testid="review-status">
                  Review: {reviewStatusLabel(analysisRun)}
                </span>
                {canReview && !busy ? (
                  <>
                    {analysisRun.status !== "APPROVED" ? (
                      <Button size="sm" variant="outline" onClick={() => void review("APPROVED")}>
                        Approve
                      </Button>
                    ) : null}
                    {analysisRun.status !== "REJECTED" ? (
                      <Button size="sm" variant="outline" onClick={() => void review("REJECTED")}>
                        Reject
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted">
            {canRun
              ? "Run analysis to ground a recommendation in this lead’s CRM record."
              : "No analysis has been run for this lead yet."}
          </p>
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
            <div className="section-kicker">Property Matches</div>
            <h3 className="section mt-1">Homes that fit these requirements</h3>
          </div>
        </div>
        {liveMatches.length === 0 ? (
          <p className="mt-4 text-sm text-muted">We couldn’t find properties matching these requirements.</p>
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
                  <div className="mt-1 text-[13px]">{plainMatchSummary(m.reasons)}</div>
                  <div className="money mt-2 text-[18px] font-medium">{formatMoney(Number(m.property.price))}</div>
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
        {!canRun && !canSchedule ? <p className="mt-3 text-sm text-muted">Your role is view-only.</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {canRun ? (
            <>
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("CALL_PREPARATION")}>
                Prepare for call
              </Button>
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("SITE_VISIT_PREPARATION")}>
                Prepare for showing
              </Button>
            </>
          ) : null}
          {canSchedule ? (
            <Button size="sm" variant="accent" disabled={Boolean(busy)} onClick={() => void scheduleVisit()}>
              Schedule showing
            </Button>
          ) : null}
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

      {canRun ? <div className="hairline" /> : null}

      {canRun ? (
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="section-kicker">Suggested Reply</div>
            <h3 className="section mt-1">Edit it, then send it from the conversation</h3>
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
            Suggest {draftChannel === "WHATSAPP" ? "WhatsApp follow-up" : draftChannel.toLowerCase()}
          </Button>
          {draftChannel === "WHATSAPP" && canSend ? (
            <Button size="sm" variant="outline" disabled={!draft.trim() || Boolean(busy)} onClick={() => void saveDraft()}>
              Save as draft
            </Button>
          ) : null}
        </div>
        <Textarea
          aria-label="Suggested reply"
          className="mt-4"
          rows={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Your suggested reply appears here. Edit it before anything is sent."
        />
        <p className="meta mt-2">Suggested replies are never sent automatically. Review it, then send it from the conversation.</p>
      </section>
      ) : null}

      {notice ? (
        <p role="status" className="text-sm text-accent-text">
          {notice}
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
