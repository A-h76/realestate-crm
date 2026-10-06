-- Which lead sources a workspace says it gets leads from. Connected/live status and last event are derived
-- (WhatsAppIntegration, Lead, WhatsAppMessage), so only the declaration is stored. Additive.
CREATE TABLE "SourceDeclaration" (
    "workspaceId" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceDeclaration_pkey" PRIMARY KEY ("workspaceId","source")
);

ALTER TABLE "SourceDeclaration" ADD CONSTRAINT "SourceDeclaration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
