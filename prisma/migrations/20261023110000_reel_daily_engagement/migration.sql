-- Engagement rollups next to views, clicks and add to carts (the last added
-- by 20261022100000_add_to_cart_stats): completions and seconds watched.
-- Constant defaults make these metadata-only on Postgres 11+ (no table
-- rewrite).
ALTER TABLE "ReelDailyStat"
    ADD COLUMN "completions" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "watchSeconds" INTEGER NOT NULL DEFAULT 0;
