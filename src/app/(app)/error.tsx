"use client";

import { ErrorState } from "@/components/error-state";

// Wraps every page under the app shell; the shell/navigation stays usable while the segment shows this.
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorState error={error} retry={retry} />;
}
