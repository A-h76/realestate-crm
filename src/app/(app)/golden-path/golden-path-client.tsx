"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type StageIds = { new: string | null; proposal: string | null; won: string | null };
type Property = { id: string; title: string } | null;

const STEP_DEFS = [
  { id: "capture", title: "Incoming Lead", detail: "Simulate a Facebook Ad lead" },
  { id: "intelligence", title: "Intelligence", detail: "AI lead analysis" },
  { id: "score", title: "Score", detail: "Deterministic lead scoring" },
  { id: "assign", title: "Assignment", detail: "Least-loaded eligible agent" },
  { id: "match", title: "Property Match", detail: "Score properties against the lead brief" },
  { id: "followup", title: "Follow-up", detail: "Draft + log a WhatsApp message (demo provider)" },
  { id: "visit", title: "Site Visit", detail: "Schedule a calendar event (demo provider)" },
  { id: "qualify", title: "Qualification", detail: "Agent reviews the AI recommendation and confirms" },
  { id: "opportunity", title: "Opportunity", detail: "Open a deal linked to the lead + property" },
  { id: "proposal", title: "Proposal", detail: "Create and send a proposal" },
  { id: "accepted", title: "Accepted", detail: "Simulate client acceptance (demo)" },
  { id: "won", title: "Won", detail: "Move the opportunity to the Won stage" },
  { id: "revenue", title: "Revenue + Audit", detail: "Confirm dashboard revenue and audit trail" },
] as const;

type StepId = (typeof STEP_DEFS)[number]["id"];
type StepStatus = "pending" | "running" | "waiting" | "done" | "error";
type StepState = { id: StepId; status: StepStatus; notice?: string; error?: string };

