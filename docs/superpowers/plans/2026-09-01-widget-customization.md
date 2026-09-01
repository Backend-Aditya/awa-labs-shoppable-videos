# Widget Appearance & Behavior Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let merchants customize colors, corner style, sizing, add-to-cart labeling, price/title visibility, mute/loop defaults, story timing, reel-pop position, and an optional heading — natively in the Shopify Theme Editor, for all 5 storefront blocks — with zero change to any unconfigured block's current appearance.

**Architecture:** Trigger-level looks (corner radius, accent color, size) are plain CSS custom properties set inline on each block's own wrapper, consumed by the existing shared stylesheets via `var(--x, <current-hardcoded-value>)` fallbacks — no JS involved. Viewer-level looks (add-to-cart color/label, price/title visibility, mute/loop) can't use CSS inheritance because the lightbox/story dialog is appended to `document.body`, not nested inside any block's wrapper — so those settings travel as `data-*` attributes on the trigger element (the same mechanism already carrying `data-hls-src`/`data-poster-url`) and get applied by a small new shared JS helper at dialog-open time.

**Tech Stack:** Plain Liquid/CSS/JS, no build step — same as the rest of this extension.

**Spec:** `docs/superpowers/specs/2026-09-01-widget-customization-design.md`

## Global Constraints

