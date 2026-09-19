"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

type Stage = {
  id: string;
  name: string;
  probability: number;
  accentColor: string | null;
  isWon: boolean;
  isLost: boolean;
};

type OppCard = {
  id: string;
  name: string;
  stageId: string;
  dealSide: string;
  value: number;
  probability: number;
  ownerName: string | null;
  propertyTitle: string | null;
  leadName: string | null;
  leadScore: number | null;
  daysInStage: number;
  nextAction: string | null;
};

function Card({ opp, dragging }: { opp: OppCard; dragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: opp.id,
    data: { stageId: opp.stageId },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "cursor-grab border-b border-border bg-surface p-3 active:cursor-grabbing",
        (isDragging || dragging) && "opacity-40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium leading-snug">{opp.name}</div>
        <span className="meta">{opp.dealSide}</span>
      </div>
      <div className="mt-2 text-sm">{formatCurrency(opp.value)}</div>
      <div className="meta mt-2">
        {opp.propertyTitle ?? "No property"} · {opp.probability}%
        {opp.leadScore != null ? ` · ${opp.leadScore} score` : ""}
      </div>
      <div className="meta mt-1">
        {opp.daysInStage}d in stage
        {opp.ownerName ? ` · ${opp.ownerName}` : ""}
      </div>
      {opp.nextAction ? <div className="mt-1 text-[11px] text-muted">{opp.nextAction}</div> : null}
    </div>
  );
}

function Column({
  stage,
  items,
}: {
  stage: Stage;
  items: OppCard[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = items.reduce((s, o) => s + o.value, 0);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col border-r border-border bg-background",
        isOver && "border-accent",
      )}
    >
      <div className="border-b border-border px-3 py-3">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: stage.accentColor ?? "#0d9488" }}
          />
          <span className="text-xs font-medium">{stage.name}</span>
          <span className="mono text-[11px] text-muted">{items.length}</span>
        </div>
        <div className="mono mt-1 text-[11px] text-muted">
          {formatCurrency(total)} · {stage.probability}%
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2" style={{ maxHeight: "70vh" }}>
        {items.map((opp) => (
          <Card key={opp.id} opp={opp} />
        ))}
      </div>
    </div>
  );
}

export function PipelineBoard({
  stages,
  initialOpportunities,
}: {
  stages: Stage[];
  initialOpportunities: OppCard[];
}) {
  const [opps, setOpps] = useState(initialOpportunities);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const byStage = useMemo(() => {
    const map: Record<string, OppCard[]> = {};
    for (const s of stages) map[s.id] = [];
    for (const o of opps) {
      if (!map[o.stageId]) map[o.stageId] = [];
      map[o.stageId].push(o);
    }
    return map;
  }, [opps, stages]);

  const activeOpp = opps.find((o) => o.id === activeId) ?? null;

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const oppId = String(active.id);
    const overId = String(over.id);
    const targetStageId = stages.some((s) => s.id === overId)
      ? overId
      : opps.find((o) => o.id === overId)?.stageId;

    if (!targetStageId) return;

    const current = opps.find((o) => o.id === oppId);
    if (!current || current.stageId === targetStageId) return;

    const stage = stages.find((s) => s.id === targetStageId);
    const previous = opps;
    setOpps((list) =>
      list.map((o) =>
        o.id === oppId
          ? { ...o, stageId: targetStageId, probability: stage?.probability ?? o.probability }
          : o,
      ),
    );
    setError(null);

    try {
      const res = await fetch(`/api/opportunities/${oppId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId: targetStageId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to move opportunity");
      }
      const updated = await res.json();
      setOpps((list) =>
        list.map((o) =>
          o.id === oppId
            ? {
                ...o,
                stageId: updated.stageId ?? targetStageId,
                probability: updated.probability ?? stage?.probability ?? o.probability,
              }
            : o,
        ),
      );
      // Refresh from server so board does not rely only on optimistic frontend state
      const refreshRes = await fetch("/api/opportunities");
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        const list = (Array.isArray(data) ? data : (data.items ?? data.opportunities ?? [])) as Array<{
          id: string;
          name: string;
          stageId: string;
          dealSide: string;
          value: string | number;
          probability: number;
          owner?: { name?: string | null } | null;
          linkedProperty?: { title?: string | null } | null;
          lead?: { firstName?: string; lastName?: string | null; leadScore?: number | null; nextAction?: string | null } | null;
          ownerName?: string | null;
          propertyTitle?: string | null;
          leadName?: string | null;
          stageEnteredAt?: string;
        }>;
        setOpps(
          list.map((o) => {
            const prev = previous.find((p) => p.id === o.id);
            const entered = o.stageEnteredAt ? new Date(o.stageEnteredAt).getTime() : Date.now();
            return {
              id: o.id,
              name: o.name,
              stageId: o.stageId,
              dealSide: o.dealSide,
              value: Number(o.value),
              probability: o.probability,
              ownerName: o.ownerName ?? o.owner?.name ?? null,
              propertyTitle: o.propertyTitle ?? o.linkedProperty?.title ?? null,
              leadName:
                o.leadName ??
                (o.lead ? `${o.lead.firstName ?? ""} ${o.lead.lastName ?? ""}`.trim() : null),
              leadScore: o.lead?.leadScore ?? prev?.leadScore ?? null,
              daysInStage: Math.max(0, Math.floor((Date.now() - entered) / 86400000)),
              nextAction: o.lead?.nextAction ?? prev?.nextAction ?? null,
            };
          }),
        );
      }
    } catch (err) {
      setOpps(previous);
      setError(err instanceof Error ? err.message : "Move failed");
    }
  }

  return (
    <div className="space-y-3">
      {error ? <div className="border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">{error}</div> : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <Column key={stage.id} stage={stage} items={byStage[stage.id] ?? []} />
          ))}
        </div>
        <DragOverlay>{activeOpp ? <Card opp={activeOpp} dragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
