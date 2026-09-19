import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-1 py-10">
      <div className="section-kicker">Empty</div>
      <h3 className="section mt-2">{title}</h3>
      {description ? <p className="mt-2 max-w-md text-[14px] leading-[22px] text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ScoreRail({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="min-w-[88px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="section-kicker">{label}</span>
        <span className="score">{clamped}</span>
      </div>
      <div className="mt-2 h-px bg-border">
        <div className="score-fill h-px bg-foreground" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

export function EditorialStat({
  label,
  value,
  hint,
  featured = false,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  featured?: boolean;
}) {
  return (
    <div>
      <div className="section-kicker">{label}</div>
      <div className={featured ? "display money mt-2" : "title money mt-2"}>{value}</div>
      {hint ? <div className="meta mt-1">{hint}</div> : null}
    </div>
  );
}

export function RangeChips({
  options,
  value,
  onSelect,
  hrefFor,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onSelect?: (id: string) => void;
  hrefFor?: (id: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = value === option.id;
        if (hrefFor) {
          return (
            <Link
              key={option.id}
              href={hrefFor(option.id)}
              className="range-chip"
              data-active={active ? "true" : "false"}
            >
              {option.label}
            </Link>
          );
        }
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelect?.(option.id)}
            className="range-chip"
            data-active={active ? "true" : "false"}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("hairline", className)} />;
}

export { Button };
