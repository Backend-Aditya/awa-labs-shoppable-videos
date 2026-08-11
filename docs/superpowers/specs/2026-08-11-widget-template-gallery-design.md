# Template gallery + 4 new widget templates

## Problem

The admin's "Create a widget" form offers 5 `WidgetKind` values in a plain
`<select>`, but only `PRODUCT_PAGE_REELS` has a real storefront
implementation (see `docs/superpowers/plans/2026-08-10-widget-storefront-wiring.md`).
The other 4 (`CAROUSEL`, `STORIES`, `REEL_POPS`, and a new `SINGLE_VIDEO`
kind) render nothing on the storefront regardless of what the merchant
configures.

This spec covers building all 4 out, plus replacing the plain dropdown
with a visual template-picker gallery (inspired by competitor apps that
show 20+ template thumbnails to choose from). The other 15+ templates
glimpsed in that reference are explicitly out of scope — this is one
batch of a repeatable pattern, not the whole gallery.

## Templates in this batch

1. **Single video** — one video, no carousel, no product-tag row. The
   merchant explicitly picks which reel plays (not product-tag-driven).
2. **Stacked carousel** (`WidgetKind: CAROUSEL`) — tagged reels shown as a
   stacked/peek deck of video cards, swipeable. Same product-tagging data
   source as `PRODUCT_PAGE_REELS` (reel published + tagged to the current
   product), different visual layout.
3. **Insta-style stories** (`WidgetKind: STORIES`) — row of circular
   avatars (reel posters); tapping one opens a full-screen story-style
   viewer with tap-through navigation between the product's tagged reels.
4. **Reel pops** (`WidgetKind: REEL_POPS`) — a floating bubble, site-wide
   (every page, not just product pages), that expands into a video overlay
   on tap, showing one merchant-picked featured reel.

## Placement architecture

Templates 1–3 are **product-page-scoped**, same mechanism as
`PRODUCT_PAGE_REELS`: a theme block with `target: "section"`, placed once
by the merchant in the product template, gated by a published widget of
that `type` + `targetRule` matching the current product.

Template 4 (Reel pops) is **site-wide**, a fundamentally different
Shopify primitive: a theme **app-embed block**
(`shopify.extension.toml`/block schema `target: "body"` via the theme
editor's separate "App embeds" panel — toggled once, then live on every
page). It cannot reuse the per-product `block.settings.product`
autofill pattern the other blocks depend on, since there's no contextual
product on arbitrary pages.

## Data model

### `WidgetConfig` (`app/models/widget.server.ts`)

Add an optional field:

```typescript
export interface WidgetConfig {
  templateStyle: string;
  targetRule:
    | { type: "all_products" }
    | { type: "handles"; handles: string[] };
  featuredReelId?: string; // gid://shopify/Metaobject/... — used by
                            // SINGLE_VIDEO and REEL_POPS only
}
```

### `WidgetKind`

Add `SINGLE_VIDEO`:

```typescript
export type WidgetKind =
  | "PRODUCT_PAGE_REELS"
  | "CAROUSEL"
  | "GRID"
  | "STORIES"
  | "REEL_POPS"
  | "SINGLE_VIDEO";
```

