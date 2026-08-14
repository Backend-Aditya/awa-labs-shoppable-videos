# Reel Lightbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace each of the three existing theme blocks' own inline-play + inconsistent tagged-products handling with one shared full-screen lightbox: click any reel, video plays large, tagged products (with add-to-cart) show in a panel.

**Architecture:** Two new shared assets — `reel-lightbox.css` (trigger-frame styling + the lightbox itself) and `reel-lightbox.js` (the lightbox singleton: HLS attach/detach, add-to-cart, open/close) — plus one new shared `reel-trigger.js` (click-wiring, identical across all three blocks, so it exists once instead of three times). Each block's own `.liquid`/`.css` shrinks to just its trigger markup and its own layout (row/grid/single), and its old per-block JS file is deleted.

**Tech Stack:** Plain Liquid/CSS/JS (the storefront extension has no build step, no Tailwind — that's the separate admin surface). No new dependencies.

## Global Constraints

- This plan touches only `extensions/shoppable-video-widgets/**` — no admin-app (`app/`) file changes.
- No change to how a block decides which reels/products are eligible (the `widget_matches_product`/`visible_count` gating Liquid in each block) — only the per-reel markup shape and the client-side interaction change.
- The cart-add request stays `POST /cart/add.js` with `{ id: variantId, quantity: 1 }` body, same as today.
- All three blocks share one `.reelup-trigger`/`.reelup-trigger__button`/`.reelup-trigger__poster`/`.reelup-trigger__play-icon` CSS contract (defined once, in `reel-lightbox.css`) and one `reel-trigger.js` click-wiring script (defined once, not duplicated per block) — this is a deliberate DRY refinement beyond the design spec's illustrative per-block JS sketch, since all three blocks' click-wiring logic is byte-identical.
- Every reel's poster `<img>` keeps `loading="lazy"` and explicit `width`/`height` (unchanged CLS-prevention practice from the current code).
- No automated test suite covers this extension (Liquid/JS/CSS) — verification per task is visual/manual via the theme editor, described in each task's Step 2. Run `npm run typecheck`, `npm run lint`, and `npm run test` after every task anyway, since a typo in shared JS/CSS filenames referenced from `asset_url` calls wouldn't be caught by those, but a broken admin build would be — they must stay clean as a basic sanity check that nothing else was accidentally touched.

---

### Task 1: Update locale keys

**Files:**
- Modify: `extensions/shoppable-video-widgets/locales/en.default.json`

**Interfaces:**
- Produces: `reels.close_label`, `reels.shop_this_video_label` — consumed by every block's trigger markup (Tasks 5-7) via `{{ 'reels.close_label' | t }}`/`{{ 'reels.shop_this_video_label' | t }}`.
- Removes: `reels.previous_product_label`, `reels.next_product_label` — the lightbox's product panel is a simple scrollable list, not a horizontal-scroll carousel with prev/next arrows, so these become unused everywhere after this plan.

- [ ] **Step 1: Replace the file in full**

```json
{
  "reels": {
    "play_label": "Play video",
    "add_to_cart": "Add to cart",
    "added_to_cart": "Added",
    "close_label": "Close",
    "shop_this_video_label": "Shop this video"
  }
}
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean (this file isn't part of the admin app's build, so this just confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add extensions/shoppable-video-widgets/locales/en.default.json
git commit -m "feat(storefront): add lightbox locale keys, drop unused carousel-nav keys"
```

---

### Task 2: Create the shared trigger + lightbox stylesheet

**Files:**
- Create: `extensions/shoppable-video-widgets/assets/reel-lightbox.css`

**Interfaces:**
- Produces: `.reelup-trigger`, `.reelup-trigger__button`, `.reelup-trigger__poster`, `.reelup-trigger__play-icon` (the shared per-reel trigger frame, 9:16, consumed by all three blocks in Tasks 5-7) and `.reelup-lightbox*` (the lightbox itself and its product-list classes, consumed by `reel-lightbox.js` in Task 3 and by every block's `<template>` product markup in Tasks 5-7).

- [ ] **Step 1: Create the file**

```css
.reelup-trigger {
  display: block;
  width: 100%;
  height: 100%;
}

.reelup-trigger__button {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  aspect-ratio: 9 / 16;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  border-radius: 12px;
  overflow: hidden;
  background: #111;
}

.reelup-trigger__poster {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.reelup-trigger__play-icon {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}

.reelup-trigger__play-icon::before {
  content: "";
  display: block;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 8px 0 8px 14px;
  border-color: transparent transparent transparent #fff;
  margin-left: 3px;
}

.reelup-trigger__button:hover .reelup-trigger__play-icon,
.reelup-trigger__button:focus-visible .reelup-trigger__play-icon {
  background: rgba(0, 0, 0, 0.75);
}

.reelup-lightbox {
  position: fixed;
  inset: 0;
  margin: 0;
  padding: 0;
  width: 100vw;
  height: 100vh;
  max-width: 100vw;
  max-height: 100vh;
  border: none;
  background: transparent;
  z-index: 1000;
}

.reelup-lightbox::backdrop {
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(4px);
}

.reelup-lightbox__close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.reelup-lightbox__close:hover,
.reelup-lightbox__close:focus-visible {
  background: rgba(255, 255, 255, 0.3);
}

.reelup-lightbox__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 56px 16px 16px;
  gap: 16px;
  overflow-y: auto;
  box-sizing: border-box;
}

.reelup-lightbox__player {
  position: relative;
  flex: 0 0 auto;
  width: 100%;
  max-width: 420px;
  aspect-ratio: 9 / 16;
  max-height: 72vh;
  border-radius: 16px;
  overflow: hidden;
  background: #000;
}

.reelup-lightbox__title {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  z-index: 1;
  margin: 0;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

.reelup-lightbox__video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
}

.reelup-lightbox__products {
  flex: 0 0 auto;
  width: 100%;
  max-width: 420px;
  background: #fff;
  border-radius: 16px;
  padding: 16px;
  box-sizing: border-box;
}

.reelup-lightbox__products-heading {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: #111;
}

.reelup-lightbox__products-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 40vh;
  overflow-y: auto;
}

.reelup-lightbox__product {
  display: flex;
  align-items: center;
  gap: 12px;
}

.reelup-lightbox__product-link {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  color: inherit;
}

.reelup-lightbox__product-image {
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 10px;
}

.reelup-lightbox__product-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.reelup-lightbox__product-title {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reelup-lightbox__product-price {
  font-size: 13px;
  font-weight: 600;
  color: #555;
}

.reelup-lightbox__add-to-cart {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 600;
  padding: 9px 14px;
  border-radius: 999px;
  border: none;
  background: #111;
  color: #fff;
  cursor: pointer;
  white-space: nowrap;
}

.reelup-lightbox__add-to-cart[data-state="loading"] {
  opacity: 0.6;
  cursor: default;
}

.reelup-lightbox__add-to-cart[data-state="added"] {
  background: #1f9d55;
}

@media (min-width: 720px) {
  .reelup-lightbox__body {
    flex-direction: row;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .reelup-lightbox__player {
    max-height: 88vh;
  }

  .reelup-lightbox__products {
    align-self: center;
    max-height: 88vh;
    overflow-y: auto;
  }

  .reelup-lightbox__products-list {
    max-height: none;
  }
}
```

- [ ] **Step 2: Verify**

Nothing references this file yet (later tasks add the `stylesheet_tag` calls). Run:
```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add extensions/shoppable-video-widgets/assets/reel-lightbox.css
git commit -m "feat(storefront): add shared trigger + lightbox stylesheet"
```

---

### Task 3: Create the shared lightbox behavior script

**Files:**
- Create: `extensions/shoppable-video-widgets/assets/reel-lightbox.js`

**Interfaces:**
- Produces: `window.ReelupLightbox.open(triggerEl: HTMLElement): Promise<void>` — consumed by `reel-trigger.js` (Task 4).
- Consumes (via `triggerEl.dataset`): `hlsSrc`, `posterUrl`, `title`, `closeLabel`, `shopLabel`, and a sibling `<template data-reelup-products>` holding pre-rendered product markup — all produced per-reel by each block's Liquid (Tasks 5-7).

- [ ] **Step 1: Create the file**

```js
(() => {
  const currentScriptSrc = document.currentScript?.src ?? "";

  const supportsNativeHls = (video) =>
    video.canPlayType("application/vnd.apple.mpegurl") !== "";

  let hlsInstance = null;

  const loadHlsJsIfNeeded = () => {
    if (window.Hls || document.querySelector("script[data-reelup-hlsjs]")) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = currentScriptSrc.replace("reel-lightbox.js", "hls.min.js");
      script.dataset.reelupHlsjs = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load hls.js"));
      document.head.appendChild(script);
    });
  };

  const attachSource = (video, hlsSrc) => {
    if (supportsNativeHls(video)) {
      video.src = hlsSrc;
      return Promise.resolve();
    }

    if (!window.Hls?.isSupported()) {
      return Promise.reject(new Error("HLS not supported"));
    }

    hlsInstance?.destroy();
    hlsInstance = null;

    return new Promise((resolve, reject) => {
      const hls = new window.Hls();
      hlsInstance = hls;
      hls.loadSource(hlsSrc);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => resolve());
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) reject(new Error(data.type));
      });
    });
  };

  // Runs on every close (×, ESC, backdrop) via the dialog's native "close"
  // event, so all three dismissal paths tear down the same way — no
  // separate close handler needs to remember to call this.
  const teardownSource = (video) => {
    hlsInstance?.destroy();
    hlsInstance = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  const buildLightbox = () => {
    const existing = document.getElementById("reelup-lightbox");
    if (existing) return existing;

    const dialog = document.createElement("dialog");
    dialog.id = "reelup-lightbox";
    dialog.className = "reelup-lightbox";
    dialog.setAttribute("aria-labelledby", "reelup-lightbox-title");
    dialog.innerHTML = `
      <button type="button" class="reelup-lightbox__close" data-reelup-lightbox-close>&times;</button>
      <div class="reelup-lightbox__body">
        <div class="reelup-lightbox__player">
          <h2 id="reelup-lightbox-title" class="reelup-lightbox__title"></h2>
          <video class="reelup-lightbox__video" playsinline controls></video>
        </div>
        <div class="reelup-lightbox__products" data-reelup-lightbox-products hidden>
          <h3 class="reelup-lightbox__products-heading" data-reelup-lightbox-products-heading></h3>
          <div class="reelup-lightbox__products-list" data-reelup-lightbox-products-list></div>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);

    const video = dialog.querySelector(".reelup-lightbox__video");
    const productsPanel = dialog.querySelector("[data-reelup-lightbox-products]");
    const productsList = dialog.querySelector("[data-reelup-lightbox-products-list]");
    const closeButton = dialog.querySelector("[data-reelup-lightbox-close]");

    dialog.addEventListener("close", () => {
      teardownSource(video);
      productsList.replaceChildren();
      productsPanel.hidden = true;
    });

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });

    closeButton.addEventListener("click", () => dialog.close());

    productsList.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-reelup-add-to-cart]");
      if (!button || button.dataset.state === "loading") return;

      const variantId = button.dataset.variantId;
      const addLabel = button.dataset.addLabel ?? button.textContent;
      const addedLabel = button.dataset.addedLabel ?? addLabel;

      button.dataset.state = "loading";

      try {
        const response = await fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: variantId, quantity: 1 }),
        });
        if (!response.ok) throw new Error("Add to cart failed");

        document.dispatchEvent(new CustomEvent("cart:refresh"));
        button.dataset.state = "added";
        button.textContent = addedLabel;
      } catch {
        button.dataset.state = "";
        button.textContent = addLabel;
        return;
      }

      setTimeout(() => {
        button.dataset.state = "";
        button.textContent = addLabel;
      }, 2000);
    });

    return dialog;
  };

  const open = async (triggerEl) => {
    const hlsSrc = triggerEl.dataset.hlsSrc;
    if (!hlsSrc) return;

    const dialog = buildLightbox();
    const video = dialog.querySelector(".reelup-lightbox__video");
    const title = dialog.querySelector(".reelup-lightbox__title");
    const closeButton = dialog.querySelector("[data-reelup-lightbox-close]");
    const productsPanel = dialog.querySelector("[data-reelup-lightbox-products]");
    const productsHeading = dialog.querySelector("[data-reelup-lightbox-products-heading]");
    const productsList = dialog.querySelector("[data-reelup-lightbox-products-list]");

    const posterUrl = triggerEl.dataset.posterUrl;
    const reelTitle = triggerEl.dataset.title ?? "";
    const closeLabel = triggerEl.dataset.closeLabel ?? "Close";
    const shopLabel = triggerEl.dataset.shopLabel ?? "";

    title.textContent = reelTitle;
    closeButton.setAttribute("aria-label", closeLabel);
    if (posterUrl) {
      video.setAttribute("poster", posterUrl);
    } else {
      video.removeAttribute("poster");
    }

    productsList.replaceChildren();
    const template = triggerEl.querySelector("template[data-reelup-products]");
    if (template) {
      productsHeading.textContent = shopLabel;
      productsList.appendChild(template.content.cloneNode(true));
      productsPanel.hidden = false;
    } else {
      productsPanel.hidden = true;
    }

    dialog.showModal();

    try {
      if (!supportsNativeHls(video)) {
        await loadHlsJsIfNeeded();
      }
      await attachSource(video, hlsSrc);
      await video.play();
    } catch {
      // Playback failed to initialize; the lightbox stays open with the
      // poster/controls visible so the shopper can still browse products.
    }
  };

  window.ReelupLightbox = { open };
})();
```

- [ ] **Step 2: Verify**

Nothing calls `window.ReelupLightbox.open` yet (Task 4 adds the caller). Run:
```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add extensions/shoppable-video-widgets/assets/reel-lightbox.js
git commit -m "feat(storefront): add shared reel lightbox behavior (HLS, add-to-cart, open/close)"
```

---

### Task 4: Create the shared trigger click-wiring script

**Files:**
- Create: `extensions/shoppable-video-widgets/assets/reel-trigger.js`

**Interfaces:**
- Consumes: `window.ReelupLightbox.open` (Task 3).
- Consumed by: every block's `<script>` tag (Tasks 5-7), loaded alongside `reel-lightbox.js`.

- [ ] **Step 1: Create the file**

```js
(() => {
  document.querySelectorAll("[data-reelup-trigger]").forEach((trigger) => {
    trigger
      .querySelector(".reelup-trigger__button")
      ?.addEventListener("click", () => window.ReelupLightbox?.open(trigger));
  });
})();
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add extensions/shoppable-video-widgets/assets/reel-trigger.js
git commit -m "feat(storefront): add shared reel-trigger click-wiring script"
```

---

### Task 5: Rework Product page reels onto the lightbox

**Files:**
- Modify: `extensions/shoppable-video-widgets/blocks/product-page-reels.liquid`
- Modify: `extensions/shoppable-video-widgets/assets/product-page-reels.css`
- Delete: `extensions/shoppable-video-widgets/assets/product-page-reels.js`

**Interfaces:**
- Consumes: `reel-lightbox.css`, `reel-lightbox.js`, `reel-trigger.js` (Tasks 2-4).
- The block's own CSS now only lays out the horizontal-scroll row; the shared stylesheet supplies the trigger frame itself.

- [ ] **Step 1: Replace the Liquid file in full**

```liquid
{% doc %}
Renders every published, ready reel tagged to the current product as a
click-to-open trigger; clicking one opens the shared reel lightbox with
the video and any tagged products. Reads the product's tagged reels via
the app-owned metaobject reference metafield — resolved entirely by
Liquid at render time, no runtime API call.
@example
{% content_for 'block', type: 'product-page-reels', id: 'reels' %}
{% enddoc %}

