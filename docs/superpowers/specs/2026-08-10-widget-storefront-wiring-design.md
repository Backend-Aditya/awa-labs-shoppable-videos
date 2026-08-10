# Wire `Widget` (PRODUCT_PAGE_REELS) into the storefront block

## Problem

The admin's Widgets section (`Widget` Prisma model — `type`, `published`,
`config.targetRule`) has no connection to the storefront. The only theme
block that exists, `extensions/shoppable-video-widgets/blocks/product-page-reels.liquid`,
ignores `Widget` entirely: it shows any `published` + `ready` reel tagged to
the current product, regardless of whether any widget exists, is published,
or targets that product. Creating/publishing a widget in admin currently has
zero visible effect on the storefront.

This spec covers wiring `PRODUCT_PAGE_REELS` widgets into that block. Building
theme implementations for the other 4 widget kinds (Carousel, Grid, Stories,
Reel Pops) is a separate, larger sub-project and is out of scope here.

## Behavior

- **No published `PRODUCT_PAGE_REELS` widget for the shop** → block renders
  nothing, even if the product has published/ready tagged reels. The widget
  becomes the on/off switch for the whole feature.
- **At most one published `PRODUCT_PAGE_REELS` widget per shop.** Publishing
  a widget auto-unpublishes any other currently-published widget of the same
  kind.
- **`targetRule: all_products`** → published widget applies to every
  product.
- **`targetRule: { type: "handles", handles: [...] }`** → published widget
  applies only to products whose handle is in the list.
- Reel-level gating (`reel.published`, `cloudflareStreamUid` +
  `hlsManifestUrl` present) is unchanged — a matching published widget is an
  additional, outer condition, not a replacement.
- Deleting a published widget must not leave stale "published" state behind.

## Data flow

Liquid has no access to this app's Postgres DB, only to Shopify-owned data
(metafields, metaobjects). So `Widget` state must be mirrored into a
Shopify metafield for the block to read it, the same way reel-tagging is
already mirrored into a product metafield (`syncProductReelMetafields`).

- **Storage**: a shop-level metafield, `namespace: "$app"`,
  `key: "product_page_reels_widget"`, `type: "json"`. Same reserved
  `$app` namespace trick already used for reel tagging — resolves per
  install without hardcoding an app id in the write path (the read path in
  Liquid still needs the app's resolved namespace string, same as
  `reel-namespace.liquid` today).
- **Value shape**: `{ "published": boolean, "targetRule": WidgetConfig["targetRule"] }`.
- **Write trigger**: a new `syncWidgetConfigMetafield(admin, widget)` in
  `app/models/widget.server.ts`, called:
  - after `updateWidget` when `published` changes,
  - after `updateWidgetTargetRule`,
  - after `deleteWidget` (write `published: false`, or delete the
    metafield outright, for the widget being removed — prevents stale
    "published" state if a published widget is deleted).
- **Publish uniqueness**: when a widget is published, before writing its own
  metafield, find any other currently-published `PRODUCT_PAGE_REELS` widget
  for the shop, flip it to `published: false` in Postgres, and re-sync its
  metafield too (so the shop metafield always reflects at most one
  published widget).

## Liquid changes (`product-page-reels.liquid`)

Before the existing per-reel loop:

1. Read `shop.metafields["$app"].product_page_reels_widget` (via the same
   `reel-namespace`-style resolved-namespace snippet, or a sibling snippet
   if the resolved namespace differs for shop- vs product-owner metafields
   — needs live verification, same as `reel-namespace.liquid`'s own
   docstring notes doing).
2. If missing, or `published` is falsy → render nothing (early exit).
3. If `targetRule.type == "handles"` and `product.handle` is not in
   `targetRule.handles` → render nothing.
4. Otherwise proceed with the existing per-reel filtering/rendering logic,
   unchanged.

## Testing

- `widget.server.test.ts`: `syncWidgetConfigMetafield` writes the expected
  metafield shape; publishing a widget unpublishes and re-syncs a
  previously-published sibling; deleting a published widget clears/unsets
  its metafield.
- Manual/theme-editor verification of the Liquid gating (no automated test
  harness for Liquid in this repo) — publish/unpublish a widget, change
  `targetRule`, confirm the block appears/disappears accordingly on a real
  product page.

## Out of scope

- Carousel / Grid / Stories / Reel Pops theme implementations.
- Any UI change to the Widgets admin section beyond what's needed to trigger
  the new sync (the existing publish toggle and target-rule editor already
  cover this).
