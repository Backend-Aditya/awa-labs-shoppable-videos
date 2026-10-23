-- Tracking integrations (Integrations page), mirrored to the $app.tracking
-- shop metafield for the storefront.
ALTER TABLE "Shop" ADD COLUMN "tracking" JSONB;