{{ 'reel-lightbox.css' | asset_url | stylesheet_tag }}
{{ 'product-page-reels.css' | asset_url | stylesheet_tag }}

{% comment %}
  Not using {% render 'reel-namespace' %} + capture here: Shopify's theme
  editor preview wraps app-block-rendered snippet output in
  "<!-- BEGIN app snippet: ... --> ... <!-- END app snippet -->" comments
  for its own inspector. `strip` only trims whitespace, not those markers,
  so a captured render corrupts the namespace string into something that
  never resolves shop.metafields[...] — confirmed live via a debug dump
  of the captured value in the theme editor preview. Keep this literal in
  sync with reel-namespace.liquid (single source of truth for the string).
{% endcomment %}
{% assign reel_namespace = 'app--404281098241' %}

{% assign widget_field = shop.metafields[reel_namespace].product_page_reels_widget %}

{% assign widget_matches_product = false %}
{% if widget_field.value.published %}
  {% if widget_field.value.targetRule.type == "all_products" %}
    {% assign widget_matches_product = true %}
  {% elsif widget_field.value.targetRule.type == "handles" and widget_field.value.targetRule.handles contains product.handle %}
    {% assign widget_matches_product = true %}
  {% endif %}
{% endif %}

{% assign reels_field = shop.metafields[reel_namespace].product_page_reels_widget_reels %}

