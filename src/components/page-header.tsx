import { DemoModeBadge } from "@/components/demo-banner";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6",
        className,
      )}
    >
      <div>
        {eyebrow ? <div className="section-kicker">{eyebrow}</div> : null}
        <h1 className="mt-1 text-[32px] font-bold tracking-tight">{title}</h1>
        {description ? <p className="mt-2 max-w-xl text-[14px] leading-[20px] text-muted">{description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <DemoModeBadge />
        {actions}
      </div>
    </header>
  );
}

export function SectionHeading({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="section">{children}</h2>
      {action}
    </div>
  );
}
