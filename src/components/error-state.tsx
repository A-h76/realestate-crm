"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Fallback for an unexpected runtime error in a route segment (error.tsx).
 * Deliberately never renders `error.message` or a stack: in production Next replaces server errors with a
 * generic message plus `digest`, but a client-component error would carry its real message. Only the digest
 * (an opaque reference matching the server log) is shown, so support can find the failure without the user
 * seeing internals.
 */
export function ErrorState({
  error,
  retry,
  homeHref = "/dashboard",
  homeLabel = "Back to dashboard",
}: {
  error: Error & { digest?: string };
  retry: () => void;
  homeHref?: string;
  homeLabel?: string;
}) {
  useEffect(() => {
    // Diagnostic only: stays in the browser console, name + opaque digest, no message/stack.
    console.error("route_error", { name: error.name, digest: error.digest });
  }, [error]);

  return (
    <div role="alert" className="page-in mx-auto flex max-w-xl flex-col gap-4 p-6 md:p-10">
      <div className="section-kicker">Something went wrong</div>
      <h1 className="text-[24px] font-bold tracking-tight">We couldn’t load this page</h1>
      <p className="text-sm leading-relaxed text-muted">
        This is a problem on our side, not something you did. Your data has not been changed. Try again, and if it keeps
        happening, tell your administrator
        {error.digest ? " and quote the reference below" : ""}.
      </p>
      {error.digest ? (
        <p className="mono text-xs text-muted">
          Reference: <span data-testid="error-digest">{error.digest}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="accent" onClick={() => retry()}>
          Try again
        </Button>
        <Link
          href={homeHref}
          className="inline-flex h-9 items-center rounded-[12px] border border-border bg-surface px-4 text-sm font-medium hover:bg-background"
        >
          {homeLabel}
        </Link>
      </div>
    </div>
  );
}
