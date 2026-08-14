# Shared reel lightbox (sub-project 1 of 3: storefront tagged-products polish)

## Problem

Tagged products currently render three different ways across the three
existing theme blocks:

- **Product page reels** (`product-page-reels.liquid`): shows a small
  horizontal-scroll product carousel overlaid on the bottom of the reel
  card itself, while the video plays inline in that same small card.
- **Single video** (`single-video.liquid`): shows no tagged products at
  all — the block was never given that capability.
- **Stacked carousel** (`stacked-carousel.liquid`): shows no tagged
  products at all — this is the reporter's original complaint.

Each block also duplicates its own copy of HLS-attach and add-to-cart
JavaScript, and video plays cramped inside a small in-page card.

This sub-project replaces all three with one consistent interaction:
click any reel → a full-screen lightbox opens → the video plays there,
large → tagged products (with add-to-cart) show in a panel beside/below
it. This is the foundation the next two sub-projects (Insta-stories,
Reel pops) build on.

## Non-goals

- No change to the admin app (`app/`) — this is theme-extension only.
- No new widget kinds — Stories and Reel pops are separate, later
  sub-projects; this one only touches the three blocks that already
  exist.
- No change to how a block decides which reels/products to show
  (targeting, published/ready gating) — that Liquid logic is unchanged;
  only the markup shape and the client-side interaction change.
- No change to the cart-add endpoint or payload (`/cart/add.js`,
  `{ id: variantId, quantity: 1 }`) — same request, just issued from
  inside the lightbox instead of from the inline card.

## Design

### New shared assets

`extensions/shoppable-video-widgets/assets/reel-lightbox.js` and
`reel-lightbox.css` — loaded by all three blocks alongside their own
(now much smaller) per-block JS/CSS.

`reel-lightbox.js` is a self-contained IIFE, idempotent against being
evaluated multiple times (if two blocks are on the same page, each
loads it, and the browser runs it twice) via a lazy singleton: on first
`window.ReelupLightbox.open(triggerEl)` call, it checks for an existing
`#reelup-lightbox` element in the DOM and creates one only if absent,
so a second evaluation of the script reuses the first one's dialog.

It owns:
- **The `<dialog id="reelup-lightbox">` element** — built once via
  `document.createElement`/`innerHTML` and appended to `document.body`,
  not rendered by any block's Liquid.
- **HLS attach/detach** — the same `supportsNativeHls`/`attachSource`/
  `loadHlsJsIfNeeded` logic already duplicated three times today, now
  living in one place. `loadHlsJsIfNeeded` resolves the `hls.min.js`
  path via `document.currentScript.src.replace("reel-lightbox.js",
  "hls.min.js")`.
- **Add-to-cart** — one delegated `click` listener on the lightbox's
  product-panel container, using `event.target.closest("[data-reelup-
  add-to-cart]")`, so cloned product markup (see below) never needs its
  own per-clone listener wiring.
- **Open/close lifecycle** — `open(triggerEl)` reads the trigger's data
  attributes, sets the video's poster/src, clones the trigger's sibling
  `<template>` into the product panel, calls `showModal()`, and starts
  playback (`video.play()` — allowed unmuted because this only ever runs
  inside a real click handler, a user gesture). Close (× button, ESC,
  backdrop click) pauses the video, destroys any active Hls.js instance,
  and clears the product panel so the next open starts clean.

### Per-block trigger contract

Each block's Liquid renders one "trigger" element per reel instead of a
fully interactive inline player:

```html
<div
  class="reelup-trigger"
  data-reelup-trigger
  data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
  data-poster-url="{{ reel.config.value.posterUrl | escape }}"
  data-title="{{ reel.title.value | escape }}"
>
  <button type="button" class="reelup-trigger__button" aria-label="{{ 'reels.play_label' | t }}">
    {% if reel.config.value.posterUrl != blank %}
      <img class="reelup-trigger__poster" src="{{ reel.config.value.posterUrl | escape }}" alt="{{ reel.title.value | escape }}" loading="lazy" width="360" height="640">
    {% endif %}
    <span class="reelup-trigger__play-icon" aria-hidden="true"></span>
  </button>
  {% if reel.tagged_products.value.size > 0 %}
    <template data-reelup-products>
      {% for product in reel.tagged_products.value %}
        {% assign variant = product.selected_or_first_available_variant %}
        <div class="reelup-lightbox__product">
          <a class="reelup-lightbox__product-link" href="{{ product.url }}">
            {% if product.featured_image %}
              <img class="reelup-lightbox__product-image" src="{{ product.featured_image | image_url: width: 160 }}" alt="{{ product.title | escape }}" loading="lazy" width="64" height="64">
            {% endif %}
            <span class="reelup-lightbox__product-info">
              <span class="reelup-lightbox__product-title">{{ product.title }}</span>
              <span class="reelup-lightbox__product-price">{{ product.price | money }}</span>
            </span>
          </a>
          {% if variant %}
            <button type="button" class="reelup-lightbox__add-to-cart" data-reelup-add-to-cart data-variant-id="{{ variant.id }}" data-add-label="{{ 'reels.add_to_cart' | t }}" data-added-label="{{ 'reels.added_to_cart' | t }}">
              {{ 'reels.add_to_cart' | t }}
            </button>
          {% endif %}
        </div>
      {% endfor %}
    </template>
  {% endif %}
</div>
```

