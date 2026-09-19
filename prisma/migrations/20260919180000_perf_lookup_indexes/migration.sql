-- Lookup indexes used by CSV duplicate checks and WhatsApp inbound matching.
-- Lead.email / Lead.phone: import scans and webhook OR lookups.
-- Contact.phone: webhook contact matching (whatsappNumber already indexed).

CREATE INDEX IF NOT EXISTS "Lead_workspaceId_email_idx" ON "Lead"("workspaceId", "email");
CREATE INDEX IF NOT EXISTS "Lead_workspaceId_phone_idx" ON "Lead"("workspaceId", "phone");
CREATE INDEX IF NOT EXISTS "Contact_workspaceId_phone_idx" ON "Contact"("workspaceId", "phone");
