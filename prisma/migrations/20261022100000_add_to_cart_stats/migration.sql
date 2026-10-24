-- Add-to-cart events are counted per reel and day alongside views and clicks.
ALTER TABLE "ReelDailyStat" ADD COLUMN "addToCarts" INTEGER NOT NULL DEFAULT 0;
