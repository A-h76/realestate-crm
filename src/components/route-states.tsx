import Link from "next/link";

/** 404 for a missing or inaccessible record/page. Same wording either way so it never reveals whether a record exists elsewhere. */
export function NotFoundState({
  homeHref = "/dashboard",
  homeLabel = "Back to dashboard",
  links = [],
}: {
  homeHref?: string;
  homeLabel?: string;
  links?: Array<{ href: string; label: string }>;
}) {
  const linkClass =
    "inline-flex h-9 items-center rounded-[12px] border border-border bg-surface px-4 text-sm font-medium hover:bg-background";
  return (
    <div className="page-in mx-auto flex max-w-xl flex-col gap-4 p-6 md:p-10">
      <div className="section-kicker">Not found</div>
      <h1 className="text-[24px] font-bold tracking-tight">We couldn’t find that</h1>
      <p className="text-sm leading-relaxed text-muted">
        The page or record may have been moved or deleted, or you may not have access to it. Check the link and try
        again.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href={homeHref} className={linkClass}>
          {homeLabel}
        </Link>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={linkClass}>
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Bar({ className }: { className: string }) {
  return <div aria-hidden className={`rounded bg-border/70 motion-safe:animate-pulse ${className}`} />;
}

/** Skeleton shown while a server-rendered page streams in (loading.tsx). Announced once to assistive tech. */
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-8 p-6 md:p-10">
      <span className="sr-only">{label}</span>
      <div className="space-y-3">
        <Bar className="h-3 w-24" />
        <Bar className="h-8 w-64" />
        <Bar className="h-3 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Bar key={i} className="h-24" />
        ))}
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Bar key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
