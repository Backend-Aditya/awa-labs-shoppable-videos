-- Engagement rollups next to views and clicks: successful adds to cart,
-- completions and seconds watched. Constant defaults make these
-- metadata-only on Postgres 11+ (no table rewrite).
ALTER TABLE "ReelDailyStat"
    ADD COLUMN "addToCarts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "completions" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "watchSeconds" INTEGER NOT NULL DEFAULT 0;
