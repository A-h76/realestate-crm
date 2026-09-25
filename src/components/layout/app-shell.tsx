"use client";

import { useState } from "react";
import { Menu, X, ChevronDown } from "lucide-react";
import { AppSidebar, CommandCenter, useCommandOpen } from "@/components/layout/app-sidebar";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { initials } from "@/lib/dashboard-ui";
import { prettyRole } from "@/lib/format";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { DemoBanner, DemoModeProvider } from "@/components/demo-banner";

export function AppShell({
  userName,
  userRole,
  workspaceName,
  companyName,
  city,
  calendarDemo,
  whatsappDemo,
  demoMode = false,
  children,
}: {
  userName: string;
  userRole?: string | null;
  workspaceName: string;
  companyName?: string;
  city: string;
  calendarDemo: boolean;
  whatsappDemo: boolean;
  demoMode?: boolean;
  children: React.ReactNode;
}) {
  const { open, setOpen } = useCommandOpen();
  const [mobileNav, setMobileNav] = useState(false);

  return (
    <DemoModeProvider enabled={demoMode}>
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="hidden h-full md:block">
        <AppSidebar
          userName={userName}
          workspaceName={workspaceName}
          companyName={companyName}
          calendarDemo={calendarDemo}
          whatsappDemo={whatsappDemo}
          userRole={userRole}
        />
      </div>
      {mobileNav ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-foreground/30"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          />
          <div className="relative h-full w-[248px]">
            <AppSidebar
              userName={userName}
              workspaceName={workspaceName}
              companyName={companyName}
              calendarDemo={calendarDemo}
              whatsappDemo={whatsappDemo}
              userRole={userRole}
              onNavigate={() => setMobileNav(false)}
            />
          </div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 bg-background px-4 md:px-6">
          <button
            type="button"
            className="p-2 text-muted md:hidden"
            aria-label="Open navigation"
            suppressHydrationWarning
            onClick={() => setMobileNav(true)}
          >
            {mobileNav ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-10 min-w-0 flex-1 items-center justify-between rounded-full border border-border bg-surface px-4 text-left text-[14px] text-muted shadow-[var(--shadow)]"
          >
            <span className="truncate">Search leads, properties, opportunities…</span>
            <kbd className="hidden rounded-full border border-border px-2 py-0.5 text-[11px] text-muted sm:inline">
              ⌘ K
            </kbd>
          </button>
          <button
            type="button"
            className="hidden h-10 items-center gap-1 rounded-full border border-border bg-surface px-3 text-[13px] font-medium text-foreground sm:inline-flex"
            aria-label="Workspace city"
          >
            {city}
            <ChevronDown className="h-3.5 w-3.5 text-muted" />
          </button>
          <NotificationsMenu />
          <div className="hidden items-center gap-2 sm:flex">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
              {initials(userName)}
            </div>
            <div className="leading-tight">
              <div className="text-[13px] font-semibold">{userName}</div>
              <div className="text-[11px] text-muted">{prettyRole(userRole)}</div>
              <SignOutButton />
            </div>
          </div>
        </header>
        <DemoBanner
          className="mx-4 md:mx-6"
          label="Demo workspace"
          detail="Synthetic records for demos and UX testing. No real customers; no real WhatsApp messages are sent."
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <CommandCenter open={open} onOpenChange={setOpen} />
    </div>
    </DemoModeProvider>
  );
}
