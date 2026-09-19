"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="text-[11px] font-medium text-muted hover:text-foreground"
    >
      Sign out
    </button>
  );
}
