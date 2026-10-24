// Shopper events beyond the app's own analytics. Each event the widgets
// report (window.ReelupTracking.track) goes:
// - to Shopify customer events (Shopify.analytics.publish), on by default.
//   Shopify applies the visitor's consent to every pixel subscribed there,
//   including the custom pixel the app's Integrations page hands out for
//   tools that run sandboxed (Google & YouTube, Meta, TikTok channels);
// - to the analytics/marketing tags already on the page (GA4 gtag, Google
//   Tag Manager, Meta Pixel, TikTok Pixel, Pinterest Tag, Klaviyo,
//   Microsoft Clarity) the merchant switched on, only with the visitor's
//   consent from Shopify's Customer Privacy API.
// It also installs Microsoft Clarity when the merchant gave a project id,
// with analytics consent; that's why the loader puts this file on every
// page in that case, not just pages with videos.
//
// Nothing here may break the widgets: every third-party call is guarded.
(() => {
  if (window.ReelupTracking) return;

  const readSettings = () => {
    try {
      const config = JSON.parse(document.querySelector("script[data-reelup-config]")?.textContent ?? "{}");
      return config.tracking && typeof config.tracking === "object" ? config.tracking : {};
    } catch {
      return {};
    }
  };
  const settings = readSettings();
  const enabled = (key) => settings[key] === true;

  // Public event names: snake_case for analytics tools, PascalCase where
  // the tool's convention is (Meta, TikTok), and a sentence for Klaviyo
  // flows. Never the tools' standard names (add_to_cart, AddToCart…):
  // Shopify's own channels already send those for every cart add, and a
  // second copy would double-count conversions.
  const EVENTS = {
    video_view: ["reelup_video_view", "ReelupVideoView", "Viewed Shoppable Video"],
    video_complete: ["reelup_video_complete", "ReelupVideoComplete", "Completed Shoppable Video"],
    product_click: ["reelup_product_click", "ReelupProductClick", "Clicked Product in Video"],
    add_to_cart: ["reelup_add_to_cart", "ReelupAddToCart", "Added to Cart from Video"],
  };

  const DESTINATIONS = {
    ga4: { consent: "analytics", send: ([name], data) => window.gtag?.("event", name, data) },
    gtm: {
      consent: "analytics",
      send: ([name], data) => {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: name, reelup: data });
      },
    },
    clarity: {
      consent: "analytics",
      send: ([name], data) => {
        if (typeof window.clarity !== "function") return;
        window.clarity("event", name);
        if (data.reel_title || data.reel_id) window.clarity("set", "reelup_reel", data.reel_title || data.reel_id);
        // Keeps the recording of a session that shopped from a video.
        if (name === "reelup_add_to_cart") window.clarity("upgrade", name);
      },
    },
    meta: { consent: "marketing", send: ([, pascal], data) => window.fbq?.("trackCustom", pascal, data) },
    tiktok: { consent: "marketing", send: ([, pascal], data) => window.ttq?.track?.(pascal, data) },
    // Pinterest's custom events are all called "custom".
    pinterest: { consent: "marketing", send: ([name], data) => window.pintrk?.("track", "custom", { ...data, event_name: name }) },
    klaviyo: {
      consent: "marketing",
      send: ([, , label], data) => (window.klaviyo ?? window._learnq)?.push?.(["track", label, data]),
    },
  };

  /* ---------------------------------------------------------- consent */

  // null until Shopify's Customer Privacy API has answered; events meant
  // for third parties wait in a short queue until then.
  let consent = null;
  const pending = [];
  const readConsent = () => {
    const privacy = window.Shopify?.customerPrivacy;
    const ask = (fn) => (typeof fn === "function" ? Boolean(fn.call(privacy)) : true);
    return privacy
      ? { analytics: ask(privacy.analyticsProcessingAllowed), marketing: ask(privacy.marketingAllowed) }
      : // Only reachable off Shopify (every storefront has the API).
        { analytics: true, marketing: true };
  };

  /* ---------------------------------------------------- Microsoft Clarity */

  const CLARITY_ID = /^[a-z0-9]{6,20}$/i;
  let clarityStarted = false;
  const startClarity = () => {
    const id = settings.clarityId;
    if (clarityStarted || !consent?.analytics || typeof id !== "string" || !CLARITY_ID.test(id)) return;
    clarityStarted = true;
    // The store may already run Clarity (Microsoft's own app or a theme
    // edit); one copy is enough.
    if (typeof window.clarity === "function") return;
    window.clarity = function clarity() {
      (window.clarity.q = window.clarity.q || []).push(arguments);
    };
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${id}`;
    document.head.appendChild(script);
  };

  /* ---------------------------------------------------------- sending */

  const forward = (names, data) => {
    for (const [key, destination] of Object.entries(DESTINATIONS)) {
      const on = key === "clarity" ? enabled("clarity") || Boolean(settings.clarityId) : enabled(key);
      if (!on || !consent?.[destination.consent]) continue;
      try {
        destination.send(names, data);
      } catch {
        // A broken third-party tag is its own problem, not the shopper's.
      }
    }
  };

  const applyConsent = () => {
    const before = consent;
    consent = readConsent();
    startClarity();
    if (before?.analytics && !consent.analytics) {
      try {
        window.clarity?.("consent", false);
      } catch {
        // ignore
      }
    }
    for (const [names, data] of pending.splice(0)) forward(names, data);
  };

  const MAX_PENDING = 50;
  const track = (event, detail = {}) => {
    const names = EVENTS[event];
    if (!names) return;
    const data = {};
    for (const [key, value] of Object.entries(detail)) {
      if (value !== undefined && value !== null && value !== "") data[key] = value;
    }
    if (settings.shopifyEvents !== false) {
      try {
        window.Shopify?.analytics?.publish?.(names[0], data);
      } catch {
        // ignore
      }
    }
    if (consent) forward(names, data);
    else if (pending.length < MAX_PENDING) pending.push([names, data]);
  };

  // Shopify's Customer Privacy API answers asynchronously and announces
  // later changes (the shopper using the cookie banner).
  if (typeof window.Shopify?.loadFeatures === "function") {
    try {
      window.Shopify.loadFeatures([{ name: "consent-tracking-api", version: "0.1" }], (error) => {
        if (error) {
          // Can't tell what the shopper agreed to: send nothing to third
          // parties rather than guess.
          consent = { analytics: false, marketing: false };
          pending.length = 0;
          return;
        }
        applyConsent();
      });
    } catch {
      consent = { analytics: false, marketing: false };
    }
    document.addEventListener("visitorConsentCollected", applyConsent);
  } else {
    applyConsent();
  }

  window.ReelupTracking = { track };
})();
