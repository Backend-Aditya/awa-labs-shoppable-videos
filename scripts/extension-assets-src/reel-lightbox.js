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
      const key = `reelup-${COUNTED_ONCE[eventType]}-${reelId}`;
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
  // trigger (title and widget for connected tools), `detail.seconds` the
  // watch time; anything else goes to connected tools as is.
  const trackAnalytics = (reelId, eventType, detail = {}) => {
    if (!reelId) return;
    if (COUNTED_ONCE[eventType] && recentlyCounted(eventType, reelId)) return;
    const { trigger, seconds, ...extra } = detail;
    const body = { shopDomain: window.Shopify?.shop, reelId, eventType };
    if (eventType === "watch") body.seconds = seconds;
    fetch("/apps/reels/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
    if (PUBLIC_EVENTS[eventType]) {
      window.ReelupTracking?.track(PUBLIC_EVENTS[eventType], {
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

  const reelIdFor = (el) => el.closest("[data-reelup-reel-id]")?.getAttribute("data-reelup-reel-id") ?? "";
  // The trigger behind an element's events: the reel on screen in a
  // viewer, or the featured-video block's own video.
  const triggerFor = (el) => {
    const host = el.closest("[data-reelup-reel-id]");
    return host?.reelupTrigger ?? host?.closest(".reelup")?.querySelector("[data-reelup-trigger]") ?? null;
  };

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

  // Variant picker: keeps the card's price, compare-at price, sale badge,
  // image and add button in step with the chosen option.
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
    const badge = card.querySelector("[data-reelup-badge]");
    if (badge) {
      badge.textContent = option.dataset.discount ? `−${option.dataset.discount}%` : "";
      badge.hidden = !option.dataset.discount;
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

  // What a successful add leads to: the widget's "After adding to cart".
  // "cart": Dawn-family themes' drawer or notification was just opened by
  // notifyTheme, so a viewer steps aside to reveal it; other themes go to
  // the cart page. "checkout" goes straight there. "stay" (the default)
  // keeps the shopper watching.
  const afterAdd = (button, trigger) => {
    const action = trigger?.dataset.afterAdd;
    if (action === "checkout") {
      window.ReelupViewer.navigate("/checkout");
    } else if (action === "cart") {
      if (typeof themeCartElement()?.renderContents === "function") button.closest("dialog")?.close();
      else window.ReelupViewer.navigate(cartUrl);
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
      trackAnalytics(reelIdFor(link), "click_product", {
        trigger: triggerFor(link),
        product_id: link.closest("[data-reelup-product]")?.dataset.productId,
      });
      return;
    }

    const button = event.target.closest?.("[data-reelup-add-to-cart]");
    if (!button || button.disabled || button.dataset.state === "loading") return;

    const reelId = reelIdFor(button);
    const trigger = triggerFor(button);
    const productId = button.closest("[data-reelup-product]")?.dataset.productId;
    trackAnalytics(reelId, "click_product", { trigger, product_id: productId });

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

  const CTA_STYLES = ["reelup-cta--pill", "reelup-cta--square", "reelup-cta--text-link"];

  // Viewers are shared singletons reused across every trigger on the page,
  // so every per-trigger setting is written unconditionally (set or
  // cleared), never just set, or it would leak onto the next trigger.
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
    video.addEventListener("reelup:playback-error", fail);
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
    return Array.from(listEl.querySelectorAll("[data-reelup-product]"))
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
  // visual, the message is announced through the dialog's live region.
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
          <div class="reelup-viewer__progress" data-reelup-seek role="slider" tabindex="0" aria-label="${L.seek}" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span data-reelup-progress></span></div>
          <div class="reelup-viewer__top">
            <span class="reelup-viewer__count" data-reelup-count hidden></span>
            <button type="button" class="reelup-viewer__icon" data-reelup-share aria-label="${L.share}" hidden>${ICONS.share}</button>
            <button type="button" class="reelup-viewer__icon" data-reelup-mute></button>
            <button type="button" class="reelup-viewer__icon" data-reelup-close aria-label="${L.close}">${ICONS.close}</button>
          </div>
          <button type="button" class="reelup-viewer__toggle" data-reelup-play-pause aria-label="${L.play}">${ICONS.play}</button>
          <span class="reelup-spinner" aria-hidden="true"></span>
          <div class="reelup-viewer__error" data-reelup-error hidden>
            ${ICONS.alert}
            <p>${L.playbackError}</p>
            <button type="button" data-reelup-retry>${ICONS.retry}<span>${L.retry}</span></button>
          </div>
          <h2 class="reelup-viewer__title" id="reelup-viewer-title"></h2>
          <button type="button" class="reelup-moment" data-reelup-moment hidden>
            <span class="reelup-moment__thumb" aria-hidden="true"></span>
            <span class="reelup-moment__text">
              <span class="reelup-moment__title"></span>
              <span class="reelup-moment__price"></span>
            </span>
            <span class="reelup-moment__cta">${L.shopProduct}</span>
          </button>
          <div class="reelup-toast" aria-hidden="true"></div>
        </div>
        <div class="reelup-viewer__side">
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
    dialog.buffering = watchBuffering(video, player);
    dialog.progress = watchProgress(
      video,
      () => dialog.getAttribute("data-reelup-reel-id"),
      () => dialog.reelupTrigger,
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
    const seekBar = dialog.querySelector("[data-reelup-seek]");
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
    // sheet is expanded, no tabbing into invisible controls.
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
      // Collapsing returns a mobile sheet to its peek, but desktop shows
      // "peek" fully expanded, so there it has to close.
      setPanelState(open ? (isMobile() && initialPanelState === "peek" ? "peek" : "closed") : "open");
    });
    dialog.setPanelState = setPanelState;

    // Product moments: while the reel plays, the product on screen pops up
    // over the video in place of the caption and its row lights up; a tap
    // brings up that product in the panel, its add button focused.
    const momentEl = dialog.querySelector("[data-reelup-moment]");
    let moments = [];
    let shownMoment = null;
    const showMoment = (moment) => {
      if (moment === shownMoment) return;
      shownMoment = moment;
      dialog.querySelectorAll("[data-reelup-list] .is-moment").forEach((row) => row.classList.remove("is-moment"));
      player.classList.toggle("has-moment", Boolean(moment));
      if (!moment) {
        momentEl.hidden = true;
        return;
      }
      const { card } = moment;
      momentEl.querySelector(".reelup-moment__title").textContent = card.querySelector(".reelup-product__title")?.textContent.trim() ?? "";
      momentEl.querySelector(".reelup-moment__price").textContent = card.querySelector("[data-reelup-price]")?.textContent.trim() ?? "";
      const image = card.querySelector(".reelup-product__media img")?.getAttribute("src");
      const thumb = momentEl.querySelector(".reelup-moment__thumb");
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
      trackAnalytics(dialog.getAttribute("data-reelup-reel-id"), "click_product", {
        trigger: dialog.reelupTrigger,
        product_id: card.dataset.productId,
      });
      if (panel.dataset.state === "closed" || (panel.dataset.state === "peek" && isMobile())) setPanelState("open");
      card.scrollIntoView({ block: "nearest" });
      card.querySelector("[data-reelup-add-to-cart], .reelup-product__add")?.focus({ preventScroll: true });
    });
    dialog.setMoments = (trigger) => {
      moments = productMoments(trigger, dialog.querySelector("[data-reelup-list]"));
      shownMoment = undefined;
      showMoment(null);
    };

    // Backdrop click closes; a click on the stage gutter counts as backdrop.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.classList?.contains("reelup-viewer__stage")) dialog.close();
    });

    dialog.addEventListener("keydown", (event) => {
      if (event.target.closest?.("select, input, textarea")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
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
      dialog.progress.flush();
      window.ReelupHls?.teardown(video);
      // Emptied once the closing fade is over, not mid-fade.
      setTimeout(() => {
        if (!dialog.open) dialog.querySelector("[data-reelup-list]").replaceChildren();
      }, CLOSE_FADE_MS);
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

    dialog.progress.flush();
    window.ReelupHls?.teardown(video);
    dialog.buffering.reset();
    dialog.querySelector("[data-reelup-error]").hidden = true;
    const reelId = trigger.dataset.reelId ?? "";
    dialog.setAttribute("data-reelup-reel-id", reelId);
    dialog.reelupTrigger = trigger;
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
    dialog.setMoments(trigger);
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

    trackAnalytics(reelId, "view", { trigger });
    preloadPoster(group[index + 1]);
    try {
      await startPlayback(video, trigger.dataset.hlsSrc, isCurrent);
    } catch {
      // Playback failed to start; the poster and product list stay usable,
      // and the shopper gets a retry button.
      if (isCurrent()) {
        dialog.buffering.fail();
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
    const dialog = document.getElementById("reelup-lightbox");
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
