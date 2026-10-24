// Shop-wide tracking integrations: where the storefront widgets' shopper
// events go besides the app's own analytics. Client-safe (no Prisma) so the
// Integrations page and the server share one shape, set of defaults and
// sanitizer. The storefront reads the same object from the shop's
// `$app.tracking` metafield (reel-config.liquid → reel-tracking.js).

export type PageTagKey = "ga4" | "gtm" | "meta" | "tiktok" | "pinterest" | "klaviyo";

export interface TrackingConfig {
  // Publish every event to Shopify customer events (Shopify.analytics.publish).
  shopifyEvents: boolean;
  // Microsoft Clarity project id; "" = not connected. The app installs
  // Clarity on every page (with the visitor's analytics consent).
  clarityId: string;
  // Forward events to these tags when the theme already runs them.
  ga4: boolean;
  gtm: boolean;
  meta: boolean;
  tiktok: boolean;
  pinterest: boolean;
  klaviyo: boolean;
}

export const TRACKING_DEFAULTS: TrackingConfig = {
  shopifyEvents: true,
  clarityId: "",
  ga4: false,
  gtm: false,
  meta: false,
  tiktok: false,
  pinterest: false,
  klaviyo: false,
};

// Clarity project ids are short lowercase alphanumerics (e.g. "k2x9ab4cde").
// The storefront checks the same pattern before building the tag URL.
export const CLARITY_ID_PATTERN = /^[a-z0-9]{6,20}$/i;

export const PAGE_TAG_KEYS: PageTagKey[] = ["ga4", "gtm", "meta", "tiktok", "pinterest", "klaviyo"];

export function resolveTracking(input: unknown): TrackingConfig {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const clarityId = typeof raw.clarityId === "string" ? raw.clarityId.trim().toLowerCase() : "";
  const out: TrackingConfig = {
    ...TRACKING_DEFAULTS,
    shopifyEvents: raw.shopifyEvents !== false,
    clarityId: CLARITY_ID_PATTERN.test(clarityId) ? clarityId : "",
  };
  for (const key of PAGE_TAG_KEYS) out[key] = raw[key] === true;
  return out;
}

export interface PageTagMeta {
  key: PageTagKey;
  name: string;
  consent: "analytics" | "marketing";
  // What the theme must already have for forwarding to reach the tool.
  requires: string;
}

export const PAGE_TAGS: PageTagMeta[] = [
  { key: "ga4", name: "Google Analytics 4", consent: "analytics", requires: "gtag.js in your theme" },
  { key: "gtm", name: "Google Tag Manager", consent: "analytics", requires: "a GTM container in your theme (events arrive in the dataLayer)" },
  { key: "meta", name: "Meta Pixel", consent: "marketing", requires: "the Meta Pixel base code in your theme" },
  { key: "tiktok", name: "TikTok Pixel", consent: "marketing", requires: "the TikTok Pixel base code in your theme" },
  { key: "pinterest", name: "Pinterest Tag", consent: "marketing", requires: "the Pinterest Tag in your theme" },
  { key: "klaviyo", name: "Klaviyo", consent: "marketing", requires: "Klaviyo onsite tracking (its app embed)" },
];

// The events every destination receives, in each tool's naming. Must match
// EVENTS in scripts/extension-assets-src/reel-tracking.js (a unit test
// checks). Never the tools' standard names: Shopify's own channels already
// send add_to_cart/AddToCart for every cart add, and a second copy would
// double-count conversions.
export const TRACKED_EVENTS = [
  { name: "reelup_video_view", pascal: "ReelupVideoView", label: "Viewed Shoppable Video", when: "A shopper opens a video" },
  { name: "reelup_video_complete", pascal: "ReelupVideoComplete", label: "Completed Shoppable Video", when: "They watch 95% of it" },
  { name: "reelup_product_click", pascal: "ReelupProductClick", label: "Clicked Product in Video", when: "They tap a product in it" },
  { name: "reelup_add_to_cart", pascal: "ReelupAddToCart", label: "Added to Cart from Video", when: "They add a product from it to the cart" },
] as const;

export const EVENT_FIELDS = "reel_id, reel_title, widget, and for cart events product_id, variant_id, quantity, value, currency";

export const GA4_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;
export const META_PIXEL_ID_PATTERN = /^\d{8,20}$/;

// Code for a Shopify custom pixel (Settings › Customer events) that sends
// the widgets' events to a tool running sandboxed: the official Google &
// YouTube and Meta channels don't put gtag/fbq on the page, so the page-tag
// forwarding above can't reach them. Shopify applies the visitor's consent
// to the pixel according to the permission the merchant picks for it.
export function customPixelCode(
  tool: "ga4" | "meta" | "any",
  id = "",
): string {
  const events = `const events = [\n${TRACKED_EVENTS.map((e) => `  "${e.name}",`).join("\n")}\n];`;
  const header = "// AWAlabs Shoppable Videos: shoppable video events";
  if (tool === "ga4") {
    const measurementId = GA4_ID_PATTERN.test(id) ? id : "G-XXXXXXXXXX";
    return `${header} → Google Analytics 4
const script = document.createElement("script");
script.async = true;
script.src = "https://www.googletagmanager.com/gtag/js?id=${measurementId}";
document.head.appendChild(script);
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag("js", new Date());
gtag("config", "${measurementId}", { send_page_view: false });

${events}
events.forEach((name) => {
  analytics.subscribe(name, (event) => gtag("event", name, event.customData));
});
`;
  }
  if (tool === "meta") {
    const pixelId = META_PIXEL_ID_PATTERN.test(id) ? id : "YOUR_PIXEL_ID";
    const pascal = Object.fromEntries(TRACKED_EVENTS.map((e) => [e.name, e.pascal]));
    return `${header} → Meta Pixel
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,"script","https://connect.facebook.net/en_US/fbevents.js");
fbq("init", "${pixelId}");

const names = ${JSON.stringify(pascal, null, 2)};
Object.keys(names).forEach((name) => {
  analytics.subscribe(name, (event) => fbq("trackCustom", names[name], event.customData));
});
`;
  }
  return `${header}
// Each event's details (${EVENT_FIELDS}) arrive as event.customData.
${events}
events.forEach((name) => {
  analytics.subscribe(name, (event) => {
    console.log(name, event.customData); // replace with your tool's call
  });
});
`;
}
