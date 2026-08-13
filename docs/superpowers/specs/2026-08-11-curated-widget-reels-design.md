# Curated reel selection for widgets

## Problem

`PRODUCT_PAGE_REELS` and `CAROUSEL` widgets currently decide which reels
appear on a product page entirely via reel→product tagging: in the Reels
library, you tag a reel to specific products, and that write
(`syncProductReelMetafields`) is what makes `product-page-reels.liquid` /
`stacked-carousel.liquid` show it on those products' pages. The widget
itself has no say in which reels appear — it only controls *whether* the
block is gated on/off and *which products* it's allowed to appear on
(`targetRule`).

This means "managing what a widget shows" is not possible from the widget
itself — you have to go find the right reels in the Reels library and tag
them one at a time. The ask: let the merchant pick a widget's reels
directly, from the widget.

## Behavior

- `PRODUCT_PAGE_REELS` and `CAROUSEL` widgets gain a curated, ordered list
  of reels, picked in the widget's own admin UI.
- That list is the **same set of reels on every product page** the widget
  is targeted to (via the existing `targetRule`: all products, or specific
  handles) — not per-product. `targetRule` still decides *which pages*
  show the widget; the curated list now decides *which reels* appear
  there.
- Reel→product tagging (the "Tag products" flow already in the Reels
  library modal) is **unaffected** — it keeps driving the in-reel
  "buy this product" carousel that renders inside a playing reel. It stops
  being the mechanism for "which product page shows this reel"; the
  curated list replaces that role for these two widget kinds.
- `STORIES` (not yet built) is designed to use the same mechanism when it
  ships, for consistency — this spec updates its data-model story but does
  not add a Liquid block for it (still out of scope, per the prior plan).
- `SINGLE_VIDEO` and `REEL_POPS` are unaffected — they already have their
  own single-reel picker (`featuredReelId`), which is a different,
  already-shipped mechanism this spec doesn't touch.

## Data model

### `WidgetConfig` (`app/models/widget.server.ts`)

Add an optional ordered list:

```typescript
export interface WidgetConfig {
  templateStyle: string;
  targetRule:
    | { type: "all_products" }
    | { type: "handles"; handles: string[] };
  featuredReelId?: string; // SINGLE_VIDEO, REEL_POPS — unchanged
  reelIds?: string[];      // PRODUCT_PAGE_REELS, CAROUSEL, STORIES — new
}
```

### Shop metafields

One `list.metaobject_reference<$app:reel>` metafield per kind, mirroring
the existing `featuredReelMetafieldKey` pattern in
`WIDGET_KIND_SYNC_CONFIG`:

- `product_page_reels_widget_reels`
- `stacked_carousel_widget_reels`
- `insta_stories_widget_reels` (declared for future use; no block reads it
  yet, same as `STORIES` itself has no block yet)

`WIDGET_KIND_SYNC_CONFIG` gains a second optional key,
`reelListMetafieldKey`, alongside the existing
`featuredReelMetafieldKey` (a kind never needs both — the two are
mutually exclusive by kind). `syncShopWidgetState` writes this field from
the live widget's `config.reelIds` the same way it already writes
`featuredReelMetafieldKey` from `config.featuredReelId`, with the same
"omit the field entirely if the list is empty" simplification already
established for the singular case.

### New model function

`updateWidgetReels(admin: AdminGraphqlClient, id: string, reelIds: string[]): Promise<Widget>` —
same shape as `updateWidgetFeaturedReel`, merges `reelIds` into the
widget's config, persists, syncs.

## Admin UI

Widget detail modal (`app/routes/app.widgets.tsx`): for
`PRODUCT_PAGE_REELS`/`CAROUSEL`/`STORIES` kinds, add a "Choose reels"
section — reuses the same reel-list data already fetched for the
featured-reel picker (`detailFetcher.data.reels`), rendered as a
multi-select checkbox list (not a native `<select multiple>` — Polaris
`s-checkbox` per reel, matching this app's existing form-control style)
with a "Save reels" button posting the selected IDs via a new
`set-reels` action intent.

Order matters for `CAROUSEL` (deck order) — the picker's selection order
is preserved as the array order sent to the server (checking items in
sequence appends to the end; unchecking removes without reordering the
rest).

## Storefront

`product-page-reels.liquid` and `stacked-carousel.liquid`: replace
`{% assign reels_field = block.settings.product.metafields[reel_namespace].reels %}`
with a read of the widget's own curated-list metafield
(`product_page_reels_widget_reels` / `stacked_carousel_widget_reels`).
The existing `widget_matches_product` gating (published + targetRule)
is unchanged — it now gates the curated list's visibility rather than
gating a per-product tagged list. The per-reel filter
(`reel.published.value` + `cloudflareStreamUid`/`hlsManifestUrl`
presence) is unchanged.

`block.settings.product` stays in the schema — still needed for
`targetRule: handles` matching against `product.handle`.

## Testing

- `widget.server.test.ts`: extend the `WIDGET_KIND_SYNC_CONFIG`/
  `syncShopWidgetState` tests to cover `reelListMetafieldKey` (writes the
  list when non-empty, omits when empty — mirroring the existing
  featured-reel test pairs), plus new tests for `updateWidgetReels`.
- Manual/theme-editor verification for the two live blocks (no Liquid
  test harness in this repo, same as every prior plan): pick reels for a
  `PRODUCT_PAGE_REELS` widget, confirm the product page shows exactly
  that curated set regardless of whether the product itself was ever
  tagged to those reels; confirm removing a reel from the curated list
  removes it from the storefront without touching the reel's own
  product-tagging.

## Out of scope

- Any change to the reel→product tagging UI/mechanism itself (still used
  for the in-reel shoppable-product carousel).
- `SINGLE_VIDEO`/`REEL_POPS` featured-reel picker — already shipped,
  untouched.
- Building the `STORIES` Liquid block itself — this spec only updates its
  data-model readiness, consistent with the prior plan's explicit
  deferral.
- Reel ordering drag-and-drop UI — order is checkbox-click order, not a
  dedicated reorder control.
