import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLARITY_ID_PATTERN, TRACKED_EVENTS, TRACKING_DEFAULTS, customPixelCode, resolveTracking } from "./tracking";

describe("resolveTracking", () => {
  it("defaults: Shopify customer events on, everything else off", () => {
    expect(resolveTracking(undefined)).toEqual(TRACKING_DEFAULTS);
    expect(resolveTracking(null).shopifyEvents).toBe(true);
  });

  it("keeps only real booleans and a well-formed Clarity id (normalised)", () => {
    expect(resolveTracking({ shopifyEvents: false, ga4: true, meta: "yes", tiktok: 1, clarityId: "  AbC123xyz " })).toEqual({
      ...TRACKING_DEFAULTS,
      shopifyEvents: false,
      ga4: true,
      clarityId: "abc123xyz",
    });
  });

  it.each(['x"><script>', "abc", "a".repeat(21), "abc-123-def", 42])("drops Clarity id %j", (clarityId) => {
    expect(resolveTracking({ clarityId }).clarityId).toBe("");
  });

  it("ignores unknown keys", () => {
    expect(Object.keys(resolveTracking({ evil: true, ga4: true })).sort()).toEqual(Object.keys(TRACKING_DEFAULTS).sort());
  });
});

describe("storefront contract", () => {
  const source = readFileSync(path.resolve(__dirname, "../../scripts/extension-assets-src/reel-tracking.js"), "utf8");

  it("event names match reel-tracking.js in every naming", () => {
    for (const event of TRACKED_EVENTS) {
      expect(source).toContain(`["${event.name}", "${event.pascal}", "${event.label}"]`);
    }
  });

  it("the Clarity id pattern matches the storefront's", () => {
    expect(source).toContain(`const CLARITY_ID = ${String(CLARITY_ID_PATTERN)};`);
  });
});

describe("customPixelCode", () => {
  it("GA4: loads gtag with the measurement id, no page view, and subscribes to every event", () => {
    const code = customPixelCode("ga4", "G-AB12CD34EF");
    expect(code).toContain("https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF");
    expect(code).toContain('gtag("config", "G-AB12CD34EF", { send_page_view: false });');
    for (const event of TRACKED_EVENTS) expect(code).toContain(`"${event.name}"`);
    expect(code).toContain('analytics.subscribe(name, (event) => gtag("event", name, event.customData));');
  });

  it("Meta: inits the pixel and sends custom events in Meta's naming", () => {
    const code = customPixelCode("meta", "1234567890123456");
    expect(code).toContain('fbq("init", "1234567890123456");');
    expect(code).toContain('"reelup_add_to_cart": "ReelupAddToCart"');
    expect(code).toContain('fbq("trackCustom", names[name], event.customData)');
    expect(code).not.toContain("PageView");
  });

  it("never injects a malformed id into the code", () => {
    expect(customPixelCode("ga4", '"); alert(1); ("')).toContain("G-XXXXXXXXXX");
    expect(customPixelCode("meta", "12</script>")).toContain("YOUR_PIXEL_ID");
  });

  it("generated code is valid JavaScript", () => {
    for (const tool of ["ga4", "meta", "any"] as const) {
      // Parses only; analytics/gtag/fbq are the custom pixel sandbox's globals.
      expect(() => new Function("analytics", "dataLayer", "fbq", customPixelCode(tool, ""))).not.toThrow();
    }
  });
});