{% assign visible_count = 0 %}
{% if widget_matches_product %}
  {% for reel in reels_field.value %}
    {% if reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
      {% assign visible_count = visible_count | plus: 1 %}
    {% endif %}
  {% endfor %}
{% endif %}

{% if visible_count > 0 %}
  <div class="reelup-product-reels" {{ block.shopify_attributes }}>
    {% for reel in reels_field.value %}
      {% if reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
        <div class="reelup-product-reels__item">
          <div
            class="reelup-trigger"
            data-reelup-trigger
            data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
            data-poster-url="{{ reel.config.value.posterUrl | escape }}"
            data-title="{{ reel.title.value | escape }}"
            data-close-label="{{ 'reels.close_label' | t }}"
            data-shop-label="{{ 'reels.shop_this_video_label' | t }}"
          >
            <button
              type="button"
              class="reelup-trigger__button"
              aria-label="{{ 'reels.play_label' | t }}"
            >
              {% if reel.config.value.posterUrl != blank %}
                <img
                  class="reelup-trigger__poster"
                  src="{{ reel.config.value.posterUrl | escape }}"
                  alt="{{ reel.title.value | escape }}"
                  loading="lazy"
                  width="360"
                  height="640"
                >
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
                        <img
                          class="reelup-lightbox__product-image"
                          src="{{ product.featured_image | image_url: width: 160 }}"
                          alt="{{ product.title | escape }}"
                          loading="lazy"
                          width="56"
                          height="56"
                        >
                      {% endif %}
                      <span class="reelup-lightbox__product-info">
                        <span class="reelup-lightbox__product-title">{{ product.title }}</span>
                        <span class="reelup-lightbox__product-price">{{ product.price | money }}</span>
                      </span>
                    </a>
                    {% if variant %}
                      <button
                        type="button"
                        class="reelup-lightbox__add-to-cart"
                        data-reelup-add-to-cart
                        data-variant-id="{{ variant.id }}"
                        data-add-label="{{ 'reels.add_to_cart' | t }}"
                        data-added-label="{{ 'reels.added_to_cart' | t }}"
                      >
                        {{ 'reels.add_to_cart' | t }}
                      </button>
                    {% endif %}
                  </div>
                {% endfor %}
              </template>
            {% endif %}
          </div>
        </div>
      {% endif %}
    {% endfor %}
  </div>
  <script src="{{ 'reel-lightbox.js' | asset_url }}" defer></script>
  <script src="{{ 'reel-trigger.js' | asset_url }}" defer></script>
{% endif %}

{% schema %}
{
  "name": "Product page reels",
  "target": "section",
  "settings": [
    { "type": "product", "id": "product", "label": "Product", "autofill": true }
  ]
}
{% endschema %}
```

- [ ] **Step 2: Replace the CSS file in full**

```css
.reelup-product-reels {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-block: 12px;
}

.reelup-product-reels__item {
  flex: 0 0 auto;
  width: 220px;
}
```

- [ ] **Step 3: Delete the now-unused per-block JS**

```bash
git rm extensions/shoppable-video-widgets/assets/product-page-reels.js
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean. In the theme editor (manual, best-effort): confirm the reel row still renders at the new smaller card width, clicking a reel opens the lightbox with video + tagged products, add-to-cart works, and closing (×/ESC/backdrop) stops playback.

- [ ] **Step 5: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/product-page-reels.liquid extensions/shoppable-video-widgets/assets/product-page-reels.css
git commit -m "refactor(storefront): rework Product page reels onto the shared lightbox"
```

(The `git rm` from Step 3 stages the deletion; it's included in this commit alongside the two modified files.)

---

### Task 6: Rework Single video onto the lightbox (adds tagged products for the first time)

**Files:**
- Modify: `extensions/shoppable-video-widgets/blocks/single-video.liquid`
- Modify: `extensions/shoppable-video-widgets/assets/single-video.css`
- Delete: `extensions/shoppable-video-widgets/assets/single-video.js`

**Interfaces:**
- Consumes: `reel-lightbox.css`, `reel-lightbox.js`, `reel-trigger.js` (Tasks 2-4).
- This block previously rendered no tagged-products markup at all — this task adds the same `reel.tagged_products.value` loop the other two blocks use.

- [ ] **Step 1: Replace the Liquid file in full**

```liquid
{% doc %}
Renders the shop's SINGLE_VIDEO widget: one merchant-picked featured
reel as a click-to-open trigger. Gated on the shop-level widget
metafield (published + targetRule) exactly like product-page-reels.liquid.
Clicking the trigger opens the shared reel lightbox with the video and
any tagged products.
@example
{% content_for 'block', type: 'single-video', id: 'single-video' %}
{% enddoc %}

{{ 'reel-lightbox.css' | asset_url | stylesheet_tag }}
{{ 'single-video.css' | asset_url | stylesheet_tag }}

{% assign reel_namespace = 'app--404281098241' %}

{% assign widget_field = shop.metafields[reel_namespace].single_video_widget %}
{% assign featured_reel = shop.metafields[reel_namespace].single_video_featured_reel %}

{% assign widget_matches_product = false %}
{% if widget_field.value.published %}
  {% if widget_field.value.targetRule.type == "all_products" %}
    {% assign widget_matches_product = true %}
  {% elsif widget_field.value.targetRule.type == "handles" and widget_field.value.targetRule.handles contains product.handle %}
    {% assign widget_matches_product = true %}
  {% endif %}
{% endif %}

{% assign reel = featured_reel.value %}
{% assign show_reel = false %}
{% if widget_matches_product and reel and reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
  {% assign show_reel = true %}
{% endif %}

{% if show_reel %}
  <div class="reelup-single-video" {{ block.shopify_attributes }}>
    <div
      class="reelup-trigger"
      data-reelup-trigger
      data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
      data-poster-url="{{ reel.config.value.posterUrl | escape }}"
      data-title="{{ reel.title.value | escape }}"
      data-close-label="{{ 'reels.close_label' | t }}"
      data-shop-label="{{ 'reels.shop_this_video_label' | t }}"
    >
      <button
        type="button"
        class="reelup-trigger__button"
        aria-label="{{ 'reels.play_label' | t }}"
      >
        {% if reel.config.value.posterUrl != blank %}
          <img
            class="reelup-trigger__poster"
            src="{{ reel.config.value.posterUrl | escape }}"
            alt="{{ reel.title.value | escape }}"
            loading="lazy"
            width="480"
            height="854"
          >
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
                  <img
                    class="reelup-lightbox__product-image"
                    src="{{ product.featured_image | image_url: width: 160 }}"
                    alt="{{ product.title | escape }}"
                    loading="lazy"
                    width="56"
                    height="56"
                  >
                {% endif %}
                <span class="reelup-lightbox__product-info">
                  <span class="reelup-lightbox__product-title">{{ product.title }}</span>
                  <span class="reelup-lightbox__product-price">{{ product.price | money }}</span>
                </span>
              </a>
              {% if variant %}
                <button
                  type="button"
                  class="reelup-lightbox__add-to-cart"
                  data-reelup-add-to-cart
                  data-variant-id="{{ variant.id }}"
                  data-add-label="{{ 'reels.add_to_cart' | t }}"
                  data-added-label="{{ 'reels.added_to_cart' | t }}"
                >
                  {{ 'reels.add_to_cart' | t }}
                </button>
              {% endif %}
            </div>
          {% endfor %}
        </template>
      {% endif %}
    </div>
  </div>
  <script src="{{ 'reel-lightbox.js' | asset_url }}" defer></script>
  <script src="{{ 'reel-trigger.js' | asset_url }}" defer></script>
{% endif %}

{% schema %}
{
  "name": "Single video",
  "target": "section",
  "settings": [
    { "type": "product", "id": "product", "label": "Product", "autofill": true }
  ]
}
{% endschema %}
```

- [ ] **Step 2: Replace the CSS file in full**

```css
.reelup-single-video {
  width: 100%;
  max-width: 320px;
}
```

- [ ] **Step 3: Delete the now-unused per-block JS**

```bash
git rm extensions/shoppable-video-widgets/assets/single-video.js
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean. In the theme editor (manual, best-effort): confirm the single featured reel still renders, clicking it opens the lightbox, and — new behavior — if that reel has tagged products they now appear with working add-to-cart (previously this block showed no products at all).

- [ ] **Step 5: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/single-video.liquid extensions/shoppable-video-widgets/assets/single-video.css
git commit -m "refactor(storefront): rework Single video onto the shared lightbox, add tagged products"
```

---

### Task 7: Rework Stacked carousel onto the lightbox (adds tagged products for the first time)

**Files:**
- Modify: `extensions/shoppable-video-widgets/blocks/stacked-carousel.liquid`
- Modify: `extensions/shoppable-video-widgets/assets/stacked-carousel.css`
- Delete: `extensions/shoppable-video-widgets/assets/stacked-carousel.js`

**Interfaces:**
- Consumes: `reel-lightbox.css`, `reel-lightbox.js`, `reel-trigger.js` (Tasks 2-4).
- This is the block the original bug report was about — it previously rendered no tagged-products markup at all.

- [ ] **Step 1: Replace the Liquid file in full**

```liquid
{% doc %}
Renders the widget's curated reels as a responsive grid of click-to-open
triggers (CAROUSEL widget kind). Same widget-gating pattern as
product-page-reels.liquid. Clicking a card opens the shared reel
lightbox with the video and any tagged products.
@example
{% content_for 'block', type: 'stacked-carousel', id: 'stacked-carousel' %}
{% enddoc %}

{{ 'reel-lightbox.css' | asset_url | stylesheet_tag }}
{{ 'stacked-carousel.css' | asset_url | stylesheet_tag }}

{% assign reel_namespace = 'app--404281098241' %}

{% assign widget_field = shop.metafields[reel_namespace].stacked_carousel_widget %}
{% assign widget_matches_product = false %}
{% if widget_field.value.published %}
  {% if widget_field.value.targetRule.type == "all_products" %}
    {% assign widget_matches_product = true %}
  {% elsif widget_field.value.targetRule.type == "handles" and widget_field.value.targetRule.handles contains product.handle %}
    {% assign widget_matches_product = true %}
  {% endif %}
{% endif %}

{% assign reels_field = shop.metafields[reel_namespace].stacked_carousel_widget_reels %}

{% assign visible_count = 0 %}
{% if widget_matches_product %}
  {% for reel in reels_field.value %}
    {% if reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
      {% assign visible_count = visible_count | plus: 1 %}
    {% endif %}
  {% endfor %}
{% endif %}

{% if visible_count > 0 %}
  <div class="reelup-carousel" {{ block.shopify_attributes }}>
    {% for reel in reels_field.value %}
      {% if reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
        <div
          class="reelup-trigger"
          data-reelup-trigger
          data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
          data-poster-url="{{ reel.config.value.posterUrl | escape }}"
          data-title="{{ reel.title.value | escape }}"
          data-close-label="{{ 'reels.close_label' | t }}"
          data-shop-label="{{ 'reels.shop_this_video_label' | t }}"
        >
          <button
            type="button"
            class="reelup-trigger__button"
            aria-label="{{ 'reels.play_label' | t }}"
          >
            {% if reel.config.value.posterUrl != blank %}
              <img
                class="reelup-trigger__poster"
                src="{{ reel.config.value.posterUrl | escape }}"
                alt="{{ reel.title.value | escape }}"
                loading="lazy"
                width="360"
                height="640"
              >
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
                      <img
                        class="reelup-lightbox__product-image"
                        src="{{ product.featured_image | image_url: width: 160 }}"
                        alt="{{ product.title | escape }}"
                        loading="lazy"
                        width="56"
                        height="56"
                      >
                    {% endif %}
                    <span class="reelup-lightbox__product-info">
                      <span class="reelup-lightbox__product-title">{{ product.title }}</span>
                      <span class="reelup-lightbox__product-price">{{ product.price | money }}</span>
                    </span>
                  </a>
                  {% if variant %}
                    <button
                      type="button"
                      class="reelup-lightbox__add-to-cart"
                      data-reelup-add-to-cart
                      data-variant-id="{{ variant.id }}"
                      data-add-label="{{ 'reels.add_to_cart' | t }}"
                      data-added-label="{{ 'reels.added_to_cart' | t }}"
                    >
                      {{ 'reels.add_to_cart' | t }}
                    </button>
                  {% endif %}
                </div>
              {% endfor %}
            </template>
          {% endif %}
        </div>
      {% endif %}
    {% endfor %}
  </div>
  <script src="{{ 'reel-lightbox.js' | asset_url }}" defer></script>
  <script src="{{ 'reel-trigger.js' | asset_url }}" defer></script>
{% endif %}

{% schema %}
{
  "name": "Stacked carousel",
  "target": "section",
  "settings": [
    { "type": "product", "id": "product", "label": "Product", "autofill": true }
  ]
}
{% endschema %}
```

- [ ] **Step 2: Replace the CSS file in full**

```css
.reelup-carousel {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

@media (max-width: 900px) {
  .reelup-carousel {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 600px) {
  .reelup-carousel {
    grid-template-columns: repeat(2, 1fr);
  }
}
```

- [ ] **Step 3: Delete the now-unused per-block JS**

```bash
git rm extensions/shoppable-video-widgets/assets/stacked-carousel.js
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean. In the theme editor (manual, best-effort): confirm the 4/3/2-column responsive grid still renders, clicking any card opens the lightbox, and — this was the original bug report — tagged products now appear with working add-to-cart.

- [ ] **Step 5: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/stacked-carousel.liquid extensions/shoppable-video-widgets/assets/stacked-carousel.css
git commit -m "refactor(storefront): rework Stacked carousel onto the shared lightbox, add tagged products"
```

---

### Task 8: Whole-branch verification

**Files:** none (verification-only task).

**Interfaces:** none.

- [ ] **Step 1: Confirm the three old per-block JS files are gone**

```bash
ls extensions/shoppable-video-widgets/assets/product-page-reels.js extensions/shoppable-video-widgets/assets/single-video.js extensions/shoppable-video-widgets/assets/stacked-carousel.js
```
Expected: `No such file or directory` for all three (they were `git rm`'d in Tasks 5-7).

- [ ] **Step 2: Confirm every block loads the two shared scripts and no block references a deleted per-block JS file**

```bash
grep -rn "asset_url" extensions/shoppable-video-widgets/blocks/*.liquid
```
Expected: each of the three blocks' `<script>` lines reference `reel-lightbox.js` and `reel-trigger.js` only — no line references `product-page-reels.js`, `single-video.js`, or `stacked-carousel.js` as a script source (their `.css` counterparts are still expected and correct).

- [ ] **Step 3: Full project checks**

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```
Expected: all four clean (this extension has no build step of its own, so these checks confirm the admin app — the only part of this repo with a build — wasn't accidentally affected).

- [ ] **Step 4: Manual theme-editor walkthrough**

For each of the three blocks, in a live theme editor / dev store preview: confirm the block renders (row/single/grid layout intact), clicking any reel opens the lightbox with the video playing, tagged products (when present) show in the panel with working add-to-cart that updates the cart count, and closing via ×, ESC, and backdrop-click all correctly stop playback. Specifically re-check Stacked carousel, since making its tagged products visible was the original request.

- [ ] **Step 5: Commit (only if Steps 1-3 required a fix)**

If nothing needed fixing, skip committing — this task is verification-only.
