import { cn } from "@/lib/utils";

export function Badge({
  children,
  className,
  tone = "neutral",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "neutral" | "accent" | "warning" | "danger" | "success";
}) {
  const tones = {
    neutral: "bg-background text-foreground border-border",
    accent: "bg-accent-soft text-accent border-accent/20",
    warning: "bg-amber-50 text-warning border-amber-200",
    danger: "bg-red-50 text-danger border-red-200",
    success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
