-- Package + industry per workspace. Plain strings validated in code (src/lib/workspace/*), so new industries need no migration.
-- Existing workspaces are real estate and keep every module: grandfather them to "advanced" (new rows default to "growth").
ALTER TABLE "Workspace"
  ADD COLUMN "industry" TEXT NOT NULL DEFAULT 'real_estate',
  ADD COLUMN "package" TEXT NOT NULL DEFAULT 'growth';
UPDATE "Workspace" SET "package" = 'advanced';
