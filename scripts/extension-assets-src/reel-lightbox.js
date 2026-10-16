// Shared storefront runtime: config/labels, analytics, the delegated
// product-card behaviour (variant picker + add to cart, used by the video
// viewer, the story drawer and the featured-video block alike), and the
// video viewer itself.
(() => {
  // This file can be loaded twice on one page (app embed + a block's
  // loader when both are present). Everything below — including the
  // document-level delegated cart listeners — must exist exactly once, or
  // one click would add the product to the cart twice.
  if (window.ReelupLightbox) return;

  /* ------------------------------------------------------------ config */

  // Translations reach us through `t | json`, and Shopify HTML-escapes
  // non-_html translations ("Couldn&#39;t…"); decode once here so labels
  // can be used with textContent (and re-escaped for innerHTML).
  const decodeEntities = (value) => {
    const text = String(value ?? "");
    if (!/&(#\d+|#x[\da-f]+|[a-z]+);/i.test(text)) return text;
    const area = document.createElement("textarea");
    area.innerHTML = text;
    return area.value;
  };

  const readConfig = () => {
    // The embed and every block render their own copy (blocks must work
    // with the embed off); they're identical, so the first one wins.
    const el = document.querySelector("script[data-reelup-config]") ?? document.getElementById("reelup-config");
    try {
      return JSON.parse(el?.textContent ?? "{}");
    } catch {
      return {};
    }
  };
  const config = readConfig();
  const configLabels = {};
  for (const [key, value] of Object.entries(config.labels ?? {})) {
    if (typeof value === "string" && value) configLabels[key] = decodeEntities(value);
  }
  const labels = {
    close: "Close",
    play: "Play video",
    pause: "Pause video",
    mute: "Mute",
    unmute: "Unmute",
    shop: "Shop this video",
    previous: "Previous video",
    next: "Next video",
    viewCart: "View cart",
    addedToCart: "Added to your cart",
    addFailed: "Couldn't add to cart. Try again.",
    closeProducts: "Hide products",
    share: "Share video",
    linkCopied: "Link copied",
    youMayLike: "You may also like",
    learnMore: "Learn more",
    video: "Shoppable video",
    playbackError: "This video couldn't be played.",
    retry: "Try again",
    of: "__CURRENT__ of __TOTAL__",
    ...configLabels,
  };
  const cartUrl = config.cartUrl ?? "/cart";
  const cartAddUrl = config.cartAddUrl ?? "/cart/add.js";
  const cartJsUrl = config.cartJsUrl ?? "/cart.js";
  const recommendationsUrl = config.recommendationsUrl ?? "/recommendations/products.json";

  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

  const isRtl = (el) => {
    try {
      return getComputedStyle(el || document.documentElement).direction === "rtl";
    } catch {
      return document.documentElement.dir === "rtl";
    }
  };

  // Views count once per reel per 30 minutes in a tab, so replaying, swiping
  // back and forth or reopening doesn't inflate numbers (or plan usage).
  const VIEW_WINDOW_MS = 30 * 60 * 1000;
  const recentlyViewed = (reelId) => {
    try {
      const key = `reelup-viewed-${reelId}`;
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last < VIEW_WINDOW_MS) return true;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // Storage unavailable: count it.
    }
    return false;
  };

  const trackAnalytics = (reelId, eventType) => {
    if (!reelId) return;
    if (eventType === "view" && recentlyViewed(reelId)) return;
    fetch("/apps/reels/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopDomain: window.Shopify?.shop, reelId, eventType }),
      keepalive: true,
    }).catch(() => {});
  };

  const safeLink = (value) => {
    const url = String(value ?? "").trim();
    return /^(https?:\/\/|\/)/i.test(url) ? url : "";
  };

  const reelIdFor = (el) => el.closest("[data-reelup-reel-id]")?.getAttribute("data-reelup-reel-id") ?? "";

  /* ------------------------------------------- shopper mute preference */

  // Once the shopper touches a mute button, that choice sticks for the
  // session and overrides each widget's mutedDefault.
  const MUTE_KEY = "reelup-muted";
  let memoryMuted = null;
  const getUserMuted = () => {
    try {
      const stored = sessionStorage.getItem(MUTE_KEY);
      if (stored !== null) return stored === "true";
    } catch {
      // fall through to the in-memory copy
    }
    return memoryMuted;
  };
  const setUserMuted = (muted) => {
    memoryMuted = Boolean(muted);
    try {
      sessionStorage.setItem(MUTE_KEY, String(Boolean(muted)));
    } catch {
      // in-memory only
    }
  };

  /* --------------------------------------------------- live regions */

  // Permanent, visually hidden live regions: one for the page (featured
  // block) and one inside each viewer dialog (content outside a modal
  // dialog is inert and wouldn't be announced). Created up front, never
  // inside hidden parents, so screen readers register them before use.
  const makeLiveRegion = () => {
    const el = document.createElement("div");
    el.className = "reelup-live";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    el.dataset.reelupLive = "";
    return el;
  };
  const pageLive = makeLiveRegion();
  const mountPageLive = () => document.body && !pageLive.isConnected && document.body.appendChild(pageLive);
  if (document.body) mountPageLive();
  else document.addEventListener("DOMContentLoaded", mountPageLive, { once: true });

  const announce = (scope, message) => {
    const region = scope?.closest?.("dialog")?.querySelector("[data-reelup-live]") ?? pageLive;
    region.textContent = "";
    // A tick between clear and set makes repeated identical messages
    // announce again.
    setTimeout(() => {
      region.textContent = message;
    }, 60);
  };

  /* ----------------------------------------------- product card + cart */

  // Variant picker: keeps the card's price, compare-at price, image and
  // add button in step with the chosen option.
  document.addEventListener("change", (event) => {
    const select = event.target.closest?.("[data-reelup-variant]");
    if (!select) return;
    const card = select.closest("[data-reelup-product]");
    const option = select.selectedOptions[0];
    if (!card || !option) return;

    const price = card.querySelector("[data-reelup-price]");
    if (price && option.dataset.price) price.textContent = option.dataset.price;
    const compare = card.querySelector("[data-reelup-compare]");
    if (compare) {
      compare.textContent = option.dataset.compare ?? "";
      compare.hidden = !option.dataset.compare;
    }
    const image = card.querySelector(".reelup-product__media img");
    if (image && option.dataset.image) {
      image.removeAttribute("srcset");
      image.src = option.dataset.image;
    }
    const button = card.querySelector("[data-reelup-add-to-cart]");
    if (button) {
      const available = option.dataset.available === "true";
      button.dataset.variantId = option.value;
      button.disabled = !available;
      button.dataset.state = "";
      button.textContent = available ? button.dataset.addLabel : button.dataset.soldOutLabel;
    }
  });

  // Section Rendering API: ask /cart/add.js to render the theme's cart
  // sections in the same round trip. Dawn-family themes expose the list on
  // their <cart-drawer>/<cart-notification> element.
  const DEFAULT_CART_SECTIONS = ["cart-icon-bubble", "cart-drawer", "cart-notification-button", "cart-live-region-text"];
  const themeCartElement = () => document.querySelector("cart-drawer, cart-notification");
  const cartSections = () => {
    let ids = [];
    try {
      ids = (themeCartElement()?.getSectionsToRender?.() ?? []).map((s) => s.id).filter(Boolean);
    } catch {
      ids = [];
    }
    // The API renders at most five sections per request.
    return [...new Set([...ids, ...DEFAULT_CART_SECTIONS])].slice(0, 5);
  };

  const sectionInnerHtml = (html) => {
    if (!html) return null;
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.querySelector(".shopify-section") ?? doc.body).innerHTML;
  };

  const notifyTheme = async (addResponse) => {
    const item = addResponse?.items?.[0] ?? addResponse ?? null;
    const sections = addResponse?.sections ?? null;

    // 1. Let the theme's own cart UI re-render (Dawn and descendants).
    let rendered = false;
    const cartEl = themeCartElement();
    if (sections && item && typeof cartEl?.renderContents === "function") {
      try {
        cartEl.classList.remove("is-empty");
        cartEl.renderContents({ ...item, sections });
        rendered = true;
      } catch {
        rendered = false;
      }
    }
    // 2. Otherwise at least refresh the header cart bubble.
    if (!rendered && sections?.["cart-icon-bubble"]) {
      const bubble = document.getElementById("cart-icon-bubble");
      const inner = sectionInnerHtml(sections["cart-icon-bubble"]);
      if (bubble && inner !== null) bubble.innerHTML = inner;
    }

    document.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true }));
    try {
      const cart = await (await fetch(cartJsUrl, { headers: { Accept: "application/json" } })).json();
      document.dispatchEvent(new CustomEvent("cart:updated", { bubbles: true, detail: { cart, item } }));
      // Dawn declares PUB_SUB_EVENTS and publish() as top-level bindings
      // of a classic script: global lexical scope, not window properties.
      /* global PUB_SUB_EVENTS, publish */
      const events = typeof PUB_SUB_EVENTS !== "undefined" ? PUB_SUB_EVENTS : window.PUB_SUB_EVENTS;
      const publishFn = typeof publish === "function" ? publish : window.publish;
      if (typeof publishFn === "function" && events?.cartUpdate) {
        publishFn(events.cartUpdate, { source: "reelup", productVariantId: item?.variant_id, cartData: cart });
      }
    } catch {
      // The add itself succeeded; a theme that can't be told just refreshes
      // its cart count on the next page view.
    }
  };

  const showStatus = (status, message, failed) => {
    if (!status) return;
    const text = status.querySelector(".reelup-cart-message");
    if (text) text.textContent = message;
    status.toggleAttribute("data-failed", failed);
    status.hidden = false;
  };

  document.addEventListener("click", (event) => {
    const step = event.target.closest?.("[data-reelup-qty-step]");
    if (!step) return;
    const input = step.closest("[data-reelup-qty]")?.querySelector("[data-reelup-qty-input]");
    if (!input) return;
    const next = (parseInt(input.value, 10) || 1) + Number(step.dataset.reelupQtyStep);
    input.value = String(Math.min(Math.max(next, 1), 99));
  });

  document.addEventListener("click", async (event) => {
    const link = event.target.closest?.("[data-reelup-product-link]");
    if (link) {
      trackAnalytics(reelIdFor(link), "click_product");
      return;
    }

    const button = event.target.closest?.("[data-reelup-add-to-cart]");
    if (!button || button.disabled || button.dataset.state === "loading") return;

    const reelId = reelIdFor(button);
    trackAnalytics(reelId, "click_product");

    const addLabel = button.dataset.addLabel ?? button.textContent;
    const scope = button.closest("[data-reelup-reel-id]");
    const status = scope?.querySelector("[data-reelup-cart-status]");
    button.dataset.state = "loading";
    button.setAttribute("aria-busy", "true");

    try {
      // _reelup_reel_id is a hidden line-item property (the underscore keeps
      // it out of the customer-facing cart/checkout); the orders/paid
      // webhook reads it back off the order to attribute revenue.
      const qtyInput = button.closest("[data-reelup-product]")?.querySelector("[data-reelup-qty-input]");
      const quantity = Math.min(Math.max(parseInt(qtyInput?.value ?? "1", 10) || 1, 1), 99);
      const body = {
        items: [{ id: Number(button.dataset.variantId), quantity }],
        sections: cartSections().join(","),
        sections_url: window.location.pathname,
      };
      if (reelId) body.items[0].properties = { _reelup_reel_id: reelId };
      const response = await fetch(cartAddUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        // Shopify explains stock problems ("You can only add 2 of …") in a
        // 4xx JSON `description`; only that is shopper-safe — network and
        // server errors fall back to the generic label.
        const problem = await response.json().catch(() => null);
        const shopify =
          response.status >= 400 && response.status < 500 && typeof problem?.description === "string"
            ? problem.description
            : "";
        throw Object.assign(new Error("add failed"), { shopperMessage: shopify });
      }
      const added = await response.json().catch(() => null);

      button.dataset.state = "added";
      button.textContent = button.dataset.addedLabel ?? addLabel;
      showStatus(status, labels.addedToCart, false);
      announce(button, labels.addedToCart);
      notifyTheme(added);
    } catch (error) {
      const message = error?.shopperMessage || labels.addFailed;
      button.dataset.state = "";
      button.textContent = addLabel;
      showStatus(status, message, true);
      announce(button, message);
      button.removeAttribute("aria-busy");
      return;
    }

    button.removeAttribute("aria-busy");
    setTimeout(() => {
      if (button.dataset.state !== "added") return;
      button.dataset.state = "";
      button.textContent = addLabel;
    }, 2200);
  });

  /* ------------------------------------------------ viewer settings */

  const CTA_STYLES = ["reelup-cta--pill", "reelup-cta--square", "reelup-cta--text-link"];

  // Viewers are shared singletons reused across every trigger on the page,
  // so every per-trigger setting is written unconditionally (set or
  // cleared) — never just set — or it would leak onto the next trigger.
  const applyViewerSettings = (dialog, video, titleEl, trigger) => {
    const vars = {
      "--ru-cta": trigger.dataset.ctaColor,
      "--ru-cta-text": trigger.dataset.ctaTextColor,
      "--ru-cta-hover": trigger.dataset.ctaHoverColor,
    };
    for (const [name, value] of Object.entries(vars)) {
      if (value) dialog.style.setProperty(name, value);
      else dialog.style.removeProperty(name);
    }
    dialog.classList.remove(...CTA_STYLES);
    const ctaStyle = ["pill", "square", "text-link"].includes(trigger.dataset.ctaStyle) ? trigger.dataset.ctaStyle : "pill";
    dialog.classList.add(`reelup-cta--${ctaStyle}`);

    const userMuted = getUserMuted();
    video.muted = userMuted ?? trigger.dataset.mutedDefault === "true";
    video.loop = trigger.dataset.loop === "true";
    if (titleEl) titleEl.hidden = trigger.dataset.showTitle === "false";
  };

  // Gives the dialog an accessible name even when the reel has no title.
  const nameDialog = (dialog, titleId, title) => {
    if (title) {
      dialog.setAttribute("aria-labelledby", titleId);
      dialog.removeAttribute("aria-label");
    } else {
      dialog.removeAttribute("aria-labelledby");
      dialog.setAttribute("aria-label", labels.video);
    }
  };

  const cloneProducts = (trigger, listEl) => {
    listEl.replaceChildren();
    const template = trigger.querySelector("template[data-reelup-products]");
    if (!template) return 0;
    listEl.appendChild(template.content.cloneNode(true));
    return listEl.querySelectorAll("[data-reelup-product]").length;
  };

  // Starts playback inside the gesture window (muted is always allowed),
  // then restores the wanted mute state once the source is attached —
  // attach() may await network fetches that outlast the user activation,
  // after which unmuted play() can be silently rejected.
  //
  // `isCurrent` is checked after every await: if the viewer closed or moved
  // on meanwhile, this call stops touching the video (returns false) so a
  // stale load can never start audio in a hidden dialog or re-mute the
  // newer reel. Throws only for real failures (not for supersession).
  const startPlayback = async (video, src, isCurrent = () => true) => {
    const desiredMuted = video.muted;
    video.muted = true;
    video.play().catch(() => {});
    try {
      await window.ReelupHls.attach(video, src);
    } catch (error) {
      if (error?.name === "AbortError" || !isCurrent()) return false;
      throw error;
    }
    if (!isCurrent()) return false;
    video.muted = desiredMuted;
    try {
      await video.play();
    } catch {
      if (!isCurrent()) return false;
      // Unmuted autoplay refused after all — keep playing muted rather than
      // leaving a frozen first frame.
      video.muted = true;
      await video.play().catch(() => {});
    }
    return isCurrent();
  };

  /* ----------------------------------------------- share + deep links */

  // ?reelup=<numeric id> on any page opens that reel once the page loads
  // (see reel-trigger.js). Only the numeric tail of the metaobject GID goes
  // in the URL.
  const shortId = (reelId) => String(reelId ?? "").split("/").pop();
  const shareUrlFor = (reelId) => {
    const url = new URL(window.location.href);
    url.searchParams.set("reelup", shortId(reelId));
    url.hash = "";
    return url.toString();
  };

  // The toast element is permanent (created with each viewer); it's purely
  // visual — the message is announced through the dialog's live region.
  const toast = (host, message) => {
    const el = host.querySelector(".reelup-toast");
    if (el) {
      el.textContent = message;
      el.classList.remove("is-visible");
      void el.offsetWidth;
      el.classList.add("is-visible");
    }
    announce(host, message);
  };

  const share = async (host, reelId, title) => {
    const url = shareUrlFor(reelId);
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(host, labels.linkCopied);
    } catch {
      window.prompt(labels.share, url);
    }
  };

  /* -------------------------------------------------- recommendations */

  // Shopify-style money formatting from shop.money_format, so prices match
  // the rest of the storefront ("{{amount_with_comma_separator}} €" etc.).
  const moneyFormat = decodeEntities(String(config.moneyFormat || "${{amount}}").replace(/<[^>]*>/g, ""));
  const formatMoney = (cents) => {
    const value = Number(cents) || 0;
    const formatWith = (decimals, thousands = ",", decimal = ".") => {
      const [whole, fraction] = (value / 100).toFixed(decimals).split(".");
      return whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands) + (fraction ? decimal + fraction : "");
    };
    const match = moneyFormat.match(/\{\{\s*(\w+)\s*\}\}/);
    if (!match) return formatWith(2);
    let amount;
    switch (match[1]) {
      case "amount_no_decimals":
        amount = formatWith(0);
        break;
      case "amount_with_comma_separator":
        amount = formatWith(2, ".", ",");
        break;
      case "amount_no_decimals_with_comma_separator":
        amount = formatWith(0, ".", ",");
        break;
      case "amount_with_apostrophe_separator":
        amount = formatWith(2, "'", ".");
        break;
      case "amount_no_decimals_with_space_separator":
        amount = formatWith(0, " ", ",");
        break;
      case "amount_with_space_separator":
        amount = formatWith(2, " ", ",");
        break;
      default:
        amount = formatWith(2);
    }
    return moneyFormat.replace(match[0], amount);
  };

  const recsCache = new Map();
  const fetchRecommendations = (productId) => {
    if (!recsCache.has(productId)) {
      const url = `${recommendationsUrl}?product_id=${encodeURIComponent(productId)}&limit=8&intent=related`;
      recsCache.set(
        productId,
        fetch(url, { headers: { Accept: "application/json" } })
          .then((r) => (r.ok ? r.json() : { products: [] }))
          .then((data) => data.products ?? [])
          .catch(() => []),
      );
    }
    return recsCache.get(productId);
  };

  // Fills `container` with related products for the first tagged product,
  // skipping anything already tagged. `isCurrent` guards against a slow
  // response landing after the shopper has moved to another reel.
  const renderRecommendations = async (container, listEl, isCurrent) => {
    const row = container.querySelector("[data-reelup-recs-row]");
    container.hidden = true;
    row.replaceChildren();
    const cards = Array.from(listEl.querySelectorAll("[data-reelup-product]"));
    const firstId = cards[0]?.dataset.productId;
    if (!firstId) return;
    const tagged = new Set(cards.map((c) => c.dataset.productId));
    const products = (await fetchRecommendations(firstId)).filter((p) => !tagged.has(String(p.id))).slice(0, 6);
    if (!isCurrent() || products.length === 0) return;
    row.innerHTML = products
      .map((p) => {
        const href = safeLink(p.url) || "#";
        const rawImage = typeof p.featured_image === "string" ? p.featured_image : "";
        const image = rawImage ? `${rawImage}${rawImage.includes("?") ? "&" : "?"}width=240` : "";
        return `<a class="reelup-rec" href="${escapeHtml(href)}" data-reelup-product-link>
          <span class="reelup-rec__media">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" width="120" height="120">` : ""}</span>
          <span class="reelup-rec__title">${escapeHtml(p.title)}</span>
          <span class="reelup-rec__price">${escapeHtml(formatMoney(p.price))}</span>
        </a>`;
      })
      .join("");
    container.hidden = false;
  };

  /* ------------------------------------------------------------ icons */

  const icon = (path, size = 20) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true" focusable="false">${path}</svg>`;
  const ICONS = {
    play: icon('<path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z"/>', 28),
    pause: icon('<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>', 28),
    playSmall: icon('<path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z"/>', 18),
    pauseSmall: icon('<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>', 18),
    muted: icon('<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 6 6m0-6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'),
    unmuted: icon('<path d="M11 5 6 9H3v6h3l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7l-1.4-1.4a3 3 0 0 0 0-4.2l1.4-1.4Zm2.8-2.8a9 9 0 0 1 0 12.6l-1.4-1.4a7 7 0 0 0 0-9.8l1.4-1.4Z"/>'),
    close: icon('<path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z"/>'),
    up: icon('<path d="m12 7.6 6.7 6.7-1.4 1.4-5.3-5.3-5.3 5.3-1.4-1.4L12 7.6Z"/>'),
    down: icon('<path d="m12 16.4-6.7-6.7 1.4-1.4 5.3 5.3 5.3-5.3 1.4 1.4-6.7 6.7Z"/>'),
    share: icon('<path d="M12 3 7.5 7.5l1.4 1.4L11 6.8V15h2V6.8l2.1 2.1 1.4-1.4L12 3ZM5 13v6.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V13h-2v6H7v-6H5Z"/>'),
    bag: icon('<path d="M7 7a5 5 0 0 1 10 0h3l-1 14H5L4 7h3Zm2 0h6a3 3 0 0 0-6 0Z"/>', 16),
  };

  /* ------------------------------------------------------------ viewer */

  let group = [];
  let index = 0;
  let initialPanelState = "peek";
  // Bumped by every load() and by close: async work started for an older
  // value must not touch the (shared) video element any more.
  let loadSeq = 0;

  const mobileQuery = window.matchMedia("(max-width: 749px)");
  const isMobile = () => mobileQuery.matches;

  const buildViewer = () => {
    const existing = document.getElementById("reelup-lightbox");
    if (existing) return existing;

    const L = Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, escapeHtml(v)]));
    const dialog = document.createElement("dialog");
    dialog.id = "reelup-lightbox";
    dialog.className = `reelup-viewer${config.viewerTheme === "light" ? " reelup-viewer--light" : ""}`;
    dialog.setAttribute("aria-labelledby", "reelup-viewer-title");
    dialog.innerHTML = `
      <div class="reelup-viewer__stage">
        <div class="reelup-viewer__player" data-reelup-player>
          <video class="reelup-viewer__video" playsinline preload="auto"></video>
          <div class="reelup-viewer__shade" aria-hidden="true"></div>
          <div class="reelup-viewer__progress" aria-hidden="true"><span data-reelup-progress></span></div>
          <div class="reelup-viewer__top">
            <span class="reelup-viewer__count" data-reelup-count hidden></span>
            <button type="button" class="reelup-viewer__icon" data-reelup-share aria-label="${L.share}" hidden>${ICONS.share}</button>
            <button type="button" class="reelup-viewer__icon" data-reelup-mute></button>
            <button type="button" class="reelup-viewer__icon" data-reelup-close aria-label="${L.close}">${ICONS.close}</button>
          </div>
          <button type="button" class="reelup-viewer__toggle" data-reelup-play-pause aria-label="${L.play}">${ICONS.play}</button>
          <div class="reelup-viewer__error" data-reelup-error hidden>
            <p>${L.playbackError}</p>
            <button type="button" data-reelup-retry>${L.retry}</button>
          </div>
          <h2 class="reelup-viewer__title" id="reelup-viewer-title"></h2>
          <div class="reelup-toast" aria-hidden="true"></div>
        </div>
        <aside class="reelup-viewer__panel" data-reelup-panel hidden>
          <button type="button" class="reelup-viewer__panel-head" data-reelup-panel-toggle aria-expanded="true">
            ${ICONS.bag}
            <span class="reelup-viewer__panel-title">${L.shop}</span>
            <span class="reelup-viewer__panel-count" data-reelup-panel-count></span>
            <span class="reelup-viewer__chevron" aria-hidden="true">${ICONS.up}</span>
          </button>
          <div class="reelup-viewer__list" data-reelup-list></div>
          <section class="reelup-viewer__recs" data-reelup-recs hidden>
            <h3 class="reelup-viewer__recs-title">${L.youMayLike}</h3>
            <div class="reelup-viewer__recs-row" data-reelup-recs-row></div>
          </section>
          <a class="reelup-viewer__link" data-reelup-link data-reelup-product-link hidden></a>
          <p class="reelup-viewer__cart" data-reelup-cart-status hidden>
            <span class="reelup-cart-message"></span>
            <a href="${escapeHtml(cartUrl)}">${L.viewCart}</a>
          </p>
        </aside>
      </div>
      <div class="reelup-viewer__nav" data-reelup-nav hidden>
        <button type="button" class="reelup-viewer__navbtn" data-reelup-prev aria-label="${L.previous}">${ICONS.up}</button>
        <button type="button" class="reelup-viewer__navbtn" data-reelup-next aria-label="${L.next}">${ICONS.down}</button>
      </div>
    `;
    dialog.appendChild(makeLiveRegion());
    document.body.appendChild(dialog);

    const video = dialog.querySelector("video");
    const player = dialog.querySelector("[data-reelup-player]");
    const toggle = dialog.querySelector("[data-reelup-play-pause]");
    const mute = dialog.querySelector("[data-reelup-mute]");
    const progress = dialog.querySelector("[data-reelup-progress]");
    const panel = dialog.querySelector("[data-reelup-panel]");
    const panelToggle = dialog.querySelector("[data-reelup-panel-toggle]");
    const cartStatus = dialog.querySelector("[data-reelup-cart-status]");
    const errorBox = dialog.querySelector("[data-reelup-error]");

    const syncPlayState = () => {
      toggle.innerHTML = video.paused ? ICONS.play : ICONS.pause;
      toggle.setAttribute("aria-label", video.paused ? labels.play : labels.pause);
      player.classList.toggle("is-paused", video.paused);
    };
    const syncMute = () => {
      mute.innerHTML = video.muted ? ICONS.muted : ICONS.unmuted;
      mute.setAttribute("aria-label", video.muted ? labels.unmute : labels.mute);
    };
    video.addEventListener("play", syncPlayState);
    video.addEventListener("pause", syncPlayState);
    video.addEventListener("volumechange", syncMute);
    video.addEventListener("timeupdate", () => {
      const ratio = video.duration ? video.currentTime / video.duration : 0;
      progress.style.transform = `scaleX(${ratio})`;
    });
    video.addEventListener("ended", () => {
      if (dialog.open && !video.loop && index < group.length - 1) go(1);
    });

    const showError = () => {
      if (!dialog.open) return;
      errorBox.hidden = false;
      announce(dialog, labels.playbackError);
    };
    video.addEventListener("reelup:playback-error", showError);
    video.addEventListener("error", () => {
      // Native HLS errors (Safari); ignore the empty-src error from teardown.
      if (video.getAttribute("src")) showError();
    });
    dialog.querySelector("[data-reelup-retry]").addEventListener("click", () => {
      if (group[index]) load(dialog, group[index]);
    });

    const togglePlayback = () => (video.paused ? video.play().catch(() => {}) : video.pause());
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePlayback();
    });
    video.addEventListener("click", togglePlayback);
    mute.addEventListener("click", () => {
      video.muted = !video.muted;
      setUserMuted(video.muted);
    });
    dialog.querySelector("[data-reelup-close]").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-reelup-share]").addEventListener("click", () => {
      const trigger = group[index];
      if (trigger) share(player, trigger.dataset.reelId, trigger.dataset.title || document.title);
    });
    dialog.querySelector("[data-reelup-prev]").addEventListener("click", () => go(-1));
    dialog.querySelector("[data-reelup-next]").addEventListener("click", () => go(1));

    // On mobile the "peek" sheet clips everything below the first product,
    // so those rows (and anything after the list) are made inert until the
    // sheet is expanded — no tabbing into invisible controls.
    const syncPeekInert = () => {
      const collapsed = panel.dataset.state === "peek" && isMobile();
      dialog.querySelectorAll("[data-reelup-list] [data-reelup-product]").forEach((row, i) => {
        row.inert = collapsed && i > 0;
      });
      const linkEl = dialog.querySelector("[data-reelup-link]");
      const hasProducts = Boolean(dialog.querySelector("[data-reelup-list] [data-reelup-product]"));
      linkEl.inert = collapsed && hasProducts;
    };
    const setPanelState = (state) => {
      panel.dataset.state = state;
      panelToggle.setAttribute("aria-expanded", String(state === "open" || (state === "peek" && !isMobile())));
      syncPeekInert();
    };
    mobileQuery.addEventListener?.("change", () => {
      if (dialog.open) setPanelState(panel.dataset.state || initialPanelState);
    });
    panelToggle.addEventListener("click", () => {
      const open = panel.dataset.state === "open" || (panel.dataset.state === "peek" && !isMobile());
      setPanelState(open ? (initialPanelState === "open" ? "closed" : initialPanelState) : "open");
    });
    dialog.setPanelState = setPanelState;

    // Backdrop click closes; a click on the stage gutter counts as backdrop.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.classList?.contains("reelup-viewer__stage")) dialog.close();
    });

    dialog.addEventListener("keydown", (event) => {
      if (event.target.closest?.("select, input, textarea")) return;
      // Horizontal arrows follow reading direction.
      const rtl = isRtl(dialog);
      const nextKeys = ["ArrowDown", rtl ? "ArrowLeft" : "ArrowRight"];
      const prevKeys = ["ArrowUp", rtl ? "ArrowRight" : "ArrowLeft"];
      if (nextKeys.includes(event.key)) {
        event.preventDefault();
        go(1);
      } else if (prevKeys.includes(event.key)) {
        event.preventDefault();
        go(-1);
      }
    });

    // Vertical swipe on the player moves through the group (mobile).
    let startY = null;
    player.addEventListener("touchstart", (event) => {
      startY = event.touches[0].clientY;
    }, { passive: true });
    player.addEventListener("touchend", (event) => {
      if (startY === null) return;
      const dy = event.changedTouches[0].clientY - startY;
      startY = null;
      if (Math.abs(dy) > 60) go(dy < 0 ? 1 : -1);
    });

    dialog.addEventListener("close", () => {
      loadSeq += 1;
      window.ReelupHls?.teardown(video);
      dialog.querySelector("[data-reelup-list]").replaceChildren();
      cartStatus.hidden = true;
      errorBox.hidden = true;
      document.documentElement.classList.remove("reelup-locked");
      document.dispatchEvent(new CustomEvent("reelup:viewer-change"));
      const lastTrigger = group[index];
      group = [];
      // Lets a deck bring the last viewed reel to the front before focus
      // returns to it (its button may be tabindex=-1 / aria-hidden now).
      if (lastTrigger) document.dispatchEvent(new CustomEvent("reelup:viewer-closed", { detail: { trigger: lastTrigger } }));
      lastTrigger?.querySelector(".reelup-trigger__button")?.focus({ preventScroll: true });
    });

    syncMute();
    return dialog;
  };

  const load = async (dialog, trigger) => {
    const token = ++loadSeq;
    const isCurrent = () => dialog.open && token === loadSeq;
    const video = dialog.querySelector("video");
    const title = dialog.querySelector(".reelup-viewer__title");
    const panel = dialog.querySelector("[data-reelup-panel]");
    const list = dialog.querySelector("[data-reelup-list]");
    const count = dialog.querySelector("[data-reelup-count]");
    const cartStatus = dialog.querySelector("[data-reelup-cart-status]");

    window.ReelupHls?.teardown(video);
    dialog.querySelector("[data-reelup-error]").hidden = true;
    const reelId = trigger.dataset.reelId ?? "";
    dialog.setAttribute("data-reelup-reel-id", reelId);
    title.textContent = trigger.dataset.title ?? "";
    nameDialog(dialog, "reelup-viewer-title", trigger.dataset.title);
    if (trigger.dataset.posterUrl) video.setAttribute("poster", trigger.dataset.posterUrl);
    else video.removeAttribute("poster");
    dialog.querySelector("[data-reelup-progress]").style.transform = "scaleX(0)";

    applyViewerSettings(dialog, video, title, trigger);
    video.dispatchEvent(new Event("volumechange"));

    const productCount = cloneProducts(trigger, list);
    const linkUrl = safeLink(trigger.dataset.linkUrl);
    const linkEl = dialog.querySelector("[data-reelup-link]");
    linkEl.hidden = !linkUrl;
    if (linkUrl) {
      linkEl.href = linkUrl;
      linkEl.textContent = trigger.dataset.linkLabel || labels.learnMore;
    } else {
      linkEl.removeAttribute("href");
    }
    panel.hidden = productCount === 0 && !linkUrl;
    dialog.classList.toggle("has-products", !panel.hidden);
    dialog.querySelector("[data-reelup-panel-toggle]").hidden = productCount === 0;
    dialog.querySelector("[data-reelup-panel-count]").textContent = productCount > 1 ? String(productCount) : "";
    initialPanelState = trigger.dataset.tagRevealMode === "tap" ? "closed" : "peek";
    dialog.setPanelState(initialPanelState);
    cartStatus.hidden = true;
    dialog.querySelector("[data-reelup-share]").hidden = trigger.dataset.showShare === "false";

    const recs = dialog.querySelector("[data-reelup-recs]");
    if (trigger.dataset.showRecommendations === "false" || productCount === 0) {
      recs.hidden = true;
    } else {
      renderRecommendations(recs, list, isCurrent);
    }

    const nav = dialog.querySelector("[data-reelup-nav]");
    nav.hidden = group.length < 2;
    count.hidden = group.length < 2;
    count.textContent = labels.of.replace("__CURRENT__", String(index + 1)).replace("__TOTAL__", String(group.length));
    dialog.querySelector("[data-reelup-prev]").disabled = index === 0;
    dialog.querySelector("[data-reelup-next]").disabled = index === group.length - 1;

    trackAnalytics(reelId, "view");
    try {
      await startPlayback(video, trigger.dataset.hlsSrc, isCurrent);
    } catch {
      // Playback failed to start; the poster and product list stay usable,
      // and the shopper gets a retry button.
      if (isCurrent()) {
        dialog.querySelector("[data-reelup-error]").hidden = false;
        announce(dialog, labels.playbackError);
      }
    }
    if (!dialog.open) {
      // Closed while loading: make sure nothing keeps playing in the
      // hidden dialog (close already tore down; this is belt and braces).
      window.ReelupHls?.teardown(video);
    }
  };

  const go = (delta) => {
    const dialog = document.getElementById("reelup-lightbox");
    const next = index + delta;
    if (!dialog?.open || next < 0 || next >= group.length) return;
    index = next;
    load(dialog, group[index]);
  };

  // `triggers` is the ordered set the opened reel belongs to (a filmstrip or
  // deck); a standalone reel passes nothing and gets no next/previous.
  const open = (trigger, triggers) => {
    if (!trigger?.dataset.hlsSrc) return;
    const dialog = buildViewer();
    group = triggers && triggers.length ? triggers : [trigger];
    index = Math.max(group.indexOf(trigger), 0);
    if (!dialog.open) {
      dialog.showModal();
      document.documentElement.classList.add("reelup-locked");
      document.dispatchEvent(new CustomEvent("reelup:viewer-change"));
      // Start keyboard and screen-reader users on a predictable control.
      dialog.querySelector("[data-reelup-close]")?.focus();
    }
    load(dialog, trigger);
  };

  window.ReelupLightbox = { open, trackAnalytics };
  window.ReelupViewer = {
    labels,
    cartUrl,
    share,
    shortId,
    safeLink,
    escapeHtml,
    isRtl,
    announce,
    makeLiveRegion,
    nameDialog,
    getUserMuted,
    setUserMuted,
    formatMoney,
    theme: config.viewerTheme === "light" ? "light" : "dark",
    icons: ICONS,
    applyViewerSettings,
    cloneProducts,
    startPlayback,
    trackAnalytics,
  };
})();
