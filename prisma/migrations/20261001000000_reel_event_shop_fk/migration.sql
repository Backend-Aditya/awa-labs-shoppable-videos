-- ReelEvent had no FK relation to Shop, so rows were never cleaned up when a
-- shop was deleted (and nothing enforced that shopId pointed at a real Shop).
-- Drop any already-orphaned rows first — a FK can't be added while rows
-- violate it — then add the relation with cascade delete so shop/redact and
-- any future Shop deletion cleans ReelEvent up automatically.
DELETE FROM "ReelEvent" WHERE "shopId" NOT IN (SELECT "id" FROM "Shop");

ALTER TABLE "ReelEvent" ADD CONSTRAINT "ReelEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
