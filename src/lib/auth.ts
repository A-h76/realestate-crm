import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { measureExecution } from "@/lib/perf";
import { logSecurityEvent } from "@/lib/security/log";
import { writeAudit } from "@/lib/audit";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type LoginUser = { id: string; email: string; name: string | null; workspaceId: string; role: string };
type LoginResult = { ok: true; user: LoginUser } | { ok: false; reason: string; email?: string };

/** Pulled out of `authorize` so login-denial reasons are unit-testable without going through NextAuth's HTTP layer. */
export async function verifyLoginCredentials(raw: unknown): Promise<LoginResult> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };

  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      deletedAt: true,
      memberships: {
        select: { workspaceId: true, role: true },
        take: 1,
      },
    },
  });

  if (!user || user.deletedAt) return { ok: false, reason: "unknown_user", email };

  const valid = await measureExecution("auth.passwordVerify", () =>
    bcrypt.compare(parsed.data.password, user.passwordHash),
  );
  if (!valid) return { ok: false, reason: "bad_password", email };

  const membership = user.memberships[0];
  if (!membership) return { ok: false, reason: "no_membership", email };

  return {
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, workspaceId: membership.workspaceId, role: membership.role },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
    updateAge: 15 * 60,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const result = await verifyLoginCredentials(raw);
        if (!result.ok) {
          logSecurityEvent({
            status: 401,
            message: `login_failed: ${result.reason}`,
            detail: result.email ? { email: result.email } : undefined,
          });
          return null;
        }
        return result.user;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.workspaceId = (user as { workspaceId?: string }).workspaceId;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.workspaceId = token.workspaceId as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      const workspaceId = (user as { workspaceId?: string }).workspaceId;
      if (!user.id || !workspaceId) return;
      // A logging failure must never block a successful login.
      try {
        await writeAudit({
          workspaceId,
          actorId: user.id,
          action: "USER_LOGIN",
          entity: "User",
          entityId: user.id,
        });
      } catch (error) {
        console.error("login_audit_write_failed", error instanceof Error ? error.message : error);
      }
    },
  },
  trustHost: true,
  secret: process.env.AUTH_SECRET,
});
