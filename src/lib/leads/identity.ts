import type { Prisma } from "@prisma/client";
import { canonicalPhone as toE164 } from "@/lib/phone";

/**
 * DATA-001 / DATA-002: what makes two lead intakes "the same person".
 *
 * Matching rules (deliberately narrow, to avoid merging different people):
 *  - A COMPLETE, valid phone number (normalizes to E.164, e.g. +14155550123) matches a lead
 *    whose phone or WhatsApp number is that same number in any common spelling
 *    ((415) 555-0123, 415-555-0123, 4155550123, +1 415 555 0123). Partial, malformed or
 *    ambiguous numbers never match — they produce no identity key at all.
 *  - An e-mail address matches case-insensitively and exactly.
 *  - Names, companies and area NEVER match on their own.
 *  - Matching is always inside one workspace and ignores soft-deleted leads.
 * A shared family e-mail can therefore flag a false duplicate; manual creation lets the user
 * override (allowDuplicate), WhatsApp intake keys on the phone number only.
 */
export type LeadIdentity = { phone?: string | null; whatsappNumber?: string | null; email?: string | null };

/** Canonical E.164 form when the input is a complete valid number, otherwise null. */
export function canonicalPhone(input: string | null | undefined): string | null {
  return toE164(input);
}

/**
 * Every spelling a stored number may have for one canonical E.164 number, so a lead saved
 * before normalization (or imported as typed) is still found. For a US number
 * `+14155550123` that is the E.164 form, the 11-digit `14155550123`, the national
 * `4155550123`, a trunk-prefixed `04155550123`, and the two readable spellings
 * `(415) 555-0123` / `415-555-0123`.
 */
export function phoneVariants(canonical: string): string[] {
  const digits = canonical.replace(/\D/g, "");
  const variants = new Set<string>([canonical, digits]);
  if (canonical.startsWith("+1") && digits.length === 11) {
    const national = digits.slice(1); // NXXNXXXXXX
    const area = national.slice(0, 3);
    const exchange = national.slice(3, 6);
    const line = national.slice(6);
    variants.add(national);
    variants.add(`0${national}`);
    variants.add(`(${area}) ${exchange}-${line}`);
    variants.add(`${area}-${exchange}-${line}`);
  }
  return [...variants];
}

export function identityPhones(identity: LeadIdentity): string[] {
  return [...new Set([canonicalPhone(identity.phone), canonicalPhone(identity.whatsappNumber)].filter((v): v is string => Boolean(v)))];
}

export function normalizedEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  return value ? value : null;
}

/** Lock keys for one intake: stable strings, sorted, so concurrent intakes lock in the same order. */
export function identityKeys(identity: LeadIdentity): string[] {
  const keys = identityPhones(identity).map((p) => `p:${p}`);
  const email = normalizedEmail(identity.email);
  if (email) keys.push(`e:${email}`);
  return keys.sort();
}

/**
 * Serializes concurrent intakes of the same person within a transaction (Postgres advisory
 * lock, released at commit/rollback, works across app instances). There is intentionally no
 * unique index: existing workspaces may already hold duplicates (see docs/ops/ROLLBACK-RUNBOOK.md,
 * "Duplicate leads report"), and a constraint would fail the migration.
 */
export async function lockLeadIdentities(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  keys: string[],
): Promise<void> {
  const lockNames = [...new Set(keys)].sort().map((key) => `lead-identity:${workspaceId}:${key}`);
  if (lockNames.length === 0) return;
  // One round trip for all locks (CSV import takes hundreds), acquired in sorted order so two
  // transactions can never wait on each other.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(name, 0))
    FROM (SELECT name FROM unnest(${lockNames}::text[]) AS name ORDER BY name) AS ordered`;
}

export function duplicateWhere(workspaceId: string, identity: LeadIdentity, excludeLeadId?: string): Prisma.LeadWhereInput | null {
  const or: Prisma.LeadWhereInput[] = [];
  for (const phone of identityPhones(identity)) {
    const variants = phoneVariants(phone);
    or.push({ whatsappNumber: { in: variants } }, { phone: { in: variants } });
  }
  const email = normalizedEmail(identity.email);
  if (email) or.push({ email: { equals: email, mode: "insensitive" } });
  if (or.length === 0) return null;
  return { workspaceId, deletedAt: null, ...(excludeLeadId ? { id: { not: excludeLeadId } } : {}), OR: or };
}

export async function findDuplicateLead(
  db: Prisma.TransactionClient,
  workspaceId: string,
  identity: LeadIdentity,
  excludeLeadId?: string,
) {
  const where = duplicateWhere(workspaceId, identity, excludeLeadId);
  if (!where) return null;
  return db.lead.findFirst({
    where,
    orderBy: { createdAt: "asc" },
    select: { id: true, firstName: true, lastName: true },
  });
}
