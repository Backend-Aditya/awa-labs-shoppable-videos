-- Reverting the admin-side master-switch feature in favor of Shopify's
-- native app-embed enable/disable toggle (see blocks/shoppable-videos.liquid).
ALTER TABLE "Shop" DROP COLUMN "enabled";
