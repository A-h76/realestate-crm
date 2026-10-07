-- When the lead really reached the business (e.g. a CSV import of older leads). null = use createdAt. Additive.
ALTER TABLE "Lead" ADD COLUMN "receivedAt" TIMESTAMP(3);
