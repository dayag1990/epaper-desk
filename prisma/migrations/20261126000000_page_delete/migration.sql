-- Delete page. Expand-only: one new nullable column, nothing renamed or dropped.
-- A deleted page keeps its row and every saved version; its page number is parked below zero so the number can be used again.
ALTER TABLE "pages" ADD COLUMN "deleted_at" TIMESTAMP(3);
