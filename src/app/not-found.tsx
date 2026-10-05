import { NotFoundState } from "@/components/route-states";

// Unmatched URLs (outside the app shell).
export default function RootNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <NotFoundState />
    </main>
  );
}