(`GRID` stays reserved/unimplemented for a future batch, per the earlier
plan's out-of-scope note.)

### Shop metafields

One JSON metafield per templated kind, same shape as today's
`product_page_reels_widget` (`{ published: boolean, targetRule }`):

- `single_video_widget`
- `stacked_carousel_widget`
- `insta_stories_widget`
- `reel_pops_widget`

`SINGLE_VIDEO` and `REEL_POPS` additionally need the **featured reel's
actual data** (title, `hlsManifestUrl`, `posterUrl`) resolvable in Liquid.
Mirroring why `tagged_products` had to become a native
`list.product_reference` field instead of raw JSON (Liquid cannot
dereference a bare GID string): each of these two kinds gets a matching
shop-level `metaobject_reference<$app:reel>` field —
`single_video_featured_reel`, `reel_pops_featured_reel` — synced whenever
`featuredReelId` changes.

### `syncShopWidgetState` generalization (`app/models/widget.server.ts`)

Currently hardcoded: `if (widget.type !== "PRODUCT_PAGE_REELS") return;`.
Generalize to a per-kind config map:

```typescript
const WIDGET_KIND_SYNC_CONFIG: Partial<Record<WidgetKind, {
  metafieldKey: string;
  featuredReelMetafieldKey?: string;
}>> = {
  PRODUCT_PAGE_REELS: { metafieldKey: "product_page_reels_widget" },
  SINGLE_VIDEO: {
    metafieldKey: "single_video_widget",
    featuredReelMetafieldKey: "single_video_featured_reel",
  },
  CAROUSEL: { metafieldKey: "stacked_carousel_widget" },
  STORIES: { metafieldKey: "insta_stories_widget" },
  REEL_POPS: {
    metafieldKey: "reel_pops_widget",
    featuredReelMetafieldKey: "reel_pops_featured_reel",
  },
};
```

`syncShopWidgetState` looks up the widget's `type` in this map; kinds not
present (`GRID`) are a no-op, same as today. The "at most one published
widget" exclusivity check in `updateWidget` stays scoped to
`shopId + type` — each kind independently enforces its own singleton, so
a shop can have one published `SINGLE_VIDEO` widget AND one published
`STORIES` widget simultaneously (different metafields, no conflict).

## Admin UI

### Template picker gallery (`app/routes/app.widgets.tsx`)

Replaces the `<s-select>` in "Create a widget" with a grid of 5 cards
(existing `WIDGET_KINDS` order plus the new kind), each showing:
- A small CSS-drawn preview (reuse the existing card-style patterns
  already in the codebase — poster-style rectangles, no new image assets)
- Template name
- One-line description

Clicking a card selects it (radio-button semantics under the hood,
visually a bordered/highlighted card) instead of opening a dropdown.

### Featured-reel picker (widget detail modal, `app.widgets.tsx`)

For `SINGLE_VIDEO` and `REEL_POPS` widgets, the modal gains a "Choose
reel" button. Opens a simple list (fetched from the shop's existing
Reels — reuse `listReels`) for the merchant to pick one; selection posts
`featuredReelId` via the existing fetcher-based action pattern, which
triggers `updateWidget`'s existing sync path (extended per above) to
write both the JSON metafield and the featured-reel reference field.

## Storefront implementation

New extension files under `extensions/shoppable-video-widgets/`:

- `blocks/single-video.liquid` — reads `single_video_widget` +
  `single_video_featured_reel`; renders one video player (reuses the
  existing `product-page-reels.js`/`.css` play/pause mechanics, no
  product-tag carousel).
- `blocks/stacked-carousel.liquid` — reads `stacked_carousel_widget` +
  the product's tagged-reels metafield (same data source as
  `product-page-reels.liquid`); renders a stacked/peek deck instead of a
  horizontal row.
- `blocks/insta-stories.liquid` — reads `insta_stories_widget` + tagged
  reels; renders a circular-avatar row; new JS for the full-screen story
  viewer (tap-through, progress bars per story — standard stories UX).
- `blocks/reel-pops.liquid`, `target: "body"` app-embed — reads
  `reel_pops_widget` + `reel_pops_featured_reel`; renders a floating
  bubble + expandable video overlay, site-wide.

Each new block/kind needs its own `[shop.metafields.app.*]` definition
block in `shopify.app.toml`, deployed via `shopify app deploy` (same
step this required for `product_page_reels_widget`).

## Testing

- `widget.server.test.ts`: extend `syncShopWidgetState` tests to cover
  the generalized per-kind lookup (each kind syncs to its own metafield
  key, `GRID` still no-ops, featured-reel fields sync only for the two
  kinds that need them).
- Manual/theme-editor verification per template (no Liquid test harness
  in this repo, same as the first widget-wiring plan) — publish each
  template, confirm it renders/gates correctly, confirm Reel pops appears
  site-wide once its app-embed is toggled on in theme editor.

## Out of scope

- Grid template and the other 15+ templates from the reference screenshot
  (Round video pop, Full page popup, Product along side, Momentum grid,
  etc.) — future batches.
- Custom illustrated preview images for the gallery cards — CSS-drawn
  previews only, matching the existing lightweight admin UI style.
- Cross-kind analytics/reporting on which template performs better.
