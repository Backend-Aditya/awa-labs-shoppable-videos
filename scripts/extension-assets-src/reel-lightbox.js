// Shared storefront runtime: config/labels, analytics (the app's own, plus
// Shopify customer events and connected tools via reel-tracking.js), the
// delegated product-card behaviour (variant picker + add to cart, used by the video
// viewer, the story drawer and the featured-video block alike), and the
// video viewer itself.
(() => {
  // This file can be loaded twice on one page (app embed + a block's
  // loader when both are present). Everything below, including the
  // document-level delegated cart listeners, must exist exactly once, or
  // one click would add the product to the cart twice.
  if (window.AwaSvLightbox) return;

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
    const el = document.querySelector("script[data-awa-sv-config]") ?? document.getElementById("awa-sv-config");
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
    shopProduct: "Shop",
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
    seek: "Video progress",
    of: "__CURRENT__ of __TOTAL__",
    description: "Description",
    viewDetails: "View full details",
    backToProducts: "Back to products",
    productDetails: "Product details",
    soldOut: "Sold out",
    addToCart: "Add to cart",
    added: "Added",
    percentOff: "__PERCENT__% OFF",
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

  // Views and completions count once per reel per 30 minutes in a tab, so
  // replaying, swiping back and forth or reopening doesn't inflate numbers
  // (or plan usage), and completion rates stay comparable to view counts.
  const COUNT_WINDOW_MS = 30 * 60 * 1000;
  const COUNTED_ONCE = { view: "viewed", complete: "completed" };
  const recentlyCounted = (eventType, reelId) => {
    try {
      const key = `awa-sv-${COUNTED_ONCE[eventType]}-${reelId}`;
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last < COUNT_WINDOW_MS) return true;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // Storage unavailable: count it.
    }
    return false;
  };

  // The app's own event types, and what reel-tracking.js calls them for
  // everyone else. "watch" (seconds played) is the app's metric alone.
  const PUBLIC_EVENTS = { view: "video_view", complete: "video_complete", click_product: "product_click", add_to_cart: "add_to_cart" };

  // Every shopper action the widgets report. `detail.trigger` is the reel's
  // trigger (title and widget for connected tools, and the widget for the
  // app's per-widget numbers), `detail.seconds` the watch time,
  // `detail.product_id` the product for the per-product numbers; anything
  // else goes to connected tools as is.
  const trackAnalytics = (reelId, eventType, detail = {}) => {
    if (!reelId) return;
    if (COUNTED_ONCE[eventType] && recentlyCounted(eventType, reelId)) return;
    const { trigger, seconds, ...extra } = detail;
    const body = { shopDomain: window.Shopify?.shop, reelId, eventType };
    if (eventType === "watch") body.seconds = seconds;
    if (trigger?.dataset.source) body.source = trigger.dataset.source;
    if (extra.product_id) body.productId = String(extra.product_id);
    fetch("/apps/reels/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
    if (PUBLIC_EVENTS[eventType]) {
      window.AwaSvTracking?.track(PUBLIC_EVENTS[eventType], {
        reel_id: String(reelId).split("/").pop(),
        reel_title: trigger?.dataset.title,
        widget: trigger?.dataset.source,
        ...extra,
      });
    }
  };

  // Watch time and completion of whatever reel `video` shows (the id from
  // `currentReelId`, its trigger from `currentTrigger`). Completion counts
  // at 95% or the end; watch time counts real playback only (seeks and
  // loops back to the start add nothing) and is reported by flush() when
  // the shopper moves on, closes, or leaves the page.
  const COMPLETE_AT = 0.95;
  const watchProgress = (video, currentReelId, currentTrigger) => {
    let seconds = 0;
    let last = null;
    let completed = false;
    const complete = () => {
      if (completed) return;
      completed = true;
      trackAnalytics(currentReelId(), "complete", { trigger: currentTrigger() });
    };
    video.addEventListener("seeking", () => {
      last = null;
    });
    video.addEventListener("timeupdate", () => {
      const now = video.currentTime;
      if (last !== null && !video.paused) {
        const delta = now - last;
        if (delta > 0 && delta < 1.5) seconds += delta;
      }
      last = now;
      if (video.duration > 0 && Number.isFinite(video.duration) && now / video.duration >= COMPLETE_AT) complete();
    });
    video.addEventListener("ended", complete);
    const flush = () => {
      const reelId = currentReelId();
      if (reelId && seconds >= 1) trackAnalytics(reelId, "watch", { seconds: Math.round(seconds) });
      seconds = 0;
      last = null;
      completed = false;
    };
    window.addEventListener("pagehide", flush);
    return { flush };
  };

  const safeLink = (value) => {
    const url = String(value ?? "").trim();
    // A lone "/" is a same-site path; "//host" and "/\host" are off-site.
    return /^(https?:\/\/|\/(?![/\\]))/i.test(url) ? url : "";
  };

  const reelIdFor = (el) => el.closest("[data-awa-sv-reel-id]")?.getAttribute("data-awa-sv-reel-id") ?? "";
  // The trigger behind an element's events: the reel on screen in a
  // viewer, or the featured-video block's own video.
  const triggerFor = (el) => {
    const host = el.closest("[data-awa-sv-reel-id]");
    return host?.awaSvTrigger ?? host?.closest(".awa-sv")?.querySelector("[data-awa-sv-trigger]") ?? null;
  };

  /* ------------------------------------------- shopper mute preference */

  // Once the shopper touches a mute button, that choice sticks for the
  // session and overrides each widget's mutedDefault.
  const MUTE_KEY = "awa-sv-muted";
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
    el.className = "awa-sv-live";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    el.dataset.awaSvLive = "";
    return el;
  };
  const pageLive = makeLiveRegion();
  const mountPageLive = () => document.body && !pageLive.isConnected && document.body.appendChild(pageLive);
  if (document.body) mountPageLive();
  else document.addEventListener("DOMContentLoaded", mountPageLive, { once: true });

  const announce = (scope, message) => {
    const region = scope?.closest?.("dialog")?.querySelector("[data-awa-sv-live]") ?? pageLive;
    region.textContent = "";
    // A tick between clear and set makes repeated identical messages
    // announce again.
    setTimeout(() => {
      region.textContent = message;
    }, 60);
  };

  /* ----------------------------------------------- product card + cart */

  // Variant picker: keeps the card's price, compare-at price, sale badge,
  // image and add button in step with the chosen option.
  document.addEventListener("change", (event) => {
    const select = event.target.closest?.("[data-awa-sv-variant]");
    if (!select) return;
    const card = select.closest("[data-awa-sv-product]");
    const option = select.selectedOptions[0];
    if (!card || !option) return;

    const price = card.querySelector("[data-awa-sv-price]");
    if (price && option.dataset.price) price.textContent = option.dataset.price;
    const compare = card.querySelector("[data-awa-sv-compare]");
    if (compare) {
      compare.textContent = option.dataset.compare ?? "";
      compare.hidden = !option.dataset.compare;
    }
    const badge = card.querySelector("[data-awa-sv-badge]");
    if (badge) {
      badge.textContent = option.dataset.discount ? `−${option.dataset.discount}%` : "";
      badge.hidden = !option.dataset.discount;
    }
    const image = card.querySelector(".awa-sv-product__media img");
    if (image && option.dataset.image) {
      image.removeAttribute("srcset");
      image.src = option.dataset.image;
    }
    const button = card.querySelector("[data-awa-sv-add-to-cart]");
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
        publishFn(events.cartUpdate, { source: "awa-sv", productVariantId: item?.variant_id, cartData: cart });
      }
    } catch {
      // The add itself succeeded; a theme that can't be told just refreshes
      // its cart count on the next page view.
    }
  };

  // What a successful add leads to: the widget's "After adding to cart".
  // "cart": Dawn-family themes' drawer or notification was just opened by
  // notifyTheme, so a viewer steps aside to reveal it; other themes go to
  // the cart page. "checkout" goes straight there. "stay" (the default)
  // keeps the shopper watching.
  const afterAdd = (button, trigger) => {
    const action = trigger?.dataset.afterAdd;
    if (action === "checkout") {
      window.AwaSvViewer.navigate("/checkout");
    } else if (action === "cart") {
      if (typeof themeCartElement()?.renderContents === "function") button.closest("dialog")?.close();
      else window.AwaSvViewer.navigate(cartUrl);
    }
  };

  const showStatus = (status, message, failed) => {
    if (!status) return;
    const text = status.querySelector(".awa-sv-cart-message");
    if (text) text.textContent = message;
    status.toggleAttribute("data-failed", failed);
    status.hidden = false;
  };

  document.addEventListener("click", (event) => {
    const step = event.target.closest?.("[data-awa-sv-qty-step]");
    if (!step) return;
    const input = step.closest("[data-awa-sv-qty]")?.querySelector("[data-awa-sv-qty-input]");
    if (!input) return;
    const next = (parseInt(input.value, 10) || 1) + Number(step.dataset.awaSvQtyStep);
    input.value = String(Math.min(Math.max(next, 1), 99));
  });

  document.addEventListener("click", async (event) => {
    const link = event.target.closest?.("[data-awa-sv-product-link]");
    if (link) {
      trackAnalytics(reelIdFor(link), "click_product", {
        trigger: triggerFor(link),
        product_id: link.closest("[data-awa-sv-product]")?.dataset.productId,
      });
      return;
    }

    const button = event.target.closest?.("[data-awa-sv-add-to-cart]");
    if (!button || button.disabled || button.dataset.state === "loading") return;

    const reelId = reelIdFor(button);
    const trigger = triggerFor(button);
    const productId = button.closest("[data-awa-sv-product]")?.dataset.productId;
    trackAnalytics(reelId, "click_product", { trigger, product_id: productId });

    const addLabel = button.dataset.addLabel ?? button.textContent;
    const scope = button.closest("[data-awa-sv-reel-id]");
    const status = scope?.querySelector("[data-awa-sv-cart-status]");
    button.dataset.state = "loading";
    button.setAttribute("aria-busy", "true");

    try {
      // _awa_sv_reel_id is a hidden line-item property (the underscore keeps
      // it out of the customer-facing cart/checkout); the orders/paid
      // webhook reads it back off the order to attribute revenue.
      const qtyInput = button.closest("[data-awa-sv-product]")?.querySelector("[data-awa-sv-qty-input]");
      const quantity = Math.min(Math.max(parseInt(qtyInput?.value ?? "1", 10) || 1, 1), 99);
      const body = {
        items: [{ id: Number(button.dataset.variantId), quantity }],
        sections: cartSections().join(","),
        sections_url: window.location.pathname,
      };
      if (reelId) body.items[0].properties = { _awa_sv_reel_id: reelId };
      const response = await fetch(cartAddUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        // Shopify explains stock problems ("You can only add 2 of …") in a
        // 4xx JSON `description`; only that is shopper-safe, network and
        // server errors fall back to the generic label.
        const problem = await response.json().catch(() => null);
        const shopify =
          response.status >= 400 && response.status < 500 && typeof problem?.description === "string"
            ? problem.description
            : "";
        throw Object.assign(new Error("add failed"), { shopperMessage: shopify });
      }
      const added = await response.json().catch(() => null);
      const line = added?.items?.[0];
      const cents = Number(line?.final_line_price ?? (line?.price ?? 0) * quantity) || 0;

      button.dataset.state = "added";
      // Counted only once Shopify accepted the line; click_product above fires
      // on the click itself, so it also includes adds that failed.
      trackAnalytics(reelId, "add_to_cart", {
        trigger,
        product_id: productId ?? line?.product_id,
        variant_id: button.dataset.variantId,
        quantity,
        value: cents ? cents / 100 : undefined,
        currency: config.currency,
      });
      button.textContent = button.dataset.addedLabel ?? addLabel;
      showStatus(status, labels.addedToCart, false);
      announce(button, labels.addedToCart);
      notifyTheme(added);
      afterAdd(button, trigger);
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

  const CTA_STYLES = ["awa-sv-cta--pill", "awa-sv-cta--square", "awa-sv-cta--text-link"];

  // Viewers are shared singletons reused across every trigger on the page,
  // so every per-trigger setting is written unconditionally (set or
  // cleared), never just set, or it would leak onto the next trigger.
  const applyViewerSettings = (dialog, video, titleEl, trigger) => {
    const vars = {
      "--awa-sv-cta": trigger.dataset.ctaColor,
      "--awa-sv-cta-text": trigger.dataset.ctaTextColor,
      "--awa-sv-cta-hover": trigger.dataset.ctaHoverColor,
    };
    for (const [name, value] of Object.entries(vars)) {
      if (value) dialog.style.setProperty(name, value);
      else dialog.style.removeProperty(name);
    }
    dialog.classList.remove(...CTA_STYLES);
    const ctaStyle = ["pill", "square", "text-link"].includes(trigger.dataset.ctaStyle) ? trigger.dataset.ctaStyle : "pill";
    dialog.classList.add(`awa-sv-cta--${ctaStyle}`);

    const userMuted = getUserMuted();
    video.muted = userMuted ?? trigger.dataset.mutedDefault === "true";
    video.loop = trigger.dataset.loop === "true";
    if (titleEl) titleEl.hidden = trigger.dataset.showTitle === "false";
    dialog.classList.toggle("awa-sv-products--large", trigger.dataset.productImageSize === "large");
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
    const template = trigger.querySelector("template[data-awa-sv-products]");
    if (!template) return 0;
    listEl.appendChild(template.content.cloneNode(true));
    return listEl.querySelectorAll("[data-awa-sv-product]").length;
  };

  // Starts playback inside the gesture window (muted is always allowed),
  // then restores the wanted mute state once the source is attached,
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
      await window.AwaSvHls.attach(video, src);
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
      // Unmuted autoplay refused after all, keep playing muted rather than
      // leaving a frozen first frame.
      video.muted = true;
      await video.play().catch(() => {});
    }
    return isCurrent();
  };

  // Spinner over a stalled video (`is-buffering` on `host`): shown while the
  // video should be playing but has nothing to show, after a grace period
  // so a brief wait never flashes it; never over a paused or failed video.
  // State is re-derived on every media event rather than toggled per event,
  // so events arriving late from a torn-down source can't leave it stuck.
  const HAVE_FUTURE_DATA = 3;
  const BUFFER_GRACE_MS = 400;
  const watchBuffering = (video, host) => {
    let failed = false;
    let timer = null;
    const stalled = () => !failed && !video.paused && !video.ended && video.readyState < HAVE_FUTURE_DATA;
    const sync = () => {
      if (!stalled()) {
        clearTimeout(timer);
        timer = null;
        host.classList.remove("is-buffering");
        return;
      }
      if (timer !== null || host.classList.contains("is-buffering")) return;
      timer = setTimeout(() => {
        timer = null;
        host.classList.toggle("is-buffering", stalled());
      }, BUFFER_GRACE_MS);
    };
    const fail = () => {
      failed = true;
      sync();
    };
    ["play", "playing", "waiting", "canplay", "pause", "seeking", "seeked", "ended", "emptied"].forEach((type) =>
      video.addEventListener(type, sync),
    );
    video.addEventListener("awa-sv:playback-error", fail);
    video.addEventListener("error", () => {
      // An empty-src error comes from teardown, not from the reel.
      if (video.getAttribute("src")) fail();
    });
    return {
      // A new source is on its way.
      reset: () => {
        failed = false;
        sync();
      },
      fail,
    };
  };

  /* ------------------------------------------------- product moments */

  // A reel can time each tagged product (the reel editor's "Product
  // moments"): data-product-times maps product id → second. A moment lasts
  // MOMENT_SECONDS; when two overlap, the later one wins.
  const MOMENT_SECONDS = 5;
  const productMoments = (trigger, listEl) => {
    let times = {};
    try {
      times = JSON.parse(trigger?.dataset.productTimes || "{}") ?? {};
    } catch {
      times = {};
    }
    return Array.from(listEl.querySelectorAll("[data-awa-sv-product]"))
      .map((card) => ({ card, at: Number(times[card.dataset.productId]) }))
      .filter((moment) => Number.isFinite(moment.at) && moment.at >= 0)
      .sort((a, b) => a.at - b.at);
  };
  const currentMoment = (moments, time) => {
    let current = null;
    for (const moment of moments) if (moment.at <= time && time < moment.at + MOMENT_SECONDS) current = moment;
    return current;
  };

  /* ----------------------------------------------- share + deep links */

  // ?awa-sv=<numeric id> on any page opens that reel once the page loads
  // (see reel-trigger.js). Only the numeric tail of the metaobject GID goes
  // in the URL.
  const shortId = (reelId) => String(reelId ?? "").split("/").pop();
  const shareUrlFor = (reelId) => {
    const url = new URL(window.location.href);
    url.searchParams.set("awa-sv", shortId(reelId));
    url.hash = "";
    return url.toString();
  };

  // The toast element is permanent (created with each viewer); it's purely
  // visual, the message is announced through the dialog's live region.
  const toast = (host, message) => {
    const el = host.querySelector(".awa-sv-toast");
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
    const row = container.querySelector("[data-awa-sv-recs-row]");
    container.hidden = true;
    row.replaceChildren();
    const cards = Array.from(listEl.querySelectorAll("[data-awa-sv-product]"));
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
        return `<a class="awa-sv-rec" href="${escapeHtml(href)}" data-awa-sv-product-link>
          <span class="awa-sv-rec__media">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" width="120" height="120">` : ""}</span>
          <span class="awa-sv-rec__title">${escapeHtml(p.title)}</span>
          <span class="awa-sv-rec__price">${escapeHtml(formatMoney(p.price))}</span>
        </a>`;
      })
      .join("");
    container.hidden = false;
  };

  /* -------------------------------------------------- product details */

  // A product's full page, inside the viewer: tapping a product (when the
  // widget turns it on) swaps the panel's list for its gallery, price,
  // option buttons, add to cart and description, so shoppers never leave
  // the video. Data comes from Shopify's Ajax product endpoint
  // (`/products/<handle>.js`, locale-aware via the card's product.url), so
  // nothing extra is rendered into every reel's template.
  const productCache = new Map();
  const fetchProduct = (url) => {
    const key = url.split(/[?#]/)[0];
    if (!productCache.has(key)) {
      const request = fetch(`${key}.js`, { headers: { Accept: "application/json" } }).then((r) => {
        if (!r.ok) throw new Error(`product ${r.status}`);
        return r.json();
      });
      request.catch(() => productCache.delete(key));
      productCache.set(key, request);
    }
    return productCache.get(key);
  };

  const sizedImage = (src, width) => {
    if (!src) return "";
    try {
      const url = new URL(src, window.location.href);
      url.searchParams.set("width", String(width));
      return url.href;
    } catch {
      return "";
    }
  };
  const imageKey = (src) => String(src ?? "").replace(/^https?:/, "").split("?")[0];

  // The description is the merchant's own HTML (the theme renders it the
  // same way); scripts, styles that would leak onto the page, event
  // handlers and javascript: links are dropped all the same.
  const cleanDescription = (html) => {
    const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
    doc.querySelectorAll("script, style, link, meta, base, form, object, embed").forEach((el) => el.remove());
    doc.body.querySelectorAll("*").forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on") || (["href", "src", "xlink:href", "action"].includes(name) && /^\s*javascript:/i.test(attr.value))) {
          el.removeAttribute(attr.name);
        }
      }
      if (el.tagName === "A") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener");
      }
    });
    return doc.body.innerHTML.trim();
  };

  // Ajax options are {name, values} objects; older shapes are just names.
  const optionsOf = (product) =>
    (product.options ?? []).map((option, i) => {
      if (option && typeof option === "object") return { name: option.name, values: option.values ?? [] };
      const values = [];
      for (const v of product.variants ?? []) {
        const value = v.options?.[i];
        if (value != null && !values.includes(value)) values.push(value);
      }
      return { name: String(option), values };
    });

  const discountOf = (variant) =>
    variant && variant.compare_at_price > variant.price
      ? Math.round(((variant.compare_at_price - variant.price) * 100) / variant.compare_at_price)
      : 0;

  let detailSeq = 0;

  const renderDetails = (pdp, product, { addLabel, addedLabel, soldOutLabel, variantId, showBadge, showDescription, showQuantity, url }) => {
    const E = escapeHtml;
    const variants = product.variants ?? [];
    let variant =
      variants.find((v) => String(v.id) === String(variantId)) ?? variants.find((v) => v.available) ?? variants[0];
    if (!variant) return false;
    const options = optionsOf(product);
    const single = variants.length === 1 && options.length <= 1 && /^default title$/i.test(variants[0].title ?? "");
    const images = (product.images ?? []).map((src) => (typeof src === "string" ? src : src?.src)).filter(Boolean);
    const alts = new Map((product.media ?? []).map((m) => [imageKey(m.src ?? m.preview_image?.src), m.alt ?? ""]));
    const descriptionHtml = showDescription ? cleanDescription(product.description) : "";
    const titleId = `awa-sv-pdp-title-${product.id}`;

    pdp.innerHTML = `
      <div class="awa-sv-pdp__media">
        <button type="button" class="awa-sv-pdp__back" data-awa-sv-pdp-back aria-label="${E(labels.backToProducts)}">${ICONS.back}</button>
        ${
          images.length
            ? `<div class="awa-sv-pdp__gallery" data-awa-sv-pdp-gallery tabindex="0" role="group" aria-label="${E(product.title)}">
                ${images
                  .map(
                    (src, i) => `<img src="${E(sizedImage(src, 900))}" srcset="${E(sizedImage(src, 480))} 480w, ${E(sizedImage(src, 900))} 900w" sizes="(max-width: 749px) 80vw, 300px" alt="${E(alts.get(imageKey(src)) || (i === 0 ? product.title : ""))}" ${i > 1 ? 'loading="lazy"' : ""} data-key="${E(imageKey(src))}">`,
                  )
                  .join("")}
              </div>
              ${images.length > 1 ? `<div class="awa-sv-pdp__bar" aria-hidden="true"><span data-awa-sv-pdp-bar></span></div>` : ""}`
            : ""
        }
      </div>
      <div class="awa-sv-pdp__body" data-awa-sv-product data-product-id="${E(product.id)}">
        <h3 class="awa-sv-pdp__title" id="${titleId}" tabindex="-1">${E(product.title)}</h3>
        <p class="awa-sv-pdp__price">
          <span data-awa-sv-pdp-price></span>
          <s data-awa-sv-pdp-compare></s>
          ${showBadge ? `<span class="awa-sv-pdp__badge" data-awa-sv-pdp-badge></span>` : ""}
        </p>
        ${
          single
            ? ""
            : options
                .map(
                  (option, i) => `<div class="awa-sv-pdp__option" role="group" aria-labelledby="${titleId}-o${i}">
                    <p class="awa-sv-pdp__option-name" id="${titleId}-o${i}">${E(option.name)}:</p>
                    <div class="awa-sv-pdp__values">
                      ${option.values
                        .map(
                          (value) =>
                            `<button type="button" class="awa-sv-pdp__value" data-option="${i}" data-value="${E(value)}" aria-pressed="false">${E(value)}</button>`,
                        )
                        .join("")}
                    </div>
                  </div>`,
                )
                .join("")
        }
        <div class="awa-sv-pdp__actions">
          ${
            showQuantity
              ? `<div class="awa-sv-qty" data-awa-sv-qty>
                  <button type="button" class="awa-sv-qty__step" data-awa-sv-qty-step="-1" aria-label="−">&minus;</button>
                  <input class="awa-sv-qty__input" data-awa-sv-qty-input type="number" inputmode="numeric" min="1" max="99" value="1" aria-label="Quantity">
                  <button type="button" class="awa-sv-qty__step" data-awa-sv-qty-step="1" aria-label="+">+</button>
                </div>`
              : ""
          }
          <button type="button" class="awa-sv-product__add awa-sv-pdp__add" data-awa-sv-add-to-cart
            data-add-label="${E(addLabel)}" data-added-label="${E(addedLabel)}" data-sold-out-label="${E(soldOutLabel)}">${ICONS.bag}<span>${E(addLabel)}</span></button>
          <a class="awa-sv-pdp__cart" href="${E(cartUrl)}" aria-label="${E(labels.viewCart)}">${ICONS.cart}</a>
        </div>
        ${
          descriptionHtml
            ? `<details class="awa-sv-pdp__desc" open>
                <summary>${E(labels.description)}<span class="awa-sv-pdp__chev" aria-hidden="true">${ICONS.down}</span></summary>
                <div class="awa-sv-pdp__rte">${descriptionHtml}</div>
              </details>`
            : ""
        }
        <a class="awa-sv-pdp__full" href="${E(url)}" data-awa-sv-product-link data-awa-sv-full-page>${E(labels.viewDetails)}</a>
      </div>
    `;

    const selected = [...(variant.options ?? [])];
    const gallery = pdp.querySelector("[data-awa-sv-pdp-gallery]");
    const bar = pdp.querySelector("[data-awa-sv-pdp-bar]");
    const priceEl = pdp.querySelector("[data-awa-sv-pdp-price]");
    const compareEl = pdp.querySelector("[data-awa-sv-pdp-compare]");
    const badgeEl = pdp.querySelector("[data-awa-sv-pdp-badge]");
    const addButton = pdp.querySelector("[data-awa-sv-add-to-cart]");
    const addText = addButton.querySelector("span");

    // The cart delegate swaps a button's textContent between its labels;
    // here the label sits beside an icon, so it's mirrored into the span.
    new MutationObserver(() => {
      if (addButton.firstChild?.nodeType === Node.TEXT_NODE) {
        const text = addButton.textContent;
        addButton.innerHTML = `${ICONS.bag}<span>${E(text)}</span>`;
      }
    }).observe(addButton, { childList: true });

    const matches = (v, values) => (v.options ?? []).every((o, i) => o === values[i]);
    const sync = () => {
      variant = variants.find((v) => matches(v, selected));
      const shown = variant ?? variants.find((v) => v.options?.[0] === selected[0]) ?? variants[0];
      priceEl.textContent = formatMoney(shown.price);
      const onSale = shown.compare_at_price > shown.price;
      compareEl.textContent = onSale ? formatMoney(shown.compare_at_price) : "";
      compareEl.hidden = !onSale;
      pdp.querySelector(".awa-sv-pdp__price").classList.toggle("is-sale", onSale);
      if (badgeEl) {
        const off = discountOf(shown);
        badgeEl.textContent = off ? labels.percentOff.replace("__PERCENT__", String(off)) : "";
        badgeEl.hidden = !off;
      }
      pdp.querySelectorAll("[data-option]").forEach((button) => {
        const i = Number(button.dataset.option);
        const value = button.dataset.value;
        button.setAttribute("aria-pressed", String(selected[i] === value));
        // Greyed out when no in-stock variant has this value alongside the
        // other current choices; still selectable, it just shows sold out.
        const probe = [...selected];
        probe[i] = value;
        button.classList.toggle("is-unavailable", !variants.some((v) => v.available && matches(v, probe)));
      });
      const available = Boolean(variant?.available);
      addButton.disabled = !available;
      addButton.dataset.state = "";
      if (variant) addButton.dataset.variantId = String(variant.id);
      addText.textContent = available ? addLabel : soldOutLabel;
      const image = variant?.featured_image?.src;
      if (image && gallery) {
        const target = gallery.querySelector(`img[data-key="${CSS.escape(imageKey(image))}"]`);
        if (target) gallery.scrollTo?.({ left: target.offsetLeft - gallery.offsetLeft, behavior: "smooth" });
      }
    };
    pdp.querySelectorAll("[data-option]").forEach((button) =>
      button.addEventListener("click", () => {
        selected[Number(button.dataset.option)] = button.dataset.value;
        sync();
      }),
    );
    if (gallery && bar) {
      const syncBar = () => {
        const max = gallery.scrollWidth - gallery.clientWidth;
        const visible = gallery.clientWidth / gallery.scrollWidth;
        const progress = max > 0 ? Math.abs(gallery.scrollLeft) / max : 0;
        bar.style.width = `${visible * 100}%`;
        bar.style.insetInlineStart = `${progress * (1 - visible) * 100}%`;
      };
      gallery.addEventListener("scroll", syncBar, { passive: true });
      requestAnimationFrame(syncBar);
    }
    sync();
    return true;
  };

  // Opens `url`'s details in the viewer's panel. `card` is the product row
  // it came from (for the merchant's button labels and chosen variant); a
  // recommendation has none and gets the defaults.
  const openDetails = async (dialog, url, card) => {
    const panel = dialog.querySelector("[data-awa-sv-panel]");
    const pdp = dialog.querySelector("[data-awa-sv-pdp]");
    if (!panel || !pdp || !url) return;
    const token = ++detailSeq;
    const trigger = dialog.awaSvTrigger;
    const add = card?.querySelector("[data-awa-sv-add-to-cart]");
    dialog.awaSvDetailsFrom = card ?? null;
    panel.classList.add("is-detail");
    pdp.hidden = false;
    pdp.setAttribute("aria-busy", "true");
    pdp.innerHTML = `<div class="awa-sv-pdp__loading"><span class="awa-sv-pdp__spinner"></span></div>`;
    dialog.setPanelState("open");
    panel.scrollTop = 0;
    let product;
    try {
      product = await fetchProduct(url);
    } catch {
      // Can't load it here: take the shopper to the product page instead.
      if (token === detailSeq) window.AwaSvViewer.navigate(url);
      return;
    }
    if (token !== detailSeq || !panel.classList.contains("is-detail")) return;
    const rendered = renderDetails(pdp, product, {
      url,
      addLabel: add?.dataset.addLabel || labels.addToCart,
      addedLabel: add?.dataset.addedLabel || labels.added,
      soldOutLabel: add?.dataset.soldOutLabel || labels.soldOut,
      variantId: add?.dataset.variantId,
      showBadge: Boolean(card ? card.querySelector("[data-awa-sv-badge]") : false),
      showDescription: trigger?.dataset.showDescription !== "false",
      showQuantity: trigger?.dataset.showQuantity === "true",
    });
    pdp.removeAttribute("aria-busy");
    if (!rendered) {
      window.AwaSvViewer.navigate(url);
      return;
    }
    pdp.querySelector(".awa-sv-pdp__title")?.focus({ preventScroll: true });
  };

  const closeDetails = (dialog, restoreFocus = false) => {
    detailSeq += 1;
    const panel = dialog.querySelector("[data-awa-sv-panel]");
    const pdp = dialog.querySelector("[data-awa-sv-pdp]");
    if (!panel?.classList.contains("is-detail")) return;
    panel.classList.remove("is-detail");
    pdp.hidden = true;
    pdp.replaceChildren();
    const from = dialog.awaSvDetailsFrom;
    dialog.awaSvDetailsFrom = null;
    if (restoreFocus && from?.isConnected) {
      from.scrollIntoView({ block: "nearest" });
      from.querySelector(".awa-sv-product__title")?.focus({ preventScroll: true });
    }
  };

  // Product links inside the video viewer open the details view when the
  // widget asks for it; the "View full details" link still leaves.
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("#awa-sv-lightbox [data-awa-sv-product-link]");
    if (!link || link.hasAttribute("data-awa-sv-full-page") || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button > 0) return;
    const dialog = link.closest("#awa-sv-lightbox");
    if (dialog.awaSvTrigger?.dataset.productDetails !== "true" || link.closest("[data-awa-sv-pdp]")) return;
    const card = link.closest("[data-awa-sv-product]");
    let url = card?.dataset.productUrl;
    if (!url && link.classList.contains("awa-sv-rec")) {
      try {
        const href = new URL(link.href, window.location.href);
        if (href.origin === window.location.origin) url = href.pathname;
      } catch {
        url = "";
      }
    }
    if (!url) return;
    event.preventDefault();
    openDetails(dialog, url, card);
  });

  document.addEventListener("click", (event) => {
    const back = event.target.closest?.("[data-awa-sv-pdp-back]");
    if (back) closeDetails(back.closest("#awa-sv-lightbox"), true);
  });

  /* ------------------------------------------------------------ icons */

  // One icon family for all viewer chrome (and the blocks' reel-icon
  // snippet): 24px grid, 2px round strokes, after Lucide (lucide.dev, ISC).
  // Play and pause stay solid, the shapes shoppers read at a glance. Both
  // centre on (12, 12): the play triangle by its centre of mass, so it looks
  // centred in a round button with no offset, and the pause bars are sized
  // to carry the same visual weight, so toggling doesn't jump.
  // PLAY is also in snippets/reel-icon.liquid; keep the two identical.
  const icon = (body, size = 20, solid = false) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${
      solid ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    } aria-hidden="true" focusable="false">${body}</svg>`;
  const PLAY = '<path d="M8.25 6.85Q8.25 5.25 9.62 6.07L18.21 11.23Q19.5 12 18.21 12.77L9.62 17.93Q8.25 18.75 8.25 17.15Z"/>';
  const PAUSE = '<rect x="7.25" y="5.75" width="3.25" height="12.5" rx="1.2"/><rect x="13.5" y="5.75" width="3.25" height="12.5" rx="1.2"/>';
  const SPEAKER =
    '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5Z"/>';
  const ICONS = {
    play: icon(PLAY, 28, true),
    pause: icon(PAUSE, 28, true),
    playSmall: icon(PLAY, 18, true),
    pauseSmall: icon(PAUSE, 18, true),
    muted: icon(`${SPEAKER}<path d="m22 9-6 6m0-6 6 6"/>`),
    unmuted: icon(`${SPEAKER}<path d="M16 9a5 5 0 0 1 0 6m3.4 3.4a9 9 0 0 0 0-12.8"/>`),
    close: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
    up: icon('<path d="m18 15-6-6-6 6"/>'),
    down: icon('<path d="m6 9 6 6 6-6"/>'),
    share: icon('<path d="M12 3v12m-4-8 4-4 4 4M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/>'),
    bag: icon('<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18m-5 4a4 4 0 0 1-8 0"/>', 18),
    cart: icon('<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>', 20),
    back: icon('<path d="m12 19-7-7 7-7M19 12H5"/>', 18),
    retry: icon('<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.27"/><path d="M3 3v5.27h5.27"/>', 16),
    alert: icon('<circle cx="12" cy="12" r="10"/><path d="M12 7.5v5m0 4h.01"/>', 32),
  };

  /* ------------------------------------------------------------ viewer */

  let group = [];
  let index = 0;
  let initialPanelState = "peek";
  // Bumped by every load() and by close: async work started for an older
  // value must not touch the (shared) video element any more.
  let loadSeq = 0;

  // Matches the dialogs' closing transition in reel-lightbox.css.
  const CLOSE_FADE_MS = 250;

  const mobileQuery = window.matchMedia("(max-width: 749px)");
  const isMobile = () => mobileQuery.matches;

  const buildViewer = () => {
    const existing = document.getElementById("awa-sv-lightbox");
    if (existing) return existing;

    const L = Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, escapeHtml(v)]));
    const dialog = document.createElement("dialog");
    dialog.id = "awa-sv-lightbox";
    dialog.className = `awa-sv-viewer${config.viewerTheme === "light" ? " awa-sv-viewer--light" : ""}`;
    dialog.setAttribute("aria-labelledby", "awa-sv-viewer-title");
    dialog.innerHTML = `
      <div class="awa-sv-viewer__stage">
        <div class="awa-sv-viewer__player" data-awa-sv-player>
          <video class="awa-sv-viewer__video" playsinline preload="auto"></video>
          <div class="awa-sv-viewer__shade" aria-hidden="true"></div>
          <div class="awa-sv-viewer__progress" data-awa-sv-seek role="slider" tabindex="0" aria-label="${L.seek}" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span data-awa-sv-progress></span></div>
          <div class="awa-sv-viewer__top">
            <span class="awa-sv-viewer__count" data-awa-sv-count hidden></span>
            <button type="button" class="awa-sv-viewer__icon" data-awa-sv-share aria-label="${L.share}" hidden>${ICONS.share}</button>
            <button type="button" class="awa-sv-viewer__icon" data-awa-sv-mute></button>
            <button type="button" class="awa-sv-viewer__icon" data-awa-sv-close aria-label="${L.close}">${ICONS.close}</button>
          </div>
          <button type="button" class="awa-sv-viewer__toggle" data-awa-sv-play-pause aria-label="${L.play}">${ICONS.play}</button>
          <span class="awa-sv-spinner" aria-hidden="true"></span>
          <div class="awa-sv-viewer__error" data-awa-sv-error hidden>
            ${ICONS.alert}
            <p>${L.playbackError}</p>
            <button type="button" data-awa-sv-retry>${ICONS.retry}<span>${L.retry}</span></button>
          </div>
          <h2 class="awa-sv-viewer__title" id="awa-sv-viewer-title"></h2>
          <button type="button" class="awa-sv-moment" data-awa-sv-moment hidden>
            <span class="awa-sv-moment__thumb" aria-hidden="true"></span>
            <span class="awa-sv-moment__text">
              <span class="awa-sv-moment__title"></span>
              <span class="awa-sv-moment__price"></span>
            </span>
            <span class="awa-sv-moment__cta">${L.shopProduct}</span>
          </button>
          <div class="awa-sv-toast" aria-hidden="true"></div>
        </div>
        <div class="awa-sv-viewer__side">
        <aside class="awa-sv-viewer__panel" data-awa-sv-panel hidden>
          <button type="button" class="awa-sv-viewer__panel-head" data-awa-sv-panel-toggle aria-expanded="true">
            ${ICONS.bag}
            <span class="awa-sv-viewer__panel-title">${L.shop}</span>
            <span class="awa-sv-viewer__panel-count" data-awa-sv-panel-count></span>
            <span class="awa-sv-viewer__chevron" aria-hidden="true">${ICONS.up}</span>
          </button>
          <div class="awa-sv-viewer__list" data-awa-sv-list></div>
          <section class="awa-sv-pdp" data-awa-sv-pdp aria-label="${L.productDetails}" hidden></section>
          <section class="awa-sv-viewer__recs" data-awa-sv-recs hidden>
            <h3 class="awa-sv-viewer__recs-title">${L.youMayLike}</h3>
            <div class="awa-sv-viewer__recs-row" data-awa-sv-recs-row></div>
          </section>
          <a class="awa-sv-viewer__link" data-awa-sv-link data-awa-sv-product-link hidden></a>
          <p class="awa-sv-viewer__cart" data-awa-sv-cart-status hidden>
            <span class="awa-sv-cart-message"></span>
            <a href="${escapeHtml(cartUrl)}">${L.viewCart}</a>
          </p>
        </aside>
        </div>
      </div>
      <div class="awa-sv-viewer__nav" data-awa-sv-nav hidden>
        <button type="button" class="awa-sv-viewer__navbtn" data-awa-sv-prev aria-label="${L.previous}">${ICONS.up}</button>
        <button type="button" class="awa-sv-viewer__navbtn" data-awa-sv-next aria-label="${L.next}">${ICONS.down}</button>
      </div>
    `;
    dialog.appendChild(makeLiveRegion());
    document.body.appendChild(dialog);

    const video = dialog.querySelector("video");
    const player = dialog.querySelector("[data-awa-sv-player]");
    const toggle = dialog.querySelector("[data-awa-sv-play-pause]");
    const mute = dialog.querySelector("[data-awa-sv-mute]");
    const progress = dialog.querySelector("[data-awa-sv-progress]");
    const panel = dialog.querySelector("[data-awa-sv-panel]");
    const panelToggle = dialog.querySelector("[data-awa-sv-panel-toggle]");
    const cartStatus = dialog.querySelector("[data-awa-sv-cart-status]");
    const errorBox = dialog.querySelector("[data-awa-sv-error]");
    dialog.buffering = watchBuffering(video, player);
    dialog.progress = watchProgress(
      video,
      () => dialog.getAttribute("data-awa-sv-reel-id"),
      () => dialog.awaSvTrigger,
    );

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
    // The progress strip doubles as a seek slider: click or drag along it,
    // or focus it and use the arrow keys (5s steps, Home/End for the ends).
    const seekBar = dialog.querySelector("[data-awa-sv-seek]");
    let seeking = false;
    const clock = (t) => {
      const s = Math.max(0, Math.floor(t || 0));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };
    const syncSeek = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const ratio = duration ? Math.min(1, video.currentTime / duration) : 0;
      progress.style.transform = `scaleX(${ratio})`;
      seekBar.setAttribute("aria-valuemax", String(Math.round(duration)));
      seekBar.setAttribute("aria-valuenow", String(Math.round(video.currentTime || 0)));
      seekBar.setAttribute("aria-valuetext", `${clock(video.currentTime)} / ${clock(duration)}`);
    };
    const seekTo = (time) => {
      if (!Number.isFinite(video.duration) || !video.duration) return;
      video.currentTime = Math.max(0, Math.min(video.duration - 0.05, time));
      syncSeek();
    };
    const seekToPointer = (clientX) => {
      const rect = seekBar.getBoundingClientRect();
      if (!rect.width) return;
      let ratio = (clientX - rect.left) / rect.width;
      if (isRtl(dialog)) ratio = 1 - ratio;
      seekTo(Math.max(0, Math.min(1, ratio)) * (video.duration || 0));
    };
    seekBar.addEventListener("pointerdown", (event) => {
      if (!video.duration) return;
      event.preventDefault();
      event.stopPropagation();
      seeking = true;
      seekBar.setPointerCapture?.(event.pointerId);
      player.classList.add("is-seeking");
      seekToPointer(event.clientX);
    });
    seekBar.addEventListener("pointermove", (event) => {
      if (seeking) seekToPointer(event.clientX);
    });
    const endSeek = (event) => {
      if (!seeking) return;
      seeking = false;
      if (seekBar.hasPointerCapture?.(event.pointerId)) seekBar.releasePointerCapture(event.pointerId);
      player.classList.remove("is-seeking");
    };
    seekBar.addEventListener("pointerup", endSeek);
    seekBar.addEventListener("pointercancel", endSeek);
    // A click on the strip must not reach the video (which toggles play).
    seekBar.addEventListener("click", (event) => event.stopPropagation());
    seekBar.addEventListener("keydown", (event) => {
      const rtl = isRtl(dialog);
      const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[event.key];
      if (step !== undefined) {
        const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
        seekTo(video.currentTime + (horizontal && rtl ? -step : step));
      } else if (event.key === "Home") {
        seekTo(0);
      } else if (event.key === "End") {
        seekTo(video.duration);
      } else {
        return;
      }
      // Keep the dialog's arrow keys (next/previous reel) out of it.
      event.preventDefault();
      event.stopPropagation();
    });
    video.addEventListener("timeupdate", () => {
      if (!seeking) syncSeek();
    });
    video.addEventListener("loadedmetadata", syncSeek);
    video.addEventListener("ended", () => {
      if (dialog.open && !video.loop && index < group.length - 1) go(1);
    });

    const showError = () => {
      if (!dialog.open) return;
      errorBox.hidden = false;
      announce(dialog, labels.playbackError);
    };
    video.addEventListener("awa-sv:playback-error", showError);
    video.addEventListener("error", () => {
      // Native HLS errors (Safari); ignore the empty-src error from teardown.
      if (video.getAttribute("src")) showError();
    });
    dialog.querySelector("[data-awa-sv-retry]").addEventListener("click", () => {
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
    dialog.querySelector("[data-awa-sv-close]").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-awa-sv-share]").addEventListener("click", () => {
      const trigger = group[index];
      if (trigger) share(player, trigger.dataset.reelId, trigger.dataset.title || document.title);
    });
    dialog.querySelector("[data-awa-sv-prev]").addEventListener("click", () => go(-1));
    dialog.querySelector("[data-awa-sv-next]").addEventListener("click", () => go(1));

    // On mobile the "peek" sheet clips everything below the first product,
    // so those rows (and anything after the list) are made inert until the
    // sheet is expanded, no tabbing into invisible controls.
    const syncPeekInert = () => {
      const collapsed = panel.dataset.state === "peek" && isMobile();
      dialog.querySelectorAll("[data-awa-sv-list] [data-awa-sv-product]").forEach((row, i) => {
        row.inert = collapsed && i > 0;
      });
      const linkEl = dialog.querySelector("[data-awa-sv-link]");
      const hasProducts = Boolean(dialog.querySelector("[data-awa-sv-list] [data-awa-sv-product]"));
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
      // Collapsing returns a mobile sheet to its peek, but desktop shows
      // "peek" fully expanded, so there it has to close.
      setPanelState(open ? (isMobile() && initialPanelState === "peek" ? "peek" : "closed") : "open");
    });
    dialog.setPanelState = setPanelState;

    // Product moments: while the reel plays, the product on screen pops up
    // over the video in place of the caption and its row lights up; a tap
    // brings up that product in the panel, its add button focused.
    const momentEl = dialog.querySelector("[data-awa-sv-moment]");
    let moments = [];
    let shownMoment = null;
    const showMoment = (moment) => {
      if (moment === shownMoment) return;
      shownMoment = moment;
      dialog.querySelectorAll("[data-awa-sv-list] .is-moment").forEach((row) => row.classList.remove("is-moment"));
      player.classList.toggle("has-moment", Boolean(moment));
      if (!moment) {
        momentEl.hidden = true;
        return;
      }
      const { card } = moment;
      momentEl.querySelector(".awa-sv-moment__title").textContent = card.querySelector(".awa-sv-product__title")?.textContent.trim() ?? "";
      momentEl.querySelector(".awa-sv-moment__price").textContent = card.querySelector("[data-awa-sv-price]")?.textContent.trim() ?? "";
      const image = card.querySelector(".awa-sv-product__media img")?.getAttribute("src");
      const thumb = momentEl.querySelector(".awa-sv-moment__thumb");
      thumb.style.backgroundImage = image ? `url("${image.replace(/"/g, "%22")}")` : "";
      thumb.hidden = !image;
      momentEl.hidden = false;
      card.classList.add("is-moment");
    };
    video.addEventListener("timeupdate", () => {
      if (moments.length) showMoment(currentMoment(moments, video.currentTime));
    });
    momentEl.addEventListener("click", () => {
      const card = shownMoment?.card;
      if (!card) return;
      trackAnalytics(dialog.getAttribute("data-awa-sv-reel-id"), "click_product", {
        trigger: dialog.awaSvTrigger,
        product_id: card.dataset.productId,
      });
      if (dialog.awaSvTrigger?.dataset.productDetails === "true" && card.dataset.productUrl) {
        openDetails(dialog, card.dataset.productUrl, card);
        return;
      }
      if (panel.dataset.state === "closed" || (panel.dataset.state === "peek" && isMobile())) setPanelState("open");
      card.scrollIntoView({ block: "nearest" });
      card.querySelector("[data-awa-sv-add-to-cart], .awa-sv-product__add")?.focus({ preventScroll: true });
    });
    dialog.setMoments = (trigger) => {
      moments = productMoments(trigger, dialog.querySelector("[data-awa-sv-list]"));
      shownMoment = undefined;
      showMoment(null);
    };

    // Backdrop click closes; a click on the stage gutter counts as backdrop.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.classList?.contains("awa-sv-viewer__stage")) dialog.close();
    });

    dialog.addEventListener("keydown", (event) => {
      if (event.target.closest?.("select, input, textarea")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // The product details view keeps its own keys (gallery scrolling,
      // option buttons, the description's disclosure).
      if (event.target.closest?.("[data-awa-sv-pdp]")) return;
      // Player shortcuts: K (or Space away from buttons and links) plays and
      // pauses, M mutes.
      const key = event.key.toLowerCase();
      const onControl = event.target.closest?.("button, a, [role='slider']");
      if (key === "k" || (key === " " && !onControl)) {
        event.preventDefault();
        togglePlayback();
        return;
      }
      if (key === "m") {
        event.preventDefault();
        mute.click();
        return;
      }
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

    // Trackpad or mouse-wheel scrolling over the video moves through the
    // group, one reel per gesture: momentum scrolling keeps firing wheel
    // events, so after a move further ones are ignored for a moment.
    let wheelTotal = 0;
    let wheelQuietUntil = 0;
    player.addEventListener(
      "wheel",
      (event) => {
        if (group.length < 2 || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        const now = Date.now();
        if (now < wheelQuietUntil) {
          wheelQuietUntil = now + 250;
          return;
        }
        wheelTotal += event.deltaY;
        if (Math.abs(wheelTotal) >= 40) {
          const delta = wheelTotal > 0 ? 1 : -1;
          wheelTotal = 0;
          wheelQuietUntil = now + 600;
          go(delta);
        }
      },
      { passive: false },
    );

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
      closeDetails(dialog);
      dialog.progress.flush();
      window.AwaSvHls?.teardown(video);
      // Emptied once the closing fade is over, not mid-fade.
      setTimeout(() => {
        if (!dialog.open) dialog.querySelector("[data-awa-sv-list]").replaceChildren();
      }, CLOSE_FADE_MS);
      cartStatus.hidden = true;
      errorBox.hidden = true;
      document.documentElement.classList.remove("awa-sv-locked");
      document.dispatchEvent(new CustomEvent("awa-sv:viewer-change"));
      const lastTrigger = group[index];
      group = [];
      // Lets a deck bring the last viewed reel to the front before focus
      // returns to it (its button may be tabindex=-1 / aria-hidden now).
      if (lastTrigger) document.dispatchEvent(new CustomEvent("awa-sv:viewer-closed", { detail: { trigger: lastTrigger } }));
      lastTrigger?.querySelector(".awa-sv-trigger__button")?.focus({ preventScroll: true });
    });

    syncMute();
    return dialog;
  };

  const load = async (dialog, trigger) => {
    const token = ++loadSeq;
    const isCurrent = () => dialog.open && token === loadSeq;
    const video = dialog.querySelector("video");
    const title = dialog.querySelector(".awa-sv-viewer__title");
    const panel = dialog.querySelector("[data-awa-sv-panel]");
    const list = dialog.querySelector("[data-awa-sv-list]");
    const count = dialog.querySelector("[data-awa-sv-count]");
    const cartStatus = dialog.querySelector("[data-awa-sv-cart-status]");

    dialog.progress.flush();
    window.AwaSvHls?.teardown(video);
    dialog.buffering.reset();
    dialog.querySelector("[data-awa-sv-error]").hidden = true;
    closeDetails(dialog);
    const reelId = trigger.dataset.reelId ?? "";
    dialog.setAttribute("data-awa-sv-reel-id", reelId);
    dialog.awaSvTrigger = trigger;
    title.textContent = trigger.dataset.title ?? "";
    nameDialog(dialog, "awa-sv-viewer-title", trigger.dataset.title);
    if (trigger.dataset.posterUrl) video.setAttribute("poster", trigger.dataset.posterUrl);
    else video.removeAttribute("poster");
    dialog.querySelector("[data-awa-sv-progress]").style.transform = "scaleX(0)";

    applyViewerSettings(dialog, video, title, trigger);
    video.dispatchEvent(new Event("volumechange"));

    const productCount = cloneProducts(trigger, list);
    const linkUrl = safeLink(trigger.dataset.linkUrl);
    const linkEl = dialog.querySelector("[data-awa-sv-link]");
    linkEl.hidden = !linkUrl;
    if (linkUrl) {
      linkEl.href = linkUrl;
      linkEl.textContent = trigger.dataset.linkLabel || labels.learnMore;
    } else {
      linkEl.removeAttribute("href");
    }
    panel.hidden = productCount === 0 && !linkUrl;
    dialog.classList.toggle("has-products", !panel.hidden);
    dialog.querySelector("[data-awa-sv-panel-toggle]").hidden = productCount === 0;
    dialog.querySelector("[data-awa-sv-panel-count]").textContent = productCount > 1 ? String(productCount) : "";
    initialPanelState = trigger.dataset.tagRevealMode === "tap" ? "closed" : "peek";
    dialog.setPanelState(initialPanelState);
    dialog.setMoments(trigger);
    cartStatus.hidden = true;
    dialog.querySelector("[data-awa-sv-share]").hidden = trigger.dataset.showShare === "false";

    const recs = dialog.querySelector("[data-awa-sv-recs]");
    if (trigger.dataset.showRecommendations === "false" || productCount === 0) {
      recs.hidden = true;
    } else {
      renderRecommendations(recs, list, isCurrent);
    }

    const nav = dialog.querySelector("[data-awa-sv-nav]");
    nav.hidden = group.length < 2;
    count.hidden = group.length < 2;
    count.textContent = labels.of.replace("__CURRENT__", String(index + 1)).replace("__TOTAL__", String(group.length));
    dialog.querySelector("[data-awa-sv-prev]").disabled = index === 0;
    dialog.querySelector("[data-awa-sv-next]").disabled = index === group.length - 1;

    trackAnalytics(reelId, "view", { trigger });
    preloadPoster(group[index + 1]);
    try {
      await startPlayback(video, trigger.dataset.hlsSrc, isCurrent);
    } catch {
      // Playback failed to start; the poster and product list stay usable,
      // and the shopper gets a retry button.
      if (isCurrent()) {
        dialog.buffering.fail();
        dialog.querySelector("[data-awa-sv-error]").hidden = false;
        announce(dialog, labels.playbackError);
      }
    }
    if (!dialog.open) {
      // Closed while loading: make sure nothing keeps playing in the
      // hidden dialog (close already tore down; this is belt and braces).
      window.AwaSvHls?.teardown(video);
    }
  };

  // Warm the next reel's poster so moving on shows a picture instantly
  // instead of a black frame while its stream starts.
  const preloaded = new Set();
  const preloadPoster = (trigger) => {
    const url = trigger?.dataset.posterUrl;
    if (!url || preloaded.has(url)) return;
    preloaded.add(url);
    const img = new Image();
    img.decoding = "async";
    img.src = url;
  };

  const go = (delta) => {
    const dialog = document.getElementById("awa-sv-lightbox");
    const next = index + delta;
    if (!dialog?.open || next < 0 || next >= group.length) return;
    index = next;
    // The new reel slides in from the direction it came from (CSS keys off
    // data-enter; re-set after a reflow so back-to-back moves replay it).
    dialog.removeAttribute("data-enter");
    void dialog.offsetWidth;
    dialog.dataset.enter = delta > 0 ? "next" : "prev";
    load(dialog, group[index]);
  };

  // `triggers` is the ordered set the opened reel belongs to (a filmstrip or
  // deck); a standalone reel passes nothing and gets no next/previous.
  const open = (trigger, triggers) => {
    if (!trigger?.dataset.hlsSrc) return;
    const dialog = buildViewer();
    dialog.removeAttribute("data-enter");
    group = triggers && triggers.length ? triggers : [trigger];
    index = Math.max(group.indexOf(trigger), 0);
    if (!dialog.open) {
      dialog.showModal();
      document.documentElement.classList.add("awa-sv-locked");
      document.dispatchEvent(new CustomEvent("awa-sv:viewer-change"));
      // Start keyboard and screen-reader users on a predictable control.
      dialog.querySelector("[data-awa-sv-close]")?.focus();
    }
    load(dialog, trigger);
  };

  window.AwaSvLightbox = { open, trackAnalytics };
  window.AwaSvViewer = {
    labels,
    cartUrl,
    share,
    shortId,
    safeLink,
    escapeHtml,
    isRtl,
    announce,
    watchBuffering,
    watchProgress,
    productMoments,
    currentMoment,
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
    // Leaving for the cart or checkout; a property so tests can watch it.
    navigate: (url) => window.location.assign(url),
  };
})();
