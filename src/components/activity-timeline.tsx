import { MapPin } from "lucide-react";
import { formatTimePK } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TimelineActivity = {
  id: string;
  type: string;
  title?: string | null;
  notes?: string | null;
  date: string | Date;
  status?: string | null;
  owner?: { name?: string | null } | null;
};

export function ActivityTimeline({
  activities,
  emptyMessage = "No activity recorded for this record yet.",
  className,
}: {
  activities: TimelineActivity[];
  emptyMessage?: string;
  className?: string;
}) {
  if (activities.length === 0) {
    return <p className={cn("py-6 text-sm text-muted", className)}>{emptyMessage}</p>;
  }

  return (
    <ol className={cn("relative space-y-0", className)}>
      <span className="absolute bottom-2 left-[3px] top-2 w-px bg-border" aria-hidden />
      {activities.map((activity) => {
        const siteVisit = activity.type === "SITE_VISIT";
        return (
          <li key={activity.id} className="relative flex gap-5 py-4 pl-6">
            <span
              className={cn(
                "absolute left-0 top-5 h-1.5 w-1.5 rounded-full",
                siteVisit ? "bg-accent" : "bg-foreground",
              )}
            />
            <div className="meta w-14 shrink-0 pt-0.5">{formatTimePK(activity.date)}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium uppercase tracking-[0.08em]">
                {activity.title ?? activity.type.replaceAll("_", " ")}
              </div>
              {activity.notes ? (
                <p className="mt-1 text-sm text-muted line-clamp-2">{activity.notes}</p>
              ) : null}
              <div className="meta mt-1">
                {siteVisit ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Site visit
                  </span>
                ) : (
                  activity.type.replaceAll("_", " ")
                )}
                {activity.owner?.name ? ` · ${activity.owner.name}` : ""}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
