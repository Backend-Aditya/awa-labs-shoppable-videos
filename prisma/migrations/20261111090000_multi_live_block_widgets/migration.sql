-- Theme blocks now pick which widget they show (a metaobject setting), so
-- any number of widgets of a block kind can be live at once. Only the
-- floating video (REEL_POPS) stays one-live-per-store: it lives in the
-- single app embed.
DROP INDEX IF EXISTS "Widget_one_published_per_type";
CREATE UNIQUE INDEX "Widget_one_published_floating_video" ON "Widget"("shopId", "type") WHERE "published" AND "type" = 'REEL_POPS';
