import { canonicalPhone } from "@/lib/phone";

/** Group key for "same person": a valid full phone number, else a lowercased email. */
export function duplicateKeys(c: { phone: string | null; email: string | null }): string[] {
  const keys: string[] = [];
  const phone = canonicalPhone(c.phone);
  if (phone) keys.push(`p:${phone}`);
  const email = c.email?.trim().toLowerCase();
  if (email) keys.push(`e:${email}`);
  return keys;
}

export function countDuplicateGroups(contacts: Array<{ id: string; phone: string | null; email: string | null }>): number {
  const byKey = new Map<string, Set<string>>();
  for (const c of contacts) {
    for (const key of duplicateKeys(c)) {
      const ids = byKey.get(key) ?? new Set<string>();
      ids.add(c.id);
      byKey.set(key, ids);
    }
  }
  return [...byKey.values()].filter((ids) => ids.size > 1).length;
}
