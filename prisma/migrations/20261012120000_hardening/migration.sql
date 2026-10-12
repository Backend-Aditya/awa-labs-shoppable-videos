-- Cloudflare Stream videos owned by each shop, so they can be deleted.
CREATE TABLE "StreamAsset" (
    "uid" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StreamAsset_pkey" PRIMARY KEY ("uid")
);
CREATE INDEX "StreamAsset_shopId_idx" ON "StreamAsset"("shopId");
ALTER TABLE "StreamAsset" ADD CONSTRAINT "StreamAsset_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dashboard/revenue queries filter by shop and date.
CREATE INDEX "OrderAttribution_shopId_createdAt_idx" ON "OrderAttribution"("shopId", "createdAt");

-- One live widget per type per shop, enforced by the database rather than
-- only by application code (concurrent publishes could both win before).
-- Repair any existing duplicates first: keep the most recently updated.
UPDATE "Widget" w SET "published" = false
WHERE w."published" = true
  AND EXISTS (
    SELECT 1 FROM "Widget" o
    WHERE o."shopId" = w."shopId" AND o."type" = w."type" AND o."published" = true
      AND (o."updatedAt" > w."updatedAt" OR (o."updatedAt" = w."updatedAt" AND o."id" > w."id"))
  );
CREATE UNIQUE INDEX "Widget_one_published_per_type" ON "Widget"("shopId", "type") WHERE "published";