`.reelup-trigger`, `.reelup-trigger__button`, `.reelup-trigger__poster`,
`.reelup-trigger__play-icon` are defined once in `reel-lightbox.css` and
shared by all three blocks. Each block keeps its own CSS only for the
**layout that positions triggers** (product-page-reels' horizontal
scroll row, stacked-carousel's grid, single-video's single centered
column) — sizing/aspect-ratio of the trigger frame itself stays
block-controlled via the existing `--reelup-aspect-ratio` custom
property pattern, since a single video's frame is bigger than a grid
cell's.

Each block's own JS shrinks to wiring clicks to the shared lightbox —
no more per-block HLS/lazy-load/IntersectionObserver logic, since
nothing plays until a reel is actually opened:

```js
(() => {
  document.querySelectorAll("[data-reelup-trigger]").forEach((trigger) => {
    trigger
      .querySelector(".reelup-trigger__button")
      ?.addEventListener("click", () => window.ReelupLightbox?.open(trigger));
  });
})();
```

### Lightbox markup (built by JS, not Liquid)

```html
<dialog id="reelup-lightbox" class="reelup-lightbox" aria-labelledby="reelup-lightbox-title">
  <button type="button" class="reelup-lightbox__close" data-reelup-lightbox-close aria-label="{close label}">×</button>
  <div class="reelup-lightbox__body">
    <div class="reelup-lightbox__player">
      <h2 id="reelup-lightbox-title" class="reelup-lightbox__title"></h2>
      <video class="reelup-lightbox__video" playsinline controls></video>
    </div>
    <div class="reelup-lightbox__products" data-reelup-lightbox-products></div>
  </div>
</dialog>
```

The close-button `aria-label` and a small "Shop this video" heading
above the product panel are read from two new locale keys (see below),
inlined into the JS-built markup as plain strings passed from each
block's Liquid via a `data-*` attribute on the trigger's parent block
wrapper (simplest: each block passes its own translated strings once
via the outermost wrapper element's `data-close-label`/
`data-shop-label` attributes; `reel-lightbox.js` reads them from
whichever trigger was clicked).

Layout: full-viewport fixed overlay, backdrop blur, video framed large
and centered (9:16, capped at a comfortable max-height so it never
exceeds the viewport), product panel to the right on wide viewports
(`min-width: 720px`) and below the video (scrollable) on narrow ones —
plain CSS `@media` query, matching the storefront extension's existing
plain-CSS convention (no Tailwind here — that's the separate admin
surface).

### Per-block changes

- **`product-page-reels.liquid`**: cards become triggers per the
  contract above. The current inline mini-carousel-with-add-to-cart
  markup, and its now-dead CSS (`.reelup-reel__products*`,
  `.reelup-reel__product*`, `.reelup-reel__products-nav*` in
  `product-page-reels.css`) and JS (`bindProductsCarousel`,
  `bindAddToCartButtons` in `product-page-reels.js`), are removed —
  the lightbox supersedes them. The horizontal-scroll row layout for
  multiple reels stays.
- **`single-video.liquid`**: gains a `<template>` of tagged products
  for the first time (it currently renders none), using the same
  `reel.tagged_products.value` loop the other two blocks already use.
- **`stacked-carousel.liquid`**: same — gains tagged-products rendering
  for the first time. The 4/3/2-column responsive grid layout stays.

### Locale keys

Add to `locales/en.default.json`: `reels.close_label` ("Close"),
`reels.shop_this_video_label` ("Shop this video"). Remove
`reels.previous_product_label`/`reels.next_product_label` — the
lightbox's product panel is a simple scrollable list, not a
horizontal-scroll carousel, so prev/next navigation no longer applies
anywhere in the codebase after this change.

## Testing

No automated test suite covers the theme extension (Liquid/JS/CSS —
this project's `vitest` suite only covers the admin app's server
models). Verification is manual, via the theme editor / a dev store
preview: confirm each of the three blocks still renders its trigger
grid/row/single-card layout correctly, clicking any reel opens the
lightbox with video playing and (when the reel has tagged products) the
product panel populated, add-to-cart on a lightbox product succeeds
(cart count updates), and closing via ×/ESC/backdrop all correctly stop
playback and tear down HLS.

## Out of scope

- Insta-stories and Reel pops block types — separate sub-projects,
  built on this lightbox from day one once it exists.
- Any admin-app change.
