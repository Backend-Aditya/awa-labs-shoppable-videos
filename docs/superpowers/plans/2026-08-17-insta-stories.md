# Insta-stories Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the missing Insta-stories theme block: circular avatar triggers opening a full-screen, auto-advancing story viewer with a tap-to-open tagged-products drawer.

**Architecture:** Extract the lightbox's HLS logic into a new shared `reel-hls.js` (used by both the lightbox and the new story viewer), then build the story viewer (`reel-story.css`/`reel-story.js`) on top of the exact same `.reelup-trigger` data contract the three existing blocks already use, and a new `insta-stories.liquid` block that renders that contract as an avatar row.

**Tech Stack:** Plain Liquid/CSS/JS, no build step, no dependencies — same as the rest of this extension.

## Global Constraints

- This plan touches only `extensions/shoppable-video-widgets/**` — no admin-app (`app/`) file changes, no `shopify.app.toml` change (the STORIES metafield definitions already exist).
- Refactoring `reel-lightbox.js` to use the new shared `reel-hls.js` must not change its observable behavior — same fallback order (native HLS → Hls.js → reject), same teardown timing (on the dialog's `close` event).
- Every reel's poster `<img>` keeps `loading="lazy"` and explicit `width`/`height`.
- No automated test suite covers this extension — verification per task is described in each task's steps. Run `npm run typecheck`, `npm run lint`, and `npm run test` after every task anyway, as the basic sanity gate that nothing else was accidentally touched (same convention as the prior reel-lightbox plan).

---

### Task 1: Extract shared `reel-hls.js`, refactor the lightbox to use it

**Files:**
- Create: `extensions/shoppable-video-widgets/assets/reel-hls.js`
- Modify: `extensions/shoppable-video-widgets/assets/reel-lightbox.js`
- Modify: `extensions/shoppable-video-widgets/blocks/product-page-reels.liquid`
- Modify: `extensions/shoppable-video-widgets/blocks/single-video.liquid`
- Modify: `extensions/shoppable-video-widgets/blocks/stacked-carousel.liquid`

**Interfaces:**
- Produces: `window.ReelupHls.attach(video: HTMLVideoElement, hlsSrc: string): Promise<void>` and `window.ReelupHls.teardown(video: HTMLVideoElement): void` — consumed by `reel-lightbox.js` (this task) and `reel-story.js` (Task 3).

- [ ] **Step 1: Create the shared HLS module**

```js
(() => {
  const currentScriptSrc = document.currentScript?.src ?? "";
  let hlsInstance = null;

  const supportsNativeHls = (video) =>
    video.canPlayType("application/vnd.apple.mpegurl") !== "";

  const loadHlsJsIfNeeded = () => {
    if (window.Hls || document.querySelector("script[data-reelup-hlsjs]")) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = currentScriptSrc.replace("reel-hls.js", "hls.min.js");
      script.dataset.reelupHlsjs = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load hls.js"));
      document.head.appendChild(script);
    });
  };

  const attach = async (video, hlsSrc) => {
    if (supportsNativeHls(video)) {
      video.src = hlsSrc;
      return;
    }

    await loadHlsJsIfNeeded();

    if (!window.Hls?.isSupported()) {
      throw new Error("HLS not supported");
    }

    hlsInstance?.destroy();
    hlsInstance = null;

    await new Promise((resolve, reject) => {
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

  // Runs whenever a consumer (the lightbox, the story viewer) tears down
  // its video element — destroys any active Hls.js instance and clears
  // the video's source so a stale video doesn't keep decoding/buffering
  // in the background after its dialog closes.
  const teardown = (video) => {
    hlsInstance?.destroy();
    hlsInstance = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  window.ReelupHls = { attach, teardown };
})();
```

- [ ] **Step 2: Refactor `reel-lightbox.js` to use it**

Replace `extensions/shoppable-video-widgets/assets/reel-lightbox.js` in full:

```js
(() => {
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
    const bodyEl = dialog.querySelector(".reelup-lightbox__body");
    const productsPanel = dialog.querySelector("[data-reelup-lightbox-products]");
    const productsList = dialog.querySelector("[data-reelup-lightbox-products-list]");
    const closeButton = dialog.querySelector("[data-reelup-lightbox-close]");

    dialog.addEventListener("close", () => {
      window.ReelupHls?.teardown(video);
      productsList.replaceChildren();
      productsPanel.hidden = true;
    });

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target === bodyEl) dialog.close();
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
      await window.ReelupHls.attach(video, hlsSrc);
      await video.play();
    } catch {
      // Playback failed to initialize; the lightbox stays open with the
      // poster/controls visible so the shopper can still browse products.
    }
  };

  window.ReelupLightbox = { open };
})();
```

(This removes `reel-lightbox.js`'s own `supportsNativeHls`/`loadHlsJsIfNeeded`/`attachSource`/`teardownSource`/`hlsInstance` — that logic now lives only in `reel-hls.js`. The `open()`/`buildLightbox()` control flow and every DOM/class-name detail are otherwise unchanged from the current file.)

- [ ] **Step 3: Load `reel-hls.js` before `reel-lightbox.js` in all three existing blocks**

In `extensions/shoppable-video-widgets/blocks/product-page-reels.liquid`, `single-video.liquid`, and `stacked-carousel.liquid`, find the line:

```liquid
  <script src="{{ 'reel-lightbox.js' | asset_url }}" defer></script>
```

and add a new line immediately before it in each file:

```liquid
  <script src="{{ 'reel-hls.js' | asset_url }}" defer></script>
  <script src="{{ 'reel-lightbox.js' | asset_url }}" defer></script>
```

No other changes to these three files.

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add extensions/shoppable-video-widgets/assets/reel-hls.js extensions/shoppable-video-widgets/assets/reel-lightbox.js extensions/shoppable-video-widgets/blocks/product-page-reels.liquid extensions/shoppable-video-widgets/blocks/single-video.liquid extensions/shoppable-video-widgets/blocks/stacked-carousel.liquid
git commit -m "refactor(storefront): extract shared reel-hls.js, wire it into all HLS-consuming blocks"
```

---

### Task 2: Create `reel-story.css`

**Files:**
- Create: `extensions/shoppable-video-widgets/assets/reel-story.css`

**Interfaces:**
- Produces: `.reelup-stories*` (avatar row + avatar override of the shared `.reelup-trigger__button`) and `.reelup-story*` (the story viewer, its progress bar, nav tap zones, shop pill, and drawer) — consumed by `insta-stories.liquid` (Task 4) and `reel-story.js` (Task 3). The drawer reuses `.reelup-lightbox__products-heading`/`.reelup-lightbox__products-list`/`.reelup-lightbox__product*` from `reel-lightbox.css` (loaded alongside this file), not redefined here.

- [ ] **Step 1: Create the file**

```css
.reelup-stories {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding-block: 12px;
}

.reelup-stories__item {
  flex: 0 0 auto;
  width: 72px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.reelup-stories__avatar {
  width: 64px;
  height: 64px;
}

.reelup-stories__avatar-button {
  width: 64px;
  height: 64px;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  border: 2px solid #e1306c;
  padding: 2px;
  background: #fff;
}

.reelup-stories__avatar-button .reelup-trigger__poster {
  border-radius: 50%;
}

.reelup-stories__label {
  font-size: 12px;
  color: #333;
  max-width: 72px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reelup-story {
  position: fixed;
  inset: 0;
  margin: 0;
  padding: 24px 16px;
  width: 100vw;
  height: 100dvh;
  max-width: 100vw;
  max-height: 100dvh;
  border: none;
  background: #000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: safe center;
  box-sizing: border-box;
  z-index: 1001;
}

.reelup-story::backdrop {
  background: #000;
}

.reelup-story__progress {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  display: flex;
  gap: 4px;
  z-index: 2;
}

.reelup-story__segment {
  flex: 1 1 0;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.3);
  overflow: hidden;
}

.reelup-story__segment-fill {
  height: 100%;
  width: 0%;
  background: #fff;
}

.reelup-story__close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 3;
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

.reelup-story__close:hover,
.reelup-story__close:focus-visible {
  background: rgba(255, 255, 255, 0.3);
}

.reelup-story__frame {
  position: relative;
  width: 100%;
  max-width: min(420px, calc(88vh * 9 / 16));
  aspect-ratio: 9 / 16;
  max-height: 88vh;
  border-radius: 16px;
  overflow: hidden;
  background: #111;
}

.reelup-story__title {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 64px;
  z-index: 1;
  margin: 0;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

.reelup-story__video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
}

.reelup-story__nav {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 33%;
  border: none;
  background: transparent;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
  color: #fff;
  font-size: 28px;
}

.reelup-story__nav:hover,
.reelup-story__nav:focus-visible {
  opacity: 0.6;
}

.reelup-story__nav--prev {
  left: 0;
  text-align: left;
  padding-left: 8px;
}

.reelup-story__nav--next {
  right: 0;
  text-align: right;
  padding-right: 8px;
}

.reelup-story__shop {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 1;
  font-size: 13px;
  font-weight: 600;
  padding: 10px 18px;
  border-radius: 999px;
  border: none;
  background: #fff;
  color: #111;
  cursor: pointer;
}

.reelup-story__drawer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 4;
  max-height: 60vh;
  background: #fff;
  border-radius: 20px 20px 0 0;
  padding: 12px 16px 16px;
  box-sizing: border-box;
  overflow-y: auto;
}

.reelup-story__drawer-handle {
  display: block;
  width: 40px;
  height: 4px;
  border-radius: 999px;
  background: #ccc;
  border: none;
  margin: 0 auto 12px;
  cursor: pointer;
}
```

- [ ] **Step 2: Verify**

Nothing references this file yet. Run:
```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add extensions/shoppable-video-widgets/assets/reel-story.css
git commit -m "feat(storefront): add story viewer + avatar stylesheet"
```

---

### Task 3: Create `reel-story.js`

**Files:**
- Create: `extensions/shoppable-video-widgets/assets/reel-story.js`

**Interfaces:**
- Consumes: `window.ReelupHls.attach`/`.teardown` (Task 1).
- Consumes (via each trigger's `.dataset`): the same `hlsSrc`/`posterUrl`/`title`/`shopLabel` contract every other block already produces, plus a sibling `<template data-reelup-products>`.
- Wires clicks on any `[data-reelup-story-group] [data-reelup-trigger]` (produced by `insta-stories.liquid`, Task 4).

- [ ] **Step 1: Create the file**

```js
(() => {
  const DURATION_MS = 15000;

  let reels = [];
  let currentIndex = 0;
  let timer = null;
  let drawerOpen = false;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const renderProgress = (dialog) => {
    const progress = dialog.querySelector("[data-reelup-story-progress]");
    progress.innerHTML = reels
      .map(
        (_, i) =>
          `<div class="reelup-story__segment" data-index="${i}"><div class="reelup-story__segment-fill"></div></div>`,
      )
      .join("");
  };

  const setSegmentState = (dialog, index, state) => {
    const segment = dialog.querySelector(`.reelup-story__segment[data-index="${index}"]`);
    const fill = segment?.querySelector(".reelup-story__segment-fill");
    if (!fill) return;

    if (state === "done") {
      fill.style.transition = "none";
      fill.style.width = "100%";
    } else if (state === "active") {
      fill.style.transition = "none";
      fill.style.width = "0%";
      // Force a reflow so the transition below animates from 0% instead
      // of the two inline-style writes batching into one recalculation
      // and jumping straight to 100%.
      void fill.offsetWidth;
      fill.style.transition = `width ${DURATION_MS}ms linear`;
      fill.style.width = "100%";
    } else {
      fill.style.transition = "none";
      fill.style.width = "0%";
    }
  };

  const closeDrawerImmediate = (dialog) => {
    dialog.querySelector("[data-reelup-story-drawer]").hidden = true;
    drawerOpen = false;
  };

  const openDrawer = (dialog) => {
    dialog.querySelector("[data-reelup-story-drawer]").hidden = false;
    drawerOpen = true;
    dialog.querySelector(".reelup-story__video").pause();
    clearTimer();
  };

  const closeDrawer = (dialog) => {
    closeDrawerImmediate(dialog);
    dialog.querySelector(".reelup-story__video").play().catch(() => {});
    scheduleAdvance(dialog);
  };

  const scheduleAdvance = (dialog) => {
    clearTimer();
    timer = setTimeout(() => goTo(dialog, currentIndex + 1), DURATION_MS);
  };

  const goTo = async (dialog, targetIndex) => {
    const index = Math.max(targetIndex, 0);
    if (index >= reels.length) {
      dialog.close();
      return;
    }

    if (drawerOpen) closeDrawerImmediate(dialog);

    reels.forEach((_, i) => {
      if (i < index) setSegmentState(dialog, i, "done");
      else if (i > index) setSegmentState(dialog, i, "idle");
    });

    currentIndex = index;
    const trigger = reels[index];
    const video = dialog.querySelector(".reelup-story__video");
    const title = dialog.querySelector(".reelup-story__title");
    const shopButton = dialog.querySelector("[data-reelup-story-shop]");
    const drawerHeading = dialog.querySelector("[data-reelup-story-drawer-heading]");
    const drawerList = dialog.querySelector("[data-reelup-story-drawer-list]");

    clearTimer();
    window.ReelupHls?.teardown(video);

    title.textContent = trigger.dataset.title ?? "";
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

    setSegmentState(dialog, index, "active");

    try {
      await window.ReelupHls.attach(video, trigger.dataset.hlsSrc);
      await video.play();
    } catch {
      // Playback failed to initialize; still advance on schedule below so
      // the shopper isn't stuck on a broken segment forever.
    }
    scheduleAdvance(dialog);
  };

  const buildViewer = () => {
    const existing = document.getElementById("reelup-story-viewer");
    if (existing) return existing;

    const dialog = document.createElement("dialog");
    dialog.id = "reelup-story-viewer";
    dialog.className = "reelup-story";
    dialog.setAttribute("aria-labelledby", "reelup-story-title");
    dialog.innerHTML = `
      <div class="reelup-story__progress" data-reelup-story-progress></div>
      <button type="button" class="reelup-story__close" data-reelup-story-close aria-label="Close">&times;</button>
      <div class="reelup-story__frame">
        <h2 id="reelup-story-title" class="reelup-story__title"></h2>
        <video class="reelup-story__video" playsinline></video>
        <button type="button" class="reelup-story__nav reelup-story__nav--prev" data-reelup-story-prev aria-label="Previous">&lsaquo;</button>
        <button type="button" class="reelup-story__nav reelup-story__nav--next" data-reelup-story-next aria-label="Next">&rsaquo;</button>
        <button type="button" class="reelup-story__shop" data-reelup-story-shop hidden></button>
      </div>
      <div class="reelup-story__drawer" data-reelup-story-drawer hidden>
        <button type="button" class="reelup-story__drawer-handle" data-reelup-story-drawer-close aria-label="Close products"></button>
        <h3 class="reelup-lightbox__products-heading" data-reelup-story-drawer-heading></h3>
        <div class="reelup-lightbox__products-list" data-reelup-story-drawer-list></div>
      </div>
    `;
    document.body.appendChild(dialog);

    const video = dialog.querySelector(".reelup-story__video");
    const drawerList = dialog.querySelector("[data-reelup-story-drawer-list]");

    dialog.querySelector("[data-reelup-story-close]").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-reelup-story-prev]").addEventListener("click", () => goTo(dialog, currentIndex - 1));
    dialog.querySelector("[data-reelup-story-next]").addEventListener("click", () => goTo(dialog, currentIndex + 1));
    dialog.querySelector("[data-reelup-story-shop]").addEventListener("click", () => openDrawer(dialog));
    dialog
      .querySelector("[data-reelup-story-drawer-close]")
      .addEventListener("click", () => closeDrawer(dialog));

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });

    dialog.addEventListener("close", () => {
      clearTimer();
      window.ReelupHls?.teardown(video);
      closeDrawerImmediate(dialog);
    });

    video.addEventListener("ended", () => goTo(dialog, currentIndex + 1));

    drawerList.addEventListener("click", async (event) => {
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

  const openViewer = (groupEl, startIndex) => {
    reels = Array.from(groupEl.querySelectorAll("[data-reelup-trigger]"));
    if (reels.length === 0) return;

    const dialog = buildViewer();
    renderProgress(dialog);
    dialog.showModal();
    goTo(dialog, startIndex);
  };

  document.querySelectorAll("[data-reelup-story-group]").forEach((group) => {
    if (group.dataset.reelupStoryGroupBound) return;
    group.dataset.reelupStoryGroupBound = "true";

    Array.from(group.querySelectorAll("[data-reelup-trigger]")).forEach((trigger, index) => {
      trigger
        .querySelector(".reelup-trigger__button")
        ?.addEventListener("click", () => openViewer(group, index));
    });
  });
})();
```

- [ ] **Step 2: Verify**

Nothing renders `[data-reelup-story-group]` yet. Run:
```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add extensions/shoppable-video-widgets/assets/reel-story.js
git commit -m "feat(storefront): add story viewer behavior (progress, navigation, shop drawer)"
```

---

### Task 4: Create the `insta-stories.liquid` block

**Files:**
- Create: `extensions/shoppable-video-widgets/blocks/insta-stories.liquid`

**Interfaces:**
- Consumes: `reel-lightbox.css` (for the shared `.reelup-lightbox__product*` classes the drawer reuses), `reel-story.css`, `reel-hls.js`, `reel-story.js` (Tasks 1-3).
- Reads: `shop.metafields[reel_namespace].insta_stories_widget` / `.insta_stories_widget_reels` (both already declared in `shopify.app.toml`, confirmed present before this plan started).

- [ ] **Step 1: Create the file**

```liquid
{% doc %}
Renders the shop's STORIES widget: curated reels as a horizontal row of
circular avatar triggers, wrapped in a shared story group. Tapping any
avatar opens the full-screen story viewer starting at that reel, which
then auto-advances through every reel in the group. Gated on the
shop-level widget metafield (published + targetRule) exactly like the
other reel blocks.
@example
{% content_for 'block', type: 'insta-stories', id: 'insta-stories' %}
{% enddoc %}

{{ 'reel-lightbox.css' | asset_url | stylesheet_tag }}
{{ 'reel-story.css' | asset_url | stylesheet_tag }}

{% assign reel_namespace = 'app--404281098241' %}

{% assign widget_field = shop.metafields[reel_namespace].insta_stories_widget %}

{% assign widget_matches_product = false %}
{% if widget_field.value.published %}
  {% if widget_field.value.targetRule.type == "all_products" %}
    {% assign widget_matches_product = true %}
  {% elsif widget_field.value.targetRule.type == "handles" and widget_field.value.targetRule.handles contains product.handle %}
    {% assign widget_matches_product = true %}
  {% endif %}
{% endif %}

{% assign reels_field = shop.metafields[reel_namespace].insta_stories_widget_reels %}

{% assign visible_count = 0 %}
{% if widget_matches_product %}
  {% for reel in reels_field.value %}
    {% if reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
      {% assign visible_count = visible_count | plus: 1 %}
    {% endif %}
  {% endfor %}
{% endif %}

{% if visible_count > 0 %}
  <div class="reelup-stories" data-reelup-story-group {{ block.shopify_attributes }}>
    {% for reel in reels_field.value %}
      {% if reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
        <div class="reelup-stories__item">
          <div
            class="reelup-trigger reelup-stories__avatar"
            data-reelup-trigger
            data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
            data-poster-url="{{ reel.config.value.posterUrl | escape }}"
            data-title="{{ reel.title.value | escape }}"
            data-close-label="{{ 'reels.close_label' | t }}"
            data-shop-label="{{ 'reels.shop_this_video_label' | t }}"
          >
            <button
              type="button"
              class="reelup-trigger__button reelup-stories__avatar-button"
              aria-label="{{ 'reels.play_label' | t }}"
            >
              {% if reel.config.value.posterUrl != blank %}
                <img
                  class="reelup-trigger__poster"
                  src="{{ reel.config.value.posterUrl | escape }}"
                  alt="{{ reel.title.value | escape }}"
                  loading="lazy"
                  width="128"
                  height="128"
                >
              {% endif %}
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
          <span class="reelup-stories__label">{{ reel.title.value | truncate: 12 }}</span>
        </div>
      {% endif %}
    {% endfor %}
  </div>
  <script src="{{ 'reel-hls.js' | asset_url }}" defer></script>
  <script src="{{ 'reel-story.js' | asset_url }}" defer></script>
{% endif %}

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

- [ ] **Step 2: Verify**

```bash
npm run typecheck
npm run lint
npm run test
```
Expected: all clean. In the theme editor (manual, best-effort): confirm "Insta-style stories" now appears as a fourth option in the Apps block picker, the avatar row renders, tapping any avatar opens the full-screen viewer starting at that reel, the progress bar advances and auto-advances to the next reel, manual left/right tap navigation works, the shop drawer opens/closes correctly (pausing/resuming playback and the timer), and add-to-cart in the drawer works.

- [ ] **Step 3: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/insta-stories.liquid
git commit -m "feat(storefront): add Insta-style stories block"
```

---

### Task 5: Whole-branch verification

**Files:** none (verification-only task).

**Interfaces:** none.

- [ ] **Step 1: Confirm `reel-hls.js` is loaded everywhere it's needed**

```bash
grep -rln "reel-hls.js" extensions/shoppable-video-widgets/blocks/*.liquid
```
Expected: all four block files listed (`product-page-reels.liquid`, `single-video.liquid`, `stacked-carousel.liquid`, `insta-stories.liquid`).

- [ ] **Step 2: Confirm `reel-lightbox.js` no longer has its own HLS logic**

```bash
grep -n "supportsNativeHls\|loadHlsJsIfNeeded\|hlsInstance" extensions/shoppable-video-widgets/assets/reel-lightbox.js
```
Expected: no output — that logic now lives only in `reel-hls.js`.

- [ ] **Step 3: Full project checks**

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```
Expected: all four clean.

- [ ] **Step 4: Manual theme-editor walkthrough**

In a live theme editor / dev store preview: add the "Insta-style stories" block, confirm the avatar row renders, tap an avatar to open the viewer, confirm the progress bar fills and auto-advances, confirm manual prev/next tap zones work, confirm the shop drawer opens/closes with correct pause/resume behavior, confirm add-to-cart in the drawer updates the cart, and confirm all three close paths (×, ESC, backdrop) stop playback. Also re-spot-check the three existing blocks (Product page reels, Single video, Stacked carousel) still work after the `reel-hls.js` extraction in Task 1 — this was a refactor of already-shipped code, so regression risk there is the main thing this walkthrough needs to catch.

- [ ] **Step 5: Commit (only if Steps 1-3 required a fix)**

If nothing needed fixing, skip committing — this task is verification-only.
