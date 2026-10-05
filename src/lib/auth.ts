import { randomBytes } from "node:crypto";
import NextAuth, { type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { measureExecution } from "@/lib/perf";
import { logEvent, maskEmail } from "@/lib/log";
import { logSecurityEvent } from "@/lib/security/log";
import { writeAudit } from "@/lib/audit";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Absolute cap on a session, on top of the 8h idle JWT expiry (which rolls while in use). */
export const SESSION_ABSOLUTE_MAX_MS = 12 * 60 * 60 * 1000;

// Compared against when the email is unknown, so both paths cost one bcrypt verify (no timing oracle).
const DUMMY_PASSWORD_HASH = "$2b$10$KLUBlJ0SiybSVrd/J6YSZe7z2oE2cUQBHadM4YfvMLXwnERg5S/F6";

const useSecureCookies = process.env.NODE_ENV === "production";

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

  if (!user || user.deletedAt) {
    await bcrypt.compare(parsed.data.password, DUMMY_PASSWORD_HASH);
    return { ok: false, reason: "unknown_user", email };
  }

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
  cookies: {
    sessionToken: {
      // __Host-: Secure, Path=/, no Domain — the browser refuses it on subdomains or over plain HTTP.
      name: useSecureCookies ? "__Host-synas_session" : "synas_session",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
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
            detail: result.email ? { account: maskEmail(result.email) } : undefined,
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
        // Fresh random server-side session per sign-in (also defeats session fixation).
        const sid = randomBytes(32).toString("base64url");
        await prisma.authSession.create({
          data: { id: sid, userId: user.id!, expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MAX_MS) },
        });
        token.sid = sid;
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
        session.sid = token.sid;
      }
      return session;
    },
  },
  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      if (!token?.sid) return;
      try {
        await prisma.authSession.updateMany({
          where: { id: token.sid, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (token.id && token.workspaceId) {
          await writeAudit({
            workspaceId: token.workspaceId,
            actorId: token.id,
            action: "USER_LOGOUT",
            entity: "User",
            entityId: token.id,
          });
        }
      } catch (error) {
        logEvent("error", "logout_revoke_failed", { error });
      }
    },
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
        logEvent("error", "login_audit_write_failed", { error });
      }
    },
  },
  trustHost: true,
  secret: process.env.AUTH_SECRET,
});

type SessionRow = {
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: { deletedAt: Date | null };
};

/** Pure check, split out for tests: the server-side row must exist, match the user, and be live. */
export function isSessionRowActive(row: SessionRow | null, userId: string, now = new Date()): boolean {
  return Boolean(row && row.userId === userId && !row.revokedAt && row.expiresAt > now && !row.user.deletedAt);
}

/**
 * The authoritative session check: a valid JWT alone is not enough — its `sid` must point at an
 * unrevoked, unexpired AuthSession of a non-deleted user. Tokens issued before sids existed fail.
 */
export async function getActiveSession(): Promise<Session | null> {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id || !session.user.workspaceId || !session.sid) return null;
  const row = await prisma.authSession.findUnique({
    where: { id: session.sid },
    select: { userId: true, expiresAt: true, revokedAt: true, user: { select: { deletedAt: true } } },
  });
  return isSessionRowActive(row, session.user.id) ? session : null;
}

export async function revokeUserSessions(userId: string): Promise<number> {
  const result = await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
