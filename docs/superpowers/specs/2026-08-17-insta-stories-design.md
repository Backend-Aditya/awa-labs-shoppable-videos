# Insta-stories block (sub-project 2 of 3: storefront tagged-products polish)

## Problem

The `STORIES` widget kind is fully modeled (Prisma schema, admin create/
edit flow, shop metafield sync — `insta_stories_widget`/
`insta_stories_widget_reels`, both already declared in
`shopify.app.toml`) but has no actual theme block. A merchant can create
and publish an Insta-stories widget in the admin today and nothing
renders on the storefront.

This sub-project builds that block: a row of circular avatar triggers
that open a full-screen, auto-advancing story viewer cycling through the
widget's curated reels, with tagged products reachable via a tap-to-open
drawer.

## Non-goals

- No admin-app changes — the admin create/edit flow for STORIES already
  works (confirmed in the earlier widget-template-gallery work).
- No change to `shopify.app.toml` — the metafield definitions this block
  reads already exist.
- No change to the three already-shipped blocks' own behavior, beyond
  the shared-code extraction described below (which must not change
  their observable behavior).
- Reel pops (the last remaining widget kind) is sub-project 3, separate.

## Design

### Shared-code refactor: `reel-hls.js`

The lightbox (`reel-lightbox.js`, shipped in sub-project 1) has its own
private copy of HLS attach/detach logic. The story viewer needs the
identical logic. Rather than duplicate it a second time, extract it into
a new shared `assets/reel-hls.js`:

```js
window.ReelupHls = {
  attach(video, hlsSrc): Promise<void>,  // native HLS, or loads hls.min.js + Hls.js as needed
  teardown(video): void,                  // destroys any active Hls.js instance, clears video src
};
```

`reel-lightbox.js` is updated to call `window.ReelupHls.attach`/
`.teardown` instead of its own inline copies — this is a refactor of
already-shipped code with no intended behavior change (same fallback
order: native HLS → Hls.js → reject; same teardown-on-close timing). All
three existing blocks add one more `<script>` tag (`reel-hls.js`,
loaded before `reel-lightbox.js`).

### Trigger markup: circular avatars, same data contract

Each reel renders using the *exact same* trigger contract already
established (`data-reelup-trigger` with `data-hls-src`/`data-poster-
url`/`data-title`/`data-close-label`/`data-shop-label`, plus a sibling
`<template data-reelup-products>` of pre-rendered tagged-product
markup, reusing the `.reelup-lightbox__product*` classes from
`reel-lightbox.css`) — just styled as a small circle instead of a big
9:16 card, and wrapped in a new container attribute,
`data-reelup-story-group`, on the block's outer `<div>`. The story
viewer JS collects all `[data-reelup-trigger]` elements inside the
clicked avatar's `[data-reelup-story-group]` ancestor to build its full
navigation sequence — so tapping any avatar starts the story session at
that reel, but the shopper can navigate through every curated reel in
the widget from there.

### Story viewer

A second singleton `<dialog>` (separate from the lightbox's — the two
never open at once in this app's flow), built lazily the same way. It
owns:

- **Segmented progress bar** at the top, one segment per reel in the
  session. The active segment animates from empty to full over a fixed
  15-second duration (`DURATION_MS`, a plain CSS `width` transition,
  not tied to the video's actual playback position — avoids relying on
  HLS `duration` metadata, which isn't always immediately available).
  Finishing reels are marked full; not-yet-reached reels stay empty.
- **Auto-advance**: when the active segment's timer completes, OR the
  video's native `ended` event fires (whichever happens first — a
  shorter video doesn't force the shopper to wait out the full 15s),
  the viewer advances to the next reel. Advancing past the last reel
  closes the viewer.
- **Manual navigation**: two large invisible tap zones over the left
  and right thirds of the video frame — right advances, left goes back
  (clamped at index 0, doesn't close). Small `‹`/`›` chevrons render
  faintly on hover/focus as a discoverability hint, not required to use
  them.
- **Shop drawer**: when the active reel has tagged products, a small
  "Shop this video" pill (using `reels.shop_this_video_label`) sits at
  the bottom of the frame. Tapping it slides up a drawer containing that
  reel's cloned `<template data-reelup-products>` content (same
  `.reelup-lightbox__product`/`.reelup-lightbox__add-to-cart` markup and
  delegated add-to-cart handler pattern as the lightbox) — opening the
  drawer pauses the video and the auto-advance timer; a drag-handle/tap
  closes the drawer, which resumes both. When the active reel has no
  tagged products, the pill is hidden.
- **Close**: × button, ESC (native dialog), or backdrop click (same
  `event.target === dialog || event.target === bodyEl` pattern already
  proven in the lightbox) — tears down HLS via `window.ReelupHls.teardown`,
  clears the timer, and resets the drawer.

### New block: `insta-stories.liquid`

Same gating pattern as the other three blocks (`widget_matches_product`/
`visible_count` derived from `shop.metafields[reel_namespace]
.insta_stories_widget`/`.insta_stories_widget_reels`, same
`reel.published.value`/`cloudflareStreamUid`/`hlsManifestUrl` per-reel
readiness check). Renders the avatar row wrapped in
`data-reelup-story-group`, loads `reel-lightbox.css` (for the shared
product-card classes the drawer reuses) + a new `reel-story.css`, and
`reel-hls.js` + `reel-story.js` at the end.

## Testing

Same as sub-project 1: no automated test suite covers the theme
extension. Verification is manual, via theme editor / dev store:
confirm the avatar row renders, tapping any avatar opens the viewer
starting at that reel, the progress bar advances and auto-advances
correctly, manual left/right tap navigation works, the shop drawer opens/
closes and add-to-cart works, and all three close paths correctly stop
playback.

## Out of scope

- Reel pops block (sub-project 3).
- Any change to the three already-shipped blocks' rendered output or
  interaction behavior (only their shared HLS code moves, unchanged in
  effect).
