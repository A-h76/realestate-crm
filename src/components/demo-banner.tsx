"use client";

import { createContext, useContext } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const DemoModeContext = createContext(false);

export function DemoModeProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return <DemoModeContext.Provider value={enabled}>{children}</DemoModeContext.Provider>;
}

export function useDemoMode() {
  return useContext(DemoModeContext);
}

export function DemoBanner({
  enabled,
  label = "Demo Mode",
  detail,
  className,
}: {
  enabled?: boolean;
  label?: string;
  detail?: string;
  className?: string;
}) {
  const fromContext = useDemoMode();
  if (!(enabled ?? fromContext)) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border border-accent/25 bg-accent-soft px-3 py-2 text-xs text-foreground",
        className,
      )}
    >
      <Badge tone="accent">{label}</Badge>
      {detail ? <span className="text-muted">{detail}</span> : null}
    </div>
  );
}

export function DemoModeBadge({
  enabled,
  className,
}: {
  enabled?: boolean;
  className?: string;
}) {
  const fromContext = useDemoMode();
  if (!(enabled ?? fromContext)) return null;
  return (
    <Badge tone="accent" className={className}>
      Demo Mode
    </Badge>
  );
}
