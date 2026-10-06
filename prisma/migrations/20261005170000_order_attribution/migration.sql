CREATE TABLE "OrderAttribution" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "reelId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "revenueAmount" DECIMAL(12,2) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAttribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderAttribution_orderId_lineItemId_key" ON "OrderAttribution"("orderId", "lineItemId");

CREATE INDEX "OrderAttribution_shopId_reelId_idx" ON "OrderAttribution"("shopId", "reelId");

ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