type Ctx = {
  leadId?: string;
  opportunityId?: string;
  proposalId?: string;
  calendarEventId?: string;
  linkedPropertyId?: string;
  ownerName?: string;
};

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${method} ${path} failed (${res.status})`);
  return data;
}

const indexOf = (id: StepId) => STEP_DEFS.findIndex((s) => s.id === id);

export function GoldenPathClient({ stageIds, property }: { stageIds: StageIds; property: Property }) {
  const [steps, setSteps] = useState<StepState[]>(
    STEP_DEFS.map((s) => ({ id: s.id, status: "pending" })),
  );
  const [ctx, setCtx] = useState<Ctx>({});
  const [running, setRunning] = useState(false);

  function setStep(id: StepId, patch: Partial<StepState>) {
    setSteps((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function runStep(id: StepId, currentCtx: Ctx): Promise<{ status: "done" | "waiting"; ctx: Ctx }> {
    setStep(id, { status: "running", error: undefined });
    switch (id) {
      case "capture": {
        const data = await call("POST", "/api/leads/simulate-inbound");
        setStep(id, { status: "done", notice: data.notice });
        return { status: "done", ctx: { ...currentCtx, leadId: data.lead.id } };
      }
      case "intelligence": {
        const data = await call("POST", "/api/intelligence", {
          kind: "LEAD_ANALYSIS",
          leadId: currentCtx.leadId,
        });
        setStep(id, { status: "done", notice: data.output?.recommendedAction ?? "Analysis complete" });
        return { status: "done", ctx: currentCtx };
      }
      case "score": {
        const data = await call("POST", "/api/scoring", { leadId: currentCtx.leadId });
        setStep(id, { status: "done", notice: `Lead score: ${data.lead?.leadScore}` });
        return { status: "done", ctx: currentCtx };
      }
      case "assign": {
        const res = await fetch(`/api/leads/${currentCtx.leadId}/assign`, { method: "POST" });
        if (res.status === 403) {
          // Assignment is a manager action (leads:assign); an agent walks the rest of the path as lead owner.
          setStep(id, { status: "done", notice: "Skipped: assigning leads needs a Manager or Owner" });
          return { status: "done", ctx: currentCtx };
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Assign failed (${res.status})`);
        setStep(id, {
          status: "done",
          notice: `Assigned to ${data.assignment.agentName} (least-loaded: ${data.assignment.openLeadCount} open leads)`,
        });
        return { status: "done", ctx: { ...currentCtx, ownerName: data.assignment.agentName } };
      }
      case "match": {
        const data = await call("POST", "/api/intelligence", {
          kind: "PROPERTY_MATCH",
          leadId: currentCtx.leadId,
        });
        const best = data.scored?.[0];
        setStep(id, {
          status: "done",
          notice: best ? `Best match ${best.matchScore}% · ${best.property.title}` : "No property match found",
        });
        return {
          status: "done",
          ctx: { ...currentCtx, linkedPropertyId: best?.property?.id ?? property?.id },
        };
      }
      case "followup": {
        await call("POST", "/api/intelligence", { kind: "FOLLOW_UP_DRAFT", leadId: currentCtx.leadId });
        const wa = await call("POST", "/api/whatsapp/messages", {
          conversationId: `lead:${currentCtx.leadId}`,
          body: "Assalam o Alaikum — confirming your interest, we found a few matching properties.",
          leadId: currentCtx.leadId,
        });
        setStep(id, { status: "done", notice: wa.notice });
        return { status: "done", ctx: currentCtx };
      }
      case "visit": {
        const start = new Date(Date.now() + 36 * 3600000);
        const end = new Date(start.getTime() + 2 * 3600000);
        const cal = await call("POST", "/api/calendar", {
          title: "Golden Path Site Visit",
          type: "SITE_VISIT",
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          leadId: currentCtx.leadId,
        });
        setStep(id, { status: "done", notice: cal.message });
        return { status: "done", ctx: { ...currentCtx, calendarEventId: cal.id } };
      }
      case "qualify": {
        setStep(id, {
          status: "waiting",
          notice: "AI recommended qualifying this lead. Waiting for agent confirmation.",
        });
        return { status: "waiting", ctx: currentCtx };
      }
      case "opportunity": {
        const opp = await call("POST", "/api/opportunities", {
          name: "Golden Path Opportunity",
          dealSide: "BUYER",
          value: 42000000,
          currency: "PKR",
          stageId: stageIds.new,
          leadId: currentCtx.leadId,
          linkedPropertyId: currentCtx.linkedPropertyId ?? property?.id,
        });
        setStep(id, { status: "done", notice: `Opportunity "${opp.name}" created` });
        return { status: "done", ctx: { ...currentCtx, opportunityId: opp.id } };
      }
      case "proposal": {
        await call("PATCH", `/api/opportunities/${currentCtx.opportunityId}`, {
          stageId: stageIds.proposal,
        });
        const prop = await call("POST", "/api/proposals", {
          opportunityId: currentCtx.opportunityId,
          leadId: currentCtx.leadId,
          linkedPropertyId: currentCtx.linkedPropertyId ?? property?.id,
          value: 42000000,
          status: "DRAFT",
        });
        await call("PATCH", `/api/proposals/${prop.id}`, { status: "SENT" });
        setStep(id, { status: "done", notice: `Proposal ${prop.proposalNumber} sent` });
        return { status: "done", ctx: { ...currentCtx, proposalId: prop.id } };
      }
      case "accepted": {
        setStep(id, {
          status: "waiting",
          notice: "Ready to simulate acceptance — not a real client e-signature.",
        });
        return { status: "waiting", ctx: currentCtx };
      }
      case "won": {
        await call("PATCH", `/api/opportunities/${currentCtx.opportunityId}`, { stageId: stageIds.won });
        setStep(id, { status: "done", notice: "Opportunity moved to Won" });
        return { status: "done", ctx: currentCtx };
      }
      case "revenue": {
        const dash = await call("GET", "/api/dashboard");
        setStep(id, {
          status: "done",
          notice: `Won revenue: PKR ${Number(dash.metrics.wonRevenue).toLocaleString()}`,
        });
        return { status: "done", ctx: currentCtx };
      }
    }
  }

  async function runFrom(startIndex: number, startCtx: Ctx) {
    setRunning(true);
    let liveCtx = startCtx;
    for (let i = startIndex; i < STEP_DEFS.length; i++) {
      const id = STEP_DEFS[i].id;
      try {
        const result = await runStep(id, liveCtx);
        liveCtx = result.ctx;
        setCtx(liveCtx);
        if (result.status === "waiting") {
          setRunning(false);
          return;
        }
      } catch (err) {
        setStep(id, { status: "error", error: err instanceof Error ? err.message : "Step failed" });
        setRunning(false);
        return;
      }
    }
    setRunning(false);
  }

  async function confirmQualification() {
    setStep("qualify", { status: "running" });
    try {
      await call("PATCH", `/api/leads/${ctx.leadId}`, { stage: "QUALIFIED" });
      setStep("qualify", { status: "done", notice: "Agent confirmed qualification." });
      void runFrom(indexOf("qualify") + 1, ctx);
    } catch (err) {
      setStep("qualify", { status: "error", error: err instanceof Error ? err.message : "Failed" });
    }
  }

  async function simulateAcceptance() {
    setStep("accepted", { status: "running" });
    try {
      await call("PATCH", `/api/proposals/${ctx.proposalId}`, { status: "ACCEPTED" });
      setStep("accepted", {
        status: "done",
        notice: "Simulated acceptance recorded — not a real client e-signature.",
      });
      void runFrom(indexOf("accepted") + 1, ctx);
    } catch (err) {
      setStep("accepted", { status: "error", error: err instanceof Error ? err.message : "Failed" });
    }
  }

  const isWaiting = (id: StepId) => steps.find((s) => s.id === id)?.status === "waiting";
  const started = steps.some((s) => s.status !== "pending");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border border-border bg-surface p-4">
        <Button variant="accent" disabled={running} onClick={() => runFrom(0, {})}>
          {running ? "Running…" : started ? "Restart Golden Path" : "Run Golden Path"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Every step calls the real CRM APIs. Demo providers (WhatsApp, Calendar) and simulated
          actions are labeled inline — nothing here is a fake record.
        </p>
      </div>

      <ol className="space-y-2">
        {STEP_DEFS.map((def, i) => {
          const state = steps[i];
          return (
            <li key={def.id} className="flex items-start gap-3 border border-border bg-surface p-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{def.title}</span>
                  <span className="text-xs text-muted-foreground">{def.detail}</span>
                  <StatusBadge status={state.status} />
                </div>
                {state.notice ? <p className="text-sm text-accent">{state.notice}</p> : null}
                {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
                {def.id === "qualify" && isWaiting("qualify") ? (
                  <Button size="sm" variant="accent" onClick={confirmQualification}>
                    Confirm qualification
                  </Button>
                ) : null}
                {def.id === "accepted" && isWaiting("accepted") ? (
                  <Button
                    size="sm"
                    variant="accent"
                    title="Demo action — does not represent a real client e-signature."
                    onClick={simulateAcceptance}
                  >
                    Simulate acceptance
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {ctx.leadId || ctx.opportunityId ? (
        <div className="flex flex-wrap gap-4 border border-border bg-surface p-4 text-sm">
          {ctx.leadId ? (
            <Link href={`/leads/${ctx.leadId}`} className="text-accent underline">
              View lead
            </Link>
          ) : null}
          {ctx.opportunityId ? (
            <Link href={`/opportunities/${ctx.opportunityId}`} className="text-accent underline">
              View opportunity
            </Link>
          ) : null}
          {ctx.proposalId ? (
            <Link href="/proposals" className="text-accent underline">
              View proposal
            </Link>
          ) : null}
          {ctx.calendarEventId ? (
            <Link href="/calendar" className="text-accent underline">
              View site visit
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: StepStatus }) {
  switch (status) {
    case "pending":
      return <Badge tone="neutral">Pending</Badge>;
    case "running":
      return <Badge tone="accent">Running…</Badge>;
    case "waiting":
      return <Badge tone="warning">Needs agent action</Badge>;
    case "done":
      return <Badge tone="success">Done</Badge>;
    case "error":
      return <Badge tone="danger">Failed</Badge>;
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled step status: ${String(_exhaustive)}`);
    }
  }
}
