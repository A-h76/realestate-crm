import { TakeOverButton } from "./take-over-button";
import type { ParsedHandoff } from "@/lib/whatsapp/inbox-list";

export function HandoffBanner({
  handoff,
  leadId,
  ownerName,
  isMine,
}: {
  handoff: ParsedHandoff;
  leadId: string;
  ownerName: string | null;
  isMine: boolean;
}) {
  const inProgress = handoff.status === "IN_PROGRESS";

  return (
    <div
      className={
        inProgress
          ? "shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3"
          : "shrink-0 border-b border-red-200 bg-red-50 px-4 py-3"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={inProgress ? "text-[12px] font-semibold uppercase tracking-[0.08em] text-warning" : "text-[12px] font-semibold uppercase tracking-[0.08em] text-danger"}>
            {inProgress ? "Handoff in progress" : "Human handoff required"}
          </div>
          <p className="mt-1 text-sm font-medium">{handoff.reasonLabel}</p>
          {handoff.actionLabel ? (
            <p className="mt-0.5 text-[12px] text-muted">Suggested action: {handoff.actionLabel}</p>
          ) : null}
          {inProgress ? (
            <p className="mt-0.5 text-[12px] text-muted">
              {isMine ? "You are handling this." : ownerName ? `${ownerName} is handling this.` : "Being handled."}
            </p>
          ) : null}
        </div>
        {!inProgress ? <TakeOverButton leadId={leadId} /> : null}
      </div>
    </div>
  );
}
