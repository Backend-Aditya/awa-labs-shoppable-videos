-- Dashboard queries filter ReelEvent by shop and date range.
CREATE INDEX "ReelEvent_shopId_createdAt_idx" ON "ReelEvent"("shopId", "createdAt");
