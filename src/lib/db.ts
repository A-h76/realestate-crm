import { PrismaClient } from "@prisma/client";
import { recordPrismaQuery } from "@/lib/perf";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createPrisma() {
  const client = new PrismaClient({
    log: [
      { emit: "event", level: "query" },
      { emit: "stdout", level: "error" },
      ...(process.env.NODE_ENV === "development" ? [{ emit: "stdout" as const, level: "warn" as const }] : []),
    ],
  });

  client.$on("query", (event) => {
    recordPrismaQuery(event.duration, event.query);
  });

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrisma();
globalForPrisma.prisma = prisma;
