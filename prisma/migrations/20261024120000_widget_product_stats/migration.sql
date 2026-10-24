-- Engagement split by widget and by product, one row per shop, key and UTC
-- day, next to ReelDailyStat. New tables only: nothing existing changes.
CREATE TABLE "WidgetDailyStat" (
    "shopId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "addToCarts" INTEGER NOT NULL DEFAULT 0,
    "completions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WidgetDailyStat_pkey" PRIMARY KEY ("shopId","source","day")
);

CREATE INDEX "WidgetDailyStat_shopId_day_idx" ON "WidgetDailyStat"("shopId", "day");

ALTER TABLE "WidgetDailyStat" ADD CONSTRAINT "WidgetDailyStat_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProductDailyStat" (
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "addToCarts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductDailyStat_pkey" PRIMARY KEY ("shopId","productId","day")
);

CREATE INDEX "ProductDailyStat_shopId_day_idx" ON "ProductDailyStat"("shopId", "day");

ALTER TABLE "ProductDailyStat" ADD CONSTRAINT "ProductDailyStat_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
