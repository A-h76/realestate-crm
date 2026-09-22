"use client";

import { useState } from "react";
import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MobileContextDrawer({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="shrink-0 border-b border-border px-4 py-2 xl:hidden">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Info className="h-3.5 w-3.5" />
          Lead details
        </Button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-foreground/30"
            aria-label="Close lead details"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-full max-w-[380px] overflow-y-auto bg-surface shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
              <span className="text-sm font-semibold">Lead details</span>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="p-1 text-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            {children}
          </div>
        </div>
      ) : null}
    </>
  );
}
