/** Turn empty strings into null for optional Prisma string fields. */
export function emptyToNull<T extends Record<string, unknown>>(input: T): T {
  const out = { ...input } as Record<string, unknown>;
  for (const [key, value] of Object.entries(out)) {
    if (value === "") out[key] = null;
  }
  return out as T;
}

export function sortOrder(order: "asc" | "desc" | undefined): "asc" | "desc" {
  return order === "asc" ? "asc" : "desc";
}
