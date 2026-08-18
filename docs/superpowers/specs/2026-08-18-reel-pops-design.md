# Reel pops block (sub-project 3 of 3: storefront tagged-products polish)

## Problem

The `REEL_POPS` widget kind is fully modeled (Prisma schema, admin create/
edit flow, shop metafield sync — `reel_pops_widget`/
`reel_pops_featured_reel`, both already declared in `shopify.app.toml`)
but has no actual theme block, same gap Insta-stories had before
sub-project 2. A merchant can create and publish a Reel pops widget in
the admin today and nothing renders on the storefront.

Reel pops holds a single merchant-picked featured reel (same data shape
`SINGLE_VIDEO` uses — `featuredReelId`, not a curated list), and its own
description is "a site-wide floating bubble that expands into a video" —
unlike the other four blocks, it isn't placed into one section by a
merchant; it's meant to float across the whole site.

## Non-goals

- No admin-app changes — the admin create/edit flow for REEL_POPS
  already works.
- No change to `shopify.app.toml` — the metafield definitions this block
  reads already exist.
- No new viewer component — because Reel pops shows exactly one reel,
  the already-shipped lightbox (sub-project 1) is reused as-is. This
  sub-project adds no new video-playback or tagged-products-panel code.
- This closes out the three-sub-project storefront polish effort — no
  further widget kinds remain unbuilt after this.

## Design

### Placement: app embed, not a section block

The other three blocks (and Stories) are `"target": "section"` blocks a
merchant manually adds to a page section. Reel pops is
`"target": "body"` instead — a Shopify app embed. Merchants enable it
once under Theme Settings → App embeds, and it then renders on every
page via the theme's layout, without being placed into any specific
section. No `product` autofill setting is declared (app embeds don't
take one) — the block instead checks for the `product` Liquid object's
presence directly, since it's only populated when the current page
happens to be a product page.

### Targeting on a site-wide block

Same `published`/`targetRule` shape as every other block
(`shop.metafields[reel_namespace].reel_pops_widget`), but the match
logic accounts for pages that aren't product pages at all:

- `targetRule.type == "all_products"` → show on every page, product or
  not.
- `targetRule.type == "handles"` → show only when the current page IS a
  product page (`product` is present) AND its handle is in the list.
  Non-product pages never match a handles-scoped rule (there's no
  product to check against).

### Reusing the existing lightbox — no new JS for playback

The bubble renders using the *exact same* `data-reelup-trigger` data
contract (`data-hls-src`/`data-poster-url`/`data-title`/`data-close-
label`/`data-shop-label` + a sibling `<template data-reelup-products>`)
every other block already produces. That means the *already-shipped*
`reel-trigger.js` (used unchanged by Product page reels, Single video,
Stacked carousel) binds the bubble's click to `window.ReelupLightbox
.open(trigger)` with zero new code — the block just needs to load
`reel-hls.js` + `reel-lightbox.js` + `reel-trigger.js` alongside its own
two new files below. Clicking the bubble opens the same full-screen
lightbox with tagged products + add-to-cart, exactly like the other
blocks.

### New files

- **`blocks/reel-pops.liquid`** — the app-embed block itself: gating
  logic, the bubble's trigger markup, the dismiss button, script/style
  loading.
- **`assets/reel-pop.css`** — fixed bottom-right positioning, the
  circular-avatar override for the trigger button (same ancestor-
  specificity pattern proven in sub-project 2's Stories fix —
  `.reelup-pop .reelup-trigger__button`, not a same-specificity bare
  class, so it isn't fragile to `<link>` tag ordering across blocks), a
  subtle scale/fade entrance animation (guarded by `@media
  (prefers-reduced-motion: reduce)`), and the dismiss button's styling.
- **`assets/reel-pop.js`** — the only genuinely new behavior: reads a
  `sessionStorage` key scoped to the featured reel's id
  (`reelup-pop-dismissed-<reel.id>`, so changing which reel is featured
  un-hides the bubble for shoppers who'd dismissed the previous one),
  hides the bubble immediately on load if that key is set, and wires the
  dismiss button to hide the bubble + set the key (wrapped in a
  `try`/`catch`, since `sessionStorage` can throw in some private-
  browsing configurations — dismissal still works for that page view
  even if it can't persist).

The dismiss button is a sibling of the trigger `<div>`, not nested
inside its `<button>` (nesting buttons is invalid HTML and would also
make click-target disambiguation harder) — `event.stopPropagation()` in
the dismiss handler keeps its click from also reaching the trigger's own
open-lightbox listener, since the two are positioned as overlapping
siblings, not parent/child.

### Locale key

Add `reels.dismiss_label` ("Dismiss") to `en.default.json`, used as the
dismiss button's `aria-label`.

## Testing

Same as sub-projects 1-2: no automated test suite covers the theme
extension. Verification is manual: enable the app embed in Theme
Settings on a dev store, confirm the bubble appears on eligible pages
per the target rule, clicking it opens the lightbox with the featured
reel + tagged products, the dismiss × hides it and it stays hidden on
subsequent page loads within the same browser session, and it
reappears in a fresh session (or after the merchant changes the
featured reel).

## Out of scope

- Any admin-app change.
- Any change to the already-shipped lightbox, story viewer, or the
  three/four existing blocks' own behavior — this sub-project only adds
  new files plus the one shared-script reuse already proven safe by
  Stories loading `reel-hls.js`/`reel-lightbox.js` alongside its own
  code.