- Every setting's default must reproduce today's hardcoded look and behavior exactly — an unconfigured block renders byte-for-byte the same as before this plan. Verified per-task and again in the final whole-project task.
- No admin-app (`app/`) changes, no Prisma changes, no `shopify.app.toml` change — this plan only touches `extensions/shoppable-video-widgets/**`.
- `autoplay_mode` (hover-preview) is explicitly OUT of scope for this plan (see spec) — do not add it to any schema.
- The reel-pop pulse animation keeps its fixed white glow — `accent_color` does not touch it (see spec).
- No automated test suite covers this extension (confirmed: `package.json`'s `vitest` config only covers `app/`). Run `npm run typecheck`, `npm run lint`, and `npm run test` after every task as the sanity gate that nothing in the admin app was accidentally touched — same convention as the prior three storefront plans.
- Every reel/product poster `<img>` keeps its existing `loading="lazy"` and explicit `width`/`height` — none of this plan's edits touch those attributes.

---

### Task 1: Add CSS variable support to `reel-lightbox.css`

**Files:**
- Modify: `extensions/shoppable-video-widgets/assets/reel-lightbox.css`

**Interfaces:**
- Produces: `--reelup-corner-radius` (trigger button radius, fallback `12px`), `--reelup-accent-color`/`--reelup-accent-hover-color` (play-icon backdrop, fallback `rgba(0, 0, 0, 0.55)`/`rgba(0, 0, 0, 0.75)`), `--reelup-cta-color`/`--reelup-cta-text-color`/`--reelup-cta-hover-color` (add-to-cart button, fallback `#111`/`#fff`/`#2b2b2b`) — all consumed later by block wrappers (trigger vars, Tasks 7–11) and the dialog (cta vars, set by Task 5's JS via Task 4's helper). Also produces `.reelup-widget-heading` (new shared class for the optional heading, Tasks 7/8/10).

- [ ] **Step 1: Replace the trigger button, play-icon, and add-to-cart rules**

Find this block:
```css
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
  transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.2s ease;
}
```
Replace only the `border-radius` line:
```css
  border-radius: var(--reelup-corner-radius, 12px);
```

Find:
```css
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
```
Replace the `background` line:
```css
  background: var(--reelup-accent-color, rgba(0, 0, 0, 0.55));
```

Find:
```css
.reelup-trigger__button:hover .reelup-trigger__play-icon,
.reelup-trigger__button:focus-visible .reelup-trigger__play-icon {
  background: rgba(0, 0, 0, 0.75);
}
```
Replace the `background` line:
```css
  background: var(--reelup-accent-hover-color, rgba(0, 0, 0, 0.75));
```

Find:
```css
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
  transition: background 0.15s ease, transform 0.15s ease;
}
```
Replace the `background`/`color` lines:
```css
  background: var(--reelup-cta-color, #111);
  color: var(--reelup-cta-text-color, #fff);
```

Find:
```css
.reelup-lightbox__add-to-cart:hover,
.reelup-lightbox__add-to-cart:focus-visible {
  background: #2b2b2b;
}
```
Replace the `background` line:
```css
  background: var(--reelup-cta-hover-color, #2b2b2b);
```

Leave `[data-state="added"] { background: #1f9d55; }` untouched — the success state is semantic, not brand-colorable.

- [ ] **Step 2: Add the shared heading class**

Append to the end of the file:
```css
.reelup-widget-heading {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
}
```

- [ ] **Step 3: Verify no visual change with no settings applied**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean. (No block emits any of these CSS vars yet, so every `var(--x, <fallback>)` resolves to its fallback — visually identical to before this task.)

- [ ] **Step 4: Commit**

```bash
git add extensions/shoppable-video-widgets/assets/reel-lightbox.css
git commit -m "feat(storefront): add CSS var hooks for trigger/CTA customization"
```

---

### Task 2: Add CSS variable support to `reel-story.css`

**Files:**
- Modify: `extensions/shoppable-video-widgets/assets/reel-story.css`

**Interfaces:**
- Consumes: `--reelup-accent-color` (produced by Task 1's convention, same var name reused here for the story ring), `--reelup-corner-radius` and `--reelup-trigger-size` are NOT consumed here — the avatar's `border-radius: 50%` and fixed `width`/`height: 64px` in `.reelup-stories .reelup-trigger__button` stay as literal overrides for radius (circular, not customizable) but the size becomes a var (see Step 1).

- [ ] **Step 1: Make the avatar ring color and size variable-driven**

Find:
```css
.reelup-stories .reelup-trigger__button {
  width: 64px;
  height: 64px;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  border: 2px solid #e1306c;
  padding: 2px;
  background: #fff;
}
```
Replace with:
```css
.reelup-stories .reelup-trigger__button {
  width: var(--reelup-trigger-size, 64px);
  height: var(--reelup-trigger-size, 64px);
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  border: 2px solid var(--reelup-accent-color, #e1306c);
  padding: 2px;
  background: #fff;
}
```

Also update the item width so the label column stays proportional when the avatar grows/shrinks. Find:
```css
.reelup-stories__item {
  flex: 0 0 auto;
  width: 72px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  scroll-snap-align: start;
}
```
Replace `width: 72px;` with:
```css
  width: calc(var(--reelup-trigger-size, 64px) + 8px);
```

And the label's `max-width` should track it too. Find:
```css
.reelup-stories__label {
  font-size: 12px;
  color: #333;
  max-width: 72px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```
Replace `max-width: 72px;` with:
```css
  max-width: calc(var(--reelup-trigger-size, 64px) + 8px);
```

- [ ] **Step 2: Verify no visual change with no settings applied**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean; every var resolves to its stated fallback (`64px`/`#e1306c`), identical to before.

- [ ] **Step 3: Commit**

```bash
git add extensions/shoppable-video-widgets/assets/reel-story.css
git commit -m "feat(storefront): add CSS var hooks for story avatar ring color and size"
```

---

### Task 3: Add position variants and size variable to `reel-pop.css`

**Files:**
- Modify: `extensions/shoppable-video-widgets/assets/reel-pop.css`

**Interfaces:**
- Produces: `.reelup-pop--bottom-right`/`.reelup-pop--bottom-left`/`.reelup-pop--top-right`/`.reelup-pop--top-left` (position modifiers) and `.reelup-pop--no-pulse` (disables the arrival pulse) — consumed by `reel-pops.liquid` (Task 11).
- Consumes: `--reelup-trigger-size` (bubble diameter, fallback `72px`).

- [ ] **Step 1: Replace the fixed position with modifier classes**

Find:
```css
.reelup-pop {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 900;
}
```
Replace with:
```css
.reelup-pop {
  position: fixed;
  z-index: 900;
}

.reelup-pop--bottom-right {
  right: 20px;
  bottom: 20px;
}

.reelup-pop--bottom-left {
  left: 20px;
  bottom: 20px;
}

.reelup-pop--top-right {
  right: 20px;
  top: 20px;
}

.reelup-pop--top-left {
  left: 20px;
  top: 20px;
}
```

- [ ] **Step 2: Make the bubble size variable-driven and add the no-pulse modifier**

Find:
```css
.reelup-pop .reelup-trigger__button {
  width: 72px;
  height: 72px;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  border: 3px solid #fff;
  box-sizing: border-box;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  animation: reelup-pop-in 0.3s ease-out, reelup-pop-pulse 2s ease-in-out 0.5s 2;
}
```
Replace with:
```css
.reelup-pop .reelup-trigger__button {
  width: var(--reelup-trigger-size, 72px);
  height: var(--reelup-trigger-size, 72px);
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  border: 3px solid #fff;
  box-sizing: border-box;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  animation: reelup-pop-in 0.3s ease-out, reelup-pop-pulse 2s ease-in-out 0.5s 2;
}

.reelup-pop--no-pulse .reelup-trigger__button {
  animation: reelup-pop-in 0.3s ease-out;
}
```

- [ ] **Step 3: Verify**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean. Nothing references the new classes yet, and the var resolves to its `72px` fallback — no visual change.

- [ ] **Step 4: Commit**

```bash
git add extensions/shoppable-video-widgets/assets/reel-pop.css
git commit -m "feat(storefront): add reel-pop position variants, no-pulse modifier, size var"
```

---

### Task 4: Create the shared `reel-viewer-settings.js` helper

**Files:**
- Create: `extensions/shoppable-video-widgets/assets/reel-viewer-settings.js`

**Interfaces:**
- Produces: `window.ReelupViewerSettings.applyDialogSettings(dialog, video, titleEl, triggerEl)` and `window.ReelupViewerSettings.applyProductListSettings(listEl, triggerEl)` — consumed by `reel-lightbox.js` (Task 5) and `reel-story.js` (Task 6).
- Consumes: `triggerEl.dataset.ctaColor`/`ctaTextColor`/`ctaHoverColor`/`ctaLabel`/`showPrice`/`showTitle`/`mutedDefault`/`loop` — all produced by the per-block Liquid changes in Tasks 7–11.

Both the lightbox's products panel and the story's product drawer render the exact same markup classes (`.reelup-lightbox__products-heading`, `.reelup-lightbox__products-list`, `.reelup-lightbox__product-price`, `[data-reelup-add-to-cart]` — confirmed by reading both files: `reel-story.js`'s `buildViewer()` reuses these identical class names for its drawer), so one shared helper serves both viewers without duplicating this logic twice.

- [ ] **Step 1: Create the file**

```js
(() => {
  const applyDialogSettings = (dialog, video, titleEl, triggerEl) => {
    const cssVars = {
      "--reelup-cta-color": triggerEl.dataset.ctaColor,
      "--reelup-cta-text-color": triggerEl.dataset.ctaTextColor,
      "--reelup-cta-hover-color": triggerEl.dataset.ctaHoverColor,
    };

    for (const [name, value] of Object.entries(cssVars)) {
      // The dialog is a shared singleton reused across every open() call —
      // a value left over from a PREVIOUS trigger's custom color must be
      // explicitly cleared here, not just conditionally set, or it leaks
      // onto the next trigger that has no color configured at all.
      if (value) dialog.style.setProperty(name, value);
      else dialog.style.removeProperty(name);
    }

    video.muted = triggerEl.dataset.mutedDefault === "true";
    video.loop = triggerEl.dataset.loop === "true";
    titleEl.hidden = triggerEl.dataset.showTitle === "false";
  };

  const applyProductListSettings = (listEl, triggerEl) => {
    const hidePrice = triggerEl.dataset.showPrice === "false";
    listEl.querySelectorAll(".reelup-lightbox__product-price").forEach((priceEl) => {
      priceEl.hidden = hidePrice;
    });

    const ctaLabel = triggerEl.dataset.ctaLabel;
    if (ctaLabel) {
      listEl.querySelectorAll("[data-reelup-add-to-cart]").forEach((button) => {
        button.dataset.addLabel = ctaLabel;
        button.textContent = ctaLabel;
      });
    }
  };

  window.ReelupViewerSettings = { applyDialogSettings, applyProductListSettings };
})();
```

- [ ] **Step 2: Verify**

Nothing calls this yet.
```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add extensions/shoppable-video-widgets/assets/reel-viewer-settings.js
git commit -m "feat(storefront): add shared viewer-settings helper for lightbox/story dialogs"
```

---

### Task 5: Wire `reel-lightbox.js` to apply viewer settings on open

**Files:**
- Modify: `extensions/shoppable-video-widgets/assets/reel-lightbox.js`

**Interfaces:**
- Consumes: `window.ReelupViewerSettings` (Task 4).

- [ ] **Step 1: Call the helper inside `open()`**

Find:
```js
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
```
Replace with:
```js
    title.textContent = reelTitle;
    closeButton.setAttribute("aria-label", closeLabel);
    if (posterUrl) {
      video.setAttribute("poster", posterUrl);
    } else {
      video.removeAttribute("poster");
    }

    window.ReelupViewerSettings?.applyDialogSettings(dialog, video, title, triggerEl);

    productsList.replaceChildren();
    const template = triggerEl.querySelector("template[data-reelup-products]");
    if (template) {
      productsHeading.textContent = shopLabel;
      productsList.appendChild(template.content.cloneNode(true));
      productsPanel.hidden = false;
      window.ReelupViewerSettings?.applyProductListSettings(productsList, triggerEl);
    } else {
      productsPanel.hidden = true;
    }
```

- [ ] **Step 2: Verify**

`triggerEl.dataset.ctaColor` etc. are all `undefined` until Tasks 7–11 add them to the Liquid blocks, so `applyDialogSettings`/`applyProductListSettings` run as pure no-ops (every `dialog.style.removeProperty` call, `video.muted = false`, `titleEl.hidden = false`) — no visual change yet.
```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add extensions/shoppable-video-widgets/assets/reel-lightbox.js
git commit -m "feat(storefront): apply viewer settings when the lightbox opens"
```

---

### Task 6: Wire `reel-story.js` to apply viewer settings and configurable duration

**Files:**
- Modify: `extensions/shoppable-video-widgets/assets/reel-story.js`

**Interfaces:**
- Consumes: `window.ReelupViewerSettings` (Task 4), `trigger.dataset.storyDuration` (produced by Task 10).
- Produces: module-level `currentDurationMs` replacing the old fixed `DURATION_MS` constant — internal to this file only, no other file references `DURATION_MS`.

- [ ] **Step 1: Replace the fixed duration constant with a mutable one**

Find:
```js
  const DURATION_MS = 15000;
```
Replace with:
```js
  let currentDurationMs = 15000;
```

- [ ] **Step 2: Replace every `DURATION_MS` reference with `currentDurationMs`**

There are 4 usages. In `setSegmentState`:
```js
    } else if (state === "active") {
      fill.style.transition = "none";
      fill.style.width = "0%";
      // Force a reflow so the transition below animates from 0% instead
      // of the two inline-style writes batching into one recalculation
      // and jumping straight to 100%.
      void fill.offsetWidth;
      fill.style.transition = `width ${currentDurationMs}ms linear`;
      fill.style.width = "100%";
```

In `freezeActiveSegment`:
```js
    return Math.max(currentDurationMs * (1 - percent), 0);
```

In `closeDrawer`:
```js
    const remaining = pausedRemainingMs ?? currentDurationMs;
```

In `scheduleAdvance`:
```js
  const scheduleAdvance = (dialog) => {
    clearTimer();
    timer = setTimeout(() => requestAdvance(dialog), currentDurationMs);
  };
```

- [ ] **Step 3: Read the per-reel duration and apply viewer settings in `goTo()`**

Find:
```js
    currentIndex = index;
    const trigger = reels[index];
    
    const reelId = trigger.dataset.reelId;
    dialog.dataset.currentReelId = reelId;
    if (reelId) trackAnalytics(reelId, "view");
```
Replace with:
```js
    currentIndex = index;
    const trigger = reels[index];

    currentDurationMs = parseInt(trigger.dataset.storyDuration, 10) || 15000;

    const reelId = trigger.dataset.reelId;
    dialog.dataset.currentReelId = reelId;
    if (reelId) trackAnalytics(reelId, "view");
```

Find:
```js
    title.textContent = trigger.dataset.title ?? "";
    closeButton.setAttribute("aria-label", trigger.dataset.closeLabel ?? "Close");
    const posterUrl = trigger.dataset.posterUrl;
    if (posterUrl) {
      video.setAttribute("poster", posterUrl);
    } else {
      video.removeAttribute("poster");
    }

    drawerList.replaceChildren();
    const template = trigger.querySelector("template[data-reelup-products]");
    if (template) {
      const shopLabel = trigger.dataset.shopLabel ?? "";
      drawerHeading.textContent = shopLabel;
      drawerList.appendChild(template.content.cloneNode(true));
      shopButton.hidden = false;
      shopButton.textContent = shopLabel;
    } else {
      shopButton.hidden = true;
    }
```
Replace with:
```js
    title.textContent = trigger.dataset.title ?? "";
    closeButton.setAttribute("aria-label", trigger.dataset.closeLabel ?? "Close");
    const posterUrl = trigger.dataset.posterUrl;
    if (posterUrl) {
      video.setAttribute("poster", posterUrl);
    } else {
      video.removeAttribute("poster");
    }

    window.ReelupViewerSettings?.applyDialogSettings(dialog, video, title, trigger);

    drawerList.replaceChildren();
    const template = trigger.querySelector("template[data-reelup-products]");
    if (template) {
      const shopLabel = trigger.dataset.shopLabel ?? "";
      drawerHeading.textContent = shopLabel;
      drawerList.appendChild(template.content.cloneNode(true));
      shopButton.hidden = false;
      shopButton.textContent = shopLabel;
      window.ReelupViewerSettings?.applyProductListSettings(drawerList, trigger);
    } else {
      shopButton.hidden = true;
    }
```

- [ ] **Step 4: Verify**

`trigger.dataset.storyDuration` is `undefined` until Task 10, so `parseInt(undefined, 10)` is `NaN`, and `NaN || 15000` evaluates to `15000` — identical to the old hardcoded constant. All other new dataset reads are likewise `undefined` until Tasks 7–11, so `applyDialogSettings`/`applyProductListSettings` are no-ops.
```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add extensions/shoppable-video-widgets/assets/reel-story.js
git commit -m "feat(storefront): apply viewer settings and configurable duration in story viewer"
```

---

### Task 7: Add settings to `product-page-reels.liquid`

**Files:**
- Modify: `extensions/shoppable-video-widgets/blocks/product-page-reels.liquid`

**Interfaces:**
- Produces the wrapper's inline CSS vars and every trigger's new `data-*` attributes — no other file depends on this one; it's a leaf.

- [ ] **Step 1: Add the schema settings**

Find the `{% schema %}` block:
```liquid
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
Replace with:
```liquid
{% schema %}
{
  "name": "Product page reels",
  "target": "section",
  "settings": [
    { "type": "product", "id": "product", "label": "Product", "autofill": true },
    { "type": "text", "id": "heading", "label": "Heading", "info": "Leave blank to hide" },
    {
      "type": "select",
      "id": "corner_style",
      "label": "Corner style",
      "options": [
        { "value": "sharp", "label": "Sharp" },
        { "value": "rounded", "label": "Rounded" },
        { "value": "soft", "label": "Soft" }
      ],
      "default": "rounded"
    },
    { "type": "color", "id": "accent_color", "label": "Accent color", "info": "Leave blank to use the theme default" },
    { "type": "range", "id": "trigger_size", "label": "Thumbnail width", "min": 120, "max": 320, "step": 10, "unit": "px", "default": 220 },
    { "type": "color", "id": "cta_color", "label": "Add to cart button color", "info": "Leave blank to use the theme default" },
    { "type": "color", "id": "cta_text_color", "label": "Add to cart text color", "default": "#ffffff" },
    { "type": "text", "id": "cta_label", "label": "Add to cart button text", "info": "Leave blank to use the default label" },
    { "type": "checkbox", "id": "show_price", "label": "Show product price", "default": true },
    { "type": "checkbox", "id": "show_title_overlay", "label": "Show video title", "default": true },
    { "type": "checkbox", "id": "muted_default", "label": "Mute video by default", "default": false },
    { "type": "checkbox", "id": "loop", "label": "Loop video", "default": false }
  ]
}
{% endschema %}
```

- [ ] **Step 2: Compute the CSS var style string and data-attribute values**

Find:
```liquid
{% assign reel_namespace = 'app--404281098241' %}
```
Replace with:
```liquid
{% assign reel_namespace = 'app--404281098241' %}

{% case block.settings.corner_style %}
  {% when 'sharp' %}
    {% assign corner_radius_px = '0px' %}
  {% when 'soft' %}
    {% assign corner_radius_px = '20px' %}
  {% else %}
    {% assign corner_radius_px = '12px' %}
{% endcase %}

{% capture wrapper_style %}
  --reelup-corner-radius: {{ corner_radius_px }};
  --reelup-trigger-size: {{ block.settings.trigger_size }}px;
  {% unless block.settings.accent_color == blank %}
    --reelup-accent-color: {{ block.settings.accent_color }};
    --reelup-accent-hover-color: {{ block.settings.accent_color | color_darken: 15 }};
  {% endunless %}
{% endcapture %}

{% capture cta_hover_color %}
  {% unless block.settings.cta_color == blank %}{{ block.settings.cta_color | color_lighten: 15 }}{% endunless %}
{% endcapture %}
```

- [ ] **Step 3: Render the optional heading and apply the wrapper style/data attributes**

Find:
```liquid
{% if visible_count > 0 %}
  <div class="reelup-product-reels" data-reelup-story-group {{ block.shopify_attributes }}>
```
Replace with:
```liquid
{% if visible_count > 0 %}
  {% unless block.settings.heading == blank %}
    <h2 class="reelup-widget-heading">{{ block.settings.heading }}</h2>
  {% endunless %}
  <div class="reelup-product-reels" data-reelup-story-group style="{{ wrapper_style | strip_newlines | strip }}" {{ block.shopify_attributes }}>
```

Find the trigger's attribute list:
```liquid
          <div
            class="reelup-trigger"
            data-reelup-trigger
            data-reel-id="{{ reel.system.id }}"
            data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
            data-poster-url="{{ reel.config.value.posterUrl | escape }}"
            data-title="{{ reel.title.value | escape }}"
            data-close-label="{{ 'reels.close_label' | t }}"
            data-shop-label="{{ 'reels.shop_this_video_label' | t }}"
          >
```
Replace with:
```liquid
          <div
            class="reelup-trigger"
            data-reelup-trigger
            data-reel-id="{{ reel.system.id }}"
            data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
            data-poster-url="{{ reel.config.value.posterUrl | escape }}"
            data-title="{{ reel.title.value | escape }}"
            data-close-label="{{ 'reels.close_label' | t }}"
            data-shop-label="{{ 'reels.shop_this_video_label' | t }}"
            data-cta-color="{{ block.settings.cta_color }}"
            data-cta-text-color="{{ block.settings.cta_text_color }}"
            data-cta-hover-color="{{ cta_hover_color | strip }}"
            data-cta-label="{{ block.settings.cta_label | escape }}"
            data-show-price="{{ block.settings.show_price }}"
            data-show-title="{{ block.settings.show_title_overlay }}"
            data-muted-default="{{ block.settings.muted_default }}"
            data-loop="{{ block.settings.loop }}"
          >
```

- [ ] **Step 4: Verify defaults reproduce current behavior**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean. With every setting at its schema default, `wrapper_style` renders `--reelup-corner-radius: 12px; --reelup-trigger-size: 220px;` (accent block skipped, blank) — identical to the old hardcoded `12px`/`220px`. `data-cta-color`/`data-cta-hover-color`/`data-cta-label` render empty strings (JS treats falsy as "use fallback"). `data-cta-text-color="#ffffff"`, `data-show-price="true"`, `data-show-title="true"`, `data-muted-default="false"`, `data-loop="false"` — all match current behavior exactly.

- [ ] **Step 5: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/product-page-reels.liquid
git commit -m "feat(storefront): add customization settings to Product page reels"
```

---

### Task 8: Add settings to `stacked-carousel.liquid`

**Files:**
- Modify: `extensions/shoppable-video-widgets/blocks/stacked-carousel.liquid`

**Interfaces:** Same shape as Task 7, minus `trigger_size` (this block's items size via its responsive CSS grid, not a fixed width — see spec).

- [ ] **Step 1: Add the schema settings**

Find:
```liquid
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
Replace with:
```liquid
{% schema %}
{
  "name": "Stacked carousel",
  "target": "section",
  "settings": [
    { "type": "product", "id": "product", "label": "Product", "autofill": true },
    { "type": "text", "id": "heading", "label": "Heading", "info": "Leave blank to hide" },
    {
      "type": "select",
      "id": "corner_style",
      "label": "Corner style",
      "options": [
        { "value": "sharp", "label": "Sharp" },
        { "value": "rounded", "label": "Rounded" },
        { "value": "soft", "label": "Soft" }
      ],
      "default": "rounded"
    },
    { "type": "color", "id": "accent_color", "label": "Accent color", "info": "Leave blank to use the theme default" },
    { "type": "color", "id": "cta_color", "label": "Add to cart button color", "info": "Leave blank to use the theme default" },
    { "type": "color", "id": "cta_text_color", "label": "Add to cart text color", "default": "#ffffff" },
    { "type": "text", "id": "cta_label", "label": "Add to cart button text", "info": "Leave blank to use the default label" },
    { "type": "checkbox", "id": "show_price", "label": "Show product price", "default": true },
    { "type": "checkbox", "id": "show_title_overlay", "label": "Show video title", "default": true },
    { "type": "checkbox", "id": "muted_default", "label": "Mute video by default", "default": false },
    { "type": "checkbox", "id": "loop", "label": "Loop video", "default": false }
  ]
}
{% endschema %}
```

- [ ] **Step 2: Compute the CSS var style string and data-attribute values**

Find:
```liquid
{% assign reel_namespace = 'app--404281098241' %}
```
Replace with:
```liquid
{% assign reel_namespace = 'app--404281098241' %}

{% case block.settings.corner_style %}
  {% when 'sharp' %}
    {% assign corner_radius_px = '0px' %}
  {% when 'soft' %}
    {% assign corner_radius_px = '20px' %}
  {% else %}
    {% assign corner_radius_px = '12px' %}
{% endcase %}

{% capture wrapper_style %}
  --reelup-corner-radius: {{ corner_radius_px }};
  {% unless block.settings.accent_color == blank %}
    --reelup-accent-color: {{ block.settings.accent_color }};
    --reelup-accent-hover-color: {{ block.settings.accent_color | color_darken: 15 }};
  {% endunless %}
{% endcapture %}

{% capture cta_hover_color %}
  {% unless block.settings.cta_color == blank %}{{ block.settings.cta_color | color_lighten: 15 }}{% endunless %}
{% endcapture %}
```

- [ ] **Step 3: Render the optional heading and apply the wrapper style/data attributes**

Find:
```liquid
{% if visible_count > 0 %}
  <div class="reelup-carousel" data-reelup-story-group {{ block.shopify_attributes }}>
```
Replace with:
```liquid
{% if visible_count > 0 %}
  {% unless block.settings.heading == blank %}
    <h2 class="reelup-widget-heading">{{ block.settings.heading }}</h2>
  {% endunless %}
  <div class="reelup-carousel" data-reelup-story-group style="{{ wrapper_style | strip_newlines | strip }}" {{ block.shopify_attributes }}>
```

Find the trigger's attribute list:
```liquid
        <div
          class="reelup-trigger"
          data-reelup-trigger
          data-reel-id="{{ reel.system.id }}"
          data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
          data-poster-url="{{ reel.config.value.posterUrl | escape }}"
          data-title="{{ reel.title.value | escape }}"
          data-close-label="{{ 'reels.close_label' | t }}"
          data-shop-label="{{ 'reels.shop_this_video_label' | t }}"
        >
```
Replace with:
```liquid
        <div
          class="reelup-trigger"
          data-reelup-trigger
          data-reel-id="{{ reel.system.id }}"
          data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
          data-poster-url="{{ reel.config.value.posterUrl | escape }}"
          data-title="{{ reel.title.value | escape }}"
          data-close-label="{{ 'reels.close_label' | t }}"
          data-shop-label="{{ 'reels.shop_this_video_label' | t }}"
          data-cta-color="{{ block.settings.cta_color }}"
          data-cta-text-color="{{ block.settings.cta_text_color }}"
          data-cta-hover-color="{{ cta_hover_color | strip }}"
          data-cta-label="{{ block.settings.cta_label | escape }}"
          data-show-price="{{ block.settings.show_price }}"
          data-show-title="{{ block.settings.show_title_overlay }}"
          data-muted-default="{{ block.settings.muted_default }}"
          data-loop="{{ block.settings.loop }}"
        >
```

- [ ] **Step 4: Verify defaults reproduce current behavior**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean, same reasoning as Task 7 Step 4 (minus `trigger_size`, which this block doesn't use).

- [ ] **Step 5: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/stacked-carousel.liquid
git commit -m "feat(storefront): add customization settings to Stacked carousel"
```

---

### Task 9: Add settings to `single-video.liquid`

**Files:**
- Modify: `extensions/shoppable-video-widgets/blocks/single-video.liquid`

**Interfaces:** Same viewer/trigger settings shape as Task 7, but `video_max_width` replaces `trigger_size` (this is a single centered item, not a row — see spec), and there's no `heading` setting (spec scopes heading to the three row/grid blocks only).

- [ ] **Step 1: Add the schema settings**

Find:
```liquid
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
Replace with:
```liquid
{% schema %}
{
  "name": "Single video",
  "target": "section",
  "settings": [
    { "type": "product", "id": "product", "label": "Product", "autofill": true },
    {
      "type": "select",
      "id": "corner_style",
      "label": "Corner style",
      "options": [
        { "value": "sharp", "label": "Sharp" },
        { "value": "rounded", "label": "Rounded" },
        { "value": "soft", "label": "Soft" }
      ],
      "default": "rounded"
    },
    { "type": "color", "id": "accent_color", "label": "Accent color", "info": "Leave blank to use the theme default" },
    { "type": "range", "id": "video_max_width", "label": "Video width", "min": 240, "max": 480, "step": 10, "unit": "px", "default": 320 },
    { "type": "color", "id": "cta_color", "label": "Add to cart button color", "info": "Leave blank to use the theme default" },
    { "type": "color", "id": "cta_text_color", "label": "Add to cart text color", "default": "#ffffff" },
    { "type": "text", "id": "cta_label", "label": "Add to cart button text", "info": "Leave blank to use the default label" },
    { "type": "checkbox", "id": "show_price", "label": "Show product price", "default": true },
    { "type": "checkbox", "id": "show_title_overlay", "label": "Show video title", "default": true },
    { "type": "checkbox", "id": "muted_default", "label": "Mute video by default", "default": false },
    { "type": "checkbox", "id": "loop", "label": "Loop video", "default": false }
  ]
}
{% endschema %}
```

- [ ] **Step 2: Compute the CSS var style string and data-attribute values**

Find:
```liquid
{% assign reel_namespace = 'app--404281098241' %}
```
Replace with:
```liquid
{% assign reel_namespace = 'app--404281098241' %}

{% case block.settings.corner_style %}
  {% when 'sharp' %}
    {% assign corner_radius_px = '0px' %}
  {% when 'soft' %}
    {% assign corner_radius_px = '20px' %}
  {% else %}
    {% assign corner_radius_px = '12px' %}
{% endcase %}

{% capture wrapper_style %}
  --reelup-corner-radius: {{ corner_radius_px }};
  {% unless block.settings.accent_color == blank %}
    --reelup-accent-color: {{ block.settings.accent_color }};
    --reelup-accent-hover-color: {{ block.settings.accent_color | color_darken: 15 }};
  {% endunless %}
{% endcapture %}

{% capture cta_hover_color %}
  {% unless block.settings.cta_color == blank %}{{ block.settings.cta_color | color_lighten: 15 }}{% endunless %}
{% endcapture %}
```

- [ ] **Step 3: Apply the wrapper style (including max-width) and trigger data attributes**

Find:
```liquid
{% if show_reel %}
  <div class="reelup-single-video" {{ block.shopify_attributes }}>
```
Replace with:
```liquid
{% if show_reel %}
  <div class="reelup-single-video" style="{{ wrapper_style | strip_newlines | strip }} max-width: {{ block.settings.video_max_width }}px;" {{ block.shopify_attributes }}>
```

Find the trigger's attribute list:
```liquid
    <div
      class="reelup-trigger"
      data-reelup-trigger
      data-reel-id="{{ reel.system.id }}"
      data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
      data-poster-url="{{ reel.config.value.posterUrl | escape }}"
      data-title="{{ reel.title.value | escape }}"
      data-close-label="{{ 'reels.close_label' | t }}"
      data-shop-label="{{ 'reels.shop_this_video_label' | t }}"
    >
```
Replace with:
```liquid
    <div
      class="reelup-trigger"
      data-reelup-trigger
      data-reel-id="{{ reel.system.id }}"
      data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
      data-poster-url="{{ reel.config.value.posterUrl | escape }}"
      data-title="{{ reel.title.value | escape }}"
      data-close-label="{{ 'reels.close_label' | t }}"
      data-shop-label="{{ 'reels.shop_this_video_label' | t }}"
      data-cta-color="{{ block.settings.cta_color }}"
      data-cta-text-color="{{ block.settings.cta_text_color }}"
      data-cta-hover-color="{{ cta_hover_color | strip }}"
      data-cta-label="{{ block.settings.cta_label | escape }}"
      data-show-price="{{ block.settings.show_price }}"
      data-show-title="{{ block.settings.show_title_overlay }}"
      data-muted-default="{{ block.settings.muted_default }}"
      data-loop="{{ block.settings.loop }}"
    >
```

- [ ] **Step 4: Verify defaults reproduce current behavior**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean. `max-width: 320px` matches the old hardcoded `single-video.css` value exactly (`.reelup-single-video { max-width: 320px; }` still applies as CSS but the inline style takes precedence at the same value, so no visible change).

- [ ] **Step 5: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/single-video.liquid
git commit -m "feat(storefront): add customization settings to Single video"
```

---

### Task 10: Add settings to `insta-stories.liquid`

**Files:**
- Modify: `extensions/shoppable-video-widgets/blocks/insta-stories.liquid`

**Interfaces:** No `corner_style` (avatars are always circular — see spec). `trigger_size` controls avatar diameter. Adds `story_duration`, consumed by Task 6's `reel-story.js` via `data-story-duration`.

- [ ] **Step 1: Add the schema settings**

Find:
```liquid
{% schema %}
{
  "name": "Insta-style stories",
  "target": "section",
  "settings": [
    { "type": "product", "id": "product", "label": "Product", "autofill": true }
  ]
}
{% endschema %}
```
Replace with:
```liquid
{% schema %}
{
  "name": "Insta-style stories",
  "target": "section",
  "settings": [
    { "type": "product", "id": "product", "label": "Product", "autofill": true },
    { "type": "text", "id": "heading", "label": "Heading", "info": "Leave blank to hide" },
    { "type": "color", "id": "accent_color", "label": "Ring color", "info": "Leave blank to use the theme default" },
    { "type": "range", "id": "trigger_size", "label": "Avatar size", "min": 120, "max": 320, "step": 10, "unit": "px", "default": 64 },
    { "type": "range", "id": "story_duration", "label": "Seconds per story", "min": 5, "max": 30, "step": 1, "unit": "s", "default": 15 },
    { "type": "color", "id": "cta_color", "label": "Add to cart button color", "info": "Leave blank to use the theme default" },
    { "type": "color", "id": "cta_text_color", "label": "Add to cart text color", "default": "#ffffff" },
    { "type": "text", "id": "cta_label", "label": "Add to cart button text", "info": "Leave blank to use the default label" },
    { "type": "checkbox", "id": "show_price", "label": "Show product price", "default": true },
    { "type": "checkbox", "id": "show_title_overlay", "label": "Show video title", "default": true },
    { "type": "checkbox", "id": "muted_default", "label": "Mute video by default", "default": false },
    { "type": "checkbox", "id": "loop", "label": "Loop video", "default": false }
  ]
}
{% endschema %}
```

Note: the `trigger_size` default here is `64` (not `220` like Task 7's row-of-rectangles) — matches this block's own current hardcoded avatar diameter, per the "unconfigured block is pixel-identical" constraint.

- [ ] **Step 2: Compute the CSS var style string and data-attribute values**

Find:
```liquid
{% assign reel_namespace = 'app--404281098241' %}
```
Replace with:
```liquid
{% assign reel_namespace = 'app--404281098241' %}

{% capture wrapper_style %}
  --reelup-trigger-size: {{ block.settings.trigger_size }}px;
  {% unless block.settings.accent_color == blank %}
    --reelup-accent-color: {{ block.settings.accent_color }};
  {% endunless %}
{% endcapture %}

{% capture cta_hover_color %}
  {% unless block.settings.cta_color == blank %}{{ block.settings.cta_color | color_lighten: 15 }}{% endunless %}
{% endcapture %}
```

- [ ] **Step 3: Render the optional heading and apply the wrapper style/data attributes**

Find:
```liquid
{% if visible_count > 0 %}
  <div class="reelup-stories" data-reelup-story-group {{ block.shopify_attributes }}>
```
Replace with:
```liquid
{% if visible_count > 0 %}
  {% unless block.settings.heading == blank %}
    <h2 class="reelup-widget-heading">{{ block.settings.heading }}</h2>
  {% endunless %}
  <div class="reelup-stories" data-reelup-story-group style="{{ wrapper_style | strip_newlines | strip }}" {{ block.shopify_attributes }}>
```

Find the trigger's attribute list:
```liquid
          <div
            class="reelup-trigger reelup-stories__avatar"
            data-reelup-trigger
            data-reel-id="{{ reel.system.id }}"
            data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
            data-poster-url="{{ reel.config.value.posterUrl | escape }}"
            data-title="{{ reel.title.value | escape }}"
            data-close-label="{{ 'reels.close_label' | t }}"
            data-shop-label="{{ 'reels.shop_this_video_label' | t }}"
          >
```
Replace with:
```liquid
          <div
            class="reelup-trigger reelup-stories__avatar"
            data-reelup-trigger
            data-reel-id="{{ reel.system.id }}"
            data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
            data-poster-url="{{ reel.config.value.posterUrl | escape }}"
            data-title="{{ reel.title.value | escape }}"
            data-close-label="{{ 'reels.close_label' | t }}"
            data-shop-label="{{ 'reels.shop_this_video_label' | t }}"
            data-story-duration="{{ block.settings.story_duration | times: 1000 }}"
            data-cta-color="{{ block.settings.cta_color }}"
            data-cta-text-color="{{ block.settings.cta_text_color }}"
            data-cta-hover-color="{{ cta_hover_color | strip }}"
            data-cta-label="{{ block.settings.cta_label | escape }}"
            data-show-price="{{ block.settings.show_price }}"
            data-show-title="{{ block.settings.show_title_overlay }}"
            data-muted-default="{{ block.settings.muted_default }}"
            data-loop="{{ block.settings.loop }}"
          >
```

- [ ] **Step 4: Verify defaults reproduce current behavior**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean. `data-story-duration="15000"` at the default `15` seconds — matches the old hardcoded `DURATION_MS = 15000` exactly, and Task 6's `parseInt("15000", 10) || 15000` reads it correctly.

- [ ] **Step 5: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/insta-stories.liquid
git commit -m "feat(storefront): add customization settings to Insta-style stories"
```

---

### Task 11: Add settings to `reel-pops.liquid`

**Files:**
- Modify: `extensions/shoppable-video-widgets/blocks/reel-pops.liquid`

**Interfaces:** No `corner_style` (circular) and no `accent_color` (this block's trigger button renders no play-icon span at all — confirmed by reading the file, it's poster-image-only). Adds `position` (maps to Task 3's four CSS modifier classes) and `show_pulse` (maps to Task 3's `.reelup-pop--no-pulse`).

- [ ] **Step 1: Add the schema settings**

Find:
```liquid
{% schema %}
{
  "name": "Reel pop",
  "target": "body"
}
{% endschema %}
```
Replace with:
```liquid
{% schema %}
{
  "name": "Reel pop",
  "target": "body",
  "settings": [
    {
      "type": "select",
      "id": "position",
      "label": "Position",
      "options": [
        { "value": "bottom_right", "label": "Bottom right" },
        { "value": "bottom_left", "label": "Bottom left" },
        { "value": "top_right", "label": "Top right" },
        { "value": "top_left", "label": "Top left" }
      ],
      "default": "bottom_right"
    },
    { "type": "checkbox", "id": "show_pulse", "label": "Pulse to draw attention", "default": true },
    { "type": "range", "id": "trigger_size", "label": "Bubble size", "min": 120, "max": 320, "step": 10, "unit": "px", "default": 72 },
    { "type": "color", "id": "cta_color", "label": "Add to cart button color", "info": "Leave blank to use the theme default" },
    { "type": "color", "id": "cta_text_color", "label": "Add to cart text color", "default": "#ffffff" },
    { "type": "text", "id": "cta_label", "label": "Add to cart button text", "info": "Leave blank to use the default label" },
    { "type": "checkbox", "id": "show_price", "label": "Show product price", "default": true },
    { "type": "checkbox", "id": "show_title_overlay", "label": "Show video title", "default": true },
    { "type": "checkbox", "id": "muted_default", "label": "Mute video by default", "default": false },
    { "type": "checkbox", "id": "loop", "label": "Loop video", "default": false }
  ]
}
{% endschema %}
```

- [ ] **Step 2: Compute the position class and CSS var style string**

Find:
```liquid
{% assign reel_namespace = 'app--404281098241' %}
```
Replace with:
```liquid
{% assign reel_namespace = 'app--404281098241' %}

{% assign position_class = 'reelup-pop--' | append: block.settings.position | replace: '_', '-' %}
{% unless block.settings.show_pulse %}
  {% assign position_class = position_class | append: ' reelup-pop--no-pulse' %}
{% endunless %}

{% capture wrapper_style %}--reelup-trigger-size: {{ block.settings.trigger_size }}px;{% endcapture %}

{% capture cta_hover_color %}
  {% unless block.settings.cta_color == blank %}{{ block.settings.cta_color | color_lighten: 15 }}{% endunless %}
{% endcapture %}
```

- [ ] **Step 3: Apply the position class, wrapper style, and trigger data attributes**

Find:
```liquid
{% if show_reel %}
  <div class="reelup-pop" data-reelup-pop data-reel-id="{{ reel.system.id }}">
```
Replace with:
```liquid
{% if show_reel %}
  <div class="reelup-pop {{ position_class }}" data-reelup-pop data-reel-id="{{ reel.system.id }}" style="{{ wrapper_style }}">
```

Find the trigger's attribute list:
```liquid
    <div
      class="reelup-trigger reelup-pop__trigger"
      data-reelup-trigger
      data-reel-id="{{ reel.system.id }}"
      data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
      data-poster-url="{{ reel.config.value.posterUrl | escape }}"
      data-title="{{ reel.title.value | escape }}"
      data-close-label="{{ 'reels.close_label' | t }}"
      data-shop-label="{{ 'reels.shop_this_video_label' | t }}"
    >
```
Replace with:
```liquid
    <div
      class="reelup-trigger reelup-pop__trigger"
      data-reelup-trigger
      data-reel-id="{{ reel.system.id }}"
      data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
      data-poster-url="{{ reel.config.value.posterUrl | escape }}"
      data-title="{{ reel.title.value | escape }}"
      data-close-label="{{ 'reels.close_label' | t }}"
      data-shop-label="{{ 'reels.shop_this_video_label' | t }}"
      data-cta-color="{{ block.settings.cta_color }}"
      data-cta-text-color="{{ block.settings.cta_text_color }}"
      data-cta-hover-color="{{ cta_hover_color | strip }}"
      data-cta-label="{{ block.settings.cta_label | escape }}"
      data-show-price="{{ block.settings.show_price }}"
      data-show-title="{{ block.settings.show_title_overlay }}"
      data-muted-default="{{ block.settings.muted_default }}"
      data-loop="{{ block.settings.loop }}"
    >
```

- [ ] **Step 4: Verify defaults reproduce current behavior**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean. `position_class` at the default renders `reelup-pop--bottom-right` (the `_`→`-` replace turns `bottom_right` into `bottom-right`) — matches Task 3's `.reelup-pop--bottom-right { right: 20px; bottom: 20px; }`, identical to the old hardcoded values. `show_pulse` defaults to `true`, so `reelup-pop--no-pulse` is never appended by default — pulse still plays.

- [ ] **Step 5: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/reel-pops.liquid
git commit -m "feat(storefront): add customization settings to Reel pop"
```

---

### Task 12: Whole-project verification

**Files:** none (verification-only task).

**Interfaces:** none.

- [ ] **Step 1: Confirm no already-shipped playback/analytics logic changed shape**

```bash
git diff main -- extensions/shoppable-video-widgets/assets/reel-hls.js extensions/shoppable-video-widgets/assets/reel-trigger.js extensions/shoppable-video-widgets/assets/reel-pop.js
```
Expected: no output — this plan never touches HLS playback, the generic trigger-click wiring, or the reel-pop dismiss/session logic.

- [ ] **Step 2: Full project checks**

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```
Expected: all four clean.

- [ ] **Step 3: Manual Theme Editor pass — defaults are unchanged**

For each of the 5 blocks, add it to a page (or, for Reel pop, enable it under Theme Settings → App embeds) with every setting left at its default. Compare against the pre-this-plan behavior: corner radius, colors, sizes, add-to-cart button, price visibility, title overlay, mute/loop, story timing (15s/segment), and reel-pop's bottom-right position with its pulse — all should look and behave exactly as before.

- [ ] **Step 4: Manual Theme Editor pass — settings actually work**

For each of the 5 blocks, change every new setting away from its default and confirm the Theme Editor's live preview reflects it: corner style, accent/ring color, size, add-to-cart color/text/label, price/title visibility, mute/loop, story duration, reel-pop position (all 4), reel-pop pulse toggle, and the heading text (product-page-reels, stacked-carousel, insta-stories).

- [ ] **Step 5: Two-instances-on-one-page check**

On a single product page, place two blocks that support tagged products (e.g. Product page reels and Stacked carousel, or add Reel pop via the app embed alongside either) with **different** `cta_color`/`accent_color` values. Open each one's viewer in turn and confirm neither leaks the other's color — this is the scenario the data-attribute approach exists to fix (see spec's "Two-instances-on-one-page check").

- [ ] **Step 6: Reduced-motion and focus-visible spot check**

With `prefers-reduced-motion: reduce` enabled (OS or browser dev tools), confirm the reel-pop's entrance/pulse animation and the trigger's hover-lift transform are suppressed regardless of `accent_color`/`corner_style` values, and that a custom `accent_color` doesn't break the existing focus-visible ring on `.reelup-trigger__button` (added in the prior storefront-polish plan) — the focus ring uses a fixed white/black box-shadow independent of `--reelup-accent-color`, so it should be unaffected either way; this step confirms that's actually true in the browser, not just in the CSS.

- [ ] **Step 7: Commit (only if Steps 1–2 required a fix)**

If nothing needed fixing, skip committing — this task is verification-only.
