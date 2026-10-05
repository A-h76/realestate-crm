"use client";

import { ErrorState } from "@/components/error-state";

// Errors outside the app shell (sign-in, accept-invite).
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <ErrorState error={error} retry={retry} homeHref="/login" homeLabel="Go to sign in" />
    </main>
  );
}
