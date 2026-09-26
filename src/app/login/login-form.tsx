"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export function LoginForm({ demoMode }: { demoMode: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      setError("Invalid credentials.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      <div className="relative hidden w-[52%] overflow-hidden bg-brand text-white lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(0,220,205,0.35),transparent_55%)]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Synas Realty</div>
            <h1 className="mt-6 max-w-md text-4xl font-bold tracking-tight">
              Lead-to-Sale CRM
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/65">
              WhatsApp-first, PKR-denominated, site-visit-driven sales operating system for
              Pakistani real estate.
            </p>
          </div>
          <div className="space-y-3 text-sm text-white/55">
            <div>{demoMode ? "Isolated demo environment" : "Workspace sign-in"}</div>
            <div className="mono text-xs">Asia/Karachi · DD/MM/YYYY · ₨</div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-8">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
          <div>
            {demoMode ? <Badge tone="accent">Demo Environment</Badge> : null}
            <h2 className={`text-2xl font-semibold tracking-tight ${demoMode ? "mt-3" : ""}`}>Sign in</h2>
            <p className="mt-1 text-sm text-muted">
              {demoMode
                ? "This is an isolated demo environment. Use operator-provisioned demo credentials."
                : "Sign in to your workspace."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                title={showPassword ? "Hide password" : "Show password"}
                className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-r-[12px] text-muted outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-1 focus-visible:ring-brand"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <Button type="submit" variant="accent" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Enter workspace"}
          </Button>
        </form>
      </div>
    </div>
  );
}
