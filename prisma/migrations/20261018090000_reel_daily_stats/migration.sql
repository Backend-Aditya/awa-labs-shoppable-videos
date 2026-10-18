-- Daily analytics rollups: one row per shop, reel and UTC day.
CREATE TABLE "ReelDailyStat" (
    "shopId" TEXT NOT NULL,
    "reelId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReelDailyStat_pkey" PRIMARY KEY ("shopId","reelId","day")
);

CREATE INDEX "ReelDailyStat_shopId_day_idx" ON "ReelDailyStat"("shopId", "day");

ALTER TABLE "ReelDailyStat" ADD CONSTRAINT "ReelDailyStat_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from the raw event log. Older events stored the full metaobject
-- GID; both forms collapse to the numeric tail.
INSERT INTO "ReelDailyStat" ("shopId", "reelId", "day", "views", "clicks")
SELECT
    "shopId",
    substring("reelId" from '(\d+)$') AS "reelId",
    ("createdAt")::date AS "day",
    COUNT(*) FILTER (WHERE "eventType" = 'view')::int AS "views",
    COUNT(*) FILTER (WHERE "eventType" = 'click_product')::int AS "clicks"
FROM "ReelEvent"
WHERE substring("reelId" from '(\d+)$') IS NOT NULL
GROUP BY 1, 2, 3
ON CONFLICT ("shopId", "reelId", "day") DO NOTHING;
