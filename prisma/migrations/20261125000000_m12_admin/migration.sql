-- M12 admin console. Expand-only: one new column, nothing renamed or dropped.
ALTER TABLE "papers" ADD COLUMN "ai_enabled" BOOLEAN NOT NULL DEFAULT false;
