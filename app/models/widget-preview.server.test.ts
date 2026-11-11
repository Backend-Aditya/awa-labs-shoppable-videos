// The live preview renders the real storefront block from the extension's
// Liquid, with Liquid-shaped product data and a sandboxed page.
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { previewSupported, renderWidgetPreview } from "./widget-preview.server";
import type { Reel } from "./reel.server";
import { BRAND_DEFAULTS } from "./brand";

const reel = (n: number, productIds: string[] = ["gid://shopify/Product/11"]): Reel => ({
  id: `gid://shopify/Metaobject/${n}`,
  handle: `reel-${n}`,
  title: `Reel ${n}`,
  published: false,
  config: {
    hlsManifestUrl: `https://customer-x.cloudflarestream.com/${n}/manifest/video.m3u8`,
    posterUrl: `https://customer-x.cloudflarestream.com/${n}/thumbnails/thumbnail.jpg`,
    durationSeconds: 30,
    productIds,
    interactions: {},
    source: { type: "upload" },
  },
});

const product = {
  id: "gid://shopify/Product/11",
  legacyResourceId: "11",
  title: "Antilia <Chair>",
  handle: "antilia-chair",
  descriptionHtml: "<p>Solid wood</p>",
  hasOnlyDefaultVariant: false,
  featuredImage: { url: "https://cdn.shopify.com/chair.jpg?v=1", altText: null, width: 800, height: 1000 },
  options: [{ name: "Color", values: ["Black", "Teak"] }],
  images: { nodes: [{ url: "https://cdn.shopify.com/chair.jpg?v=1", altText: "Chair" }] },
  variantsCount: { count: 2 },
  variants: {
    nodes: [
      { legacyResourceId: "101", title: "Black", price: "169.99", compareAtPrice: "424.98", availableForSale: true, image: null, selectedOptions: [{ name: "Color", value: "Black" }] },
      { legacyResourceId: "102", title: "Teak", price: "179.99", compareAtPrice: null, availableForSale: false, image: null, selectedOptions: [{ name: "Color", value: "Teak" }] },
    ],
  },
};

const admin = {
  graphql: async () => ({ json: async () => ({ data: { nodes: [product] } }) }),
};

async function render(kind: Parameters<typeof renderWidgetPreview>[0]["kind"], style = {}, reels = [reel(1), reel(2), reel(3)], moneyFormat?: string) {
  const html = await renderWidgetPreview({ admin, kind, style, reels, brand: BRAND_DEFAULTS, origin: "https://app.test", moneyFormat });
  return { html, doc: new JSDOM(html).window.document };
}

describe("renderWidgetPreview", () => {
  it("renders the real carousel block with the editor's style, drafts included", async () => {
    const { doc } = await render("CAROUSEL", { cardTemplate: "overlay", heading: "See it", layoutMode: "carousel", showCardBadge: true });
    const section = doc.querySelector("section.awa-sv-deck")!;
    expect(section.className).toContain("awa-sv-cards--overlay");
    expect(doc.querySelector(".awa-sv-heading")!.textContent).toBe("See it");
    expect(doc.querySelectorAll("[data-awa-sv-trigger]")).toHaveLength(3);
    expect(doc.querySelector(".awa-sv-card__product-title")!.textContent).toBe("Antilia <Chair>");
    expect(doc.querySelector(".awa-sv-card__badge")!.textContent).toBe("60% OFF");
  });

  it("uses the shop's money format", async () => {
    const { doc } = await render("CAROUSEL", { cardTemplate: "overlay" }, [reel(1)], "Rs. {{amount}}");
    expect(doc.querySelector(".awa-sv-card__product-price span")!.textContent).toBe("Rs. 169.99");
  });

  it("loads the real storefront assets from the app and answers product requests locally", async () => {
    const { html, doc } = await render("PRODUCT_PAGE_REELS");
    expect(doc.querySelector('link[href="https://app.test/preview-assets/reel-widgets.css"]')).not.toBeNull();
    expect(doc.querySelector('script[src="https://app.test/preview-assets/reel-loader.js"]')).not.toBeNull();
    // The Ajax product (for in-viewer product details) is embedded, escaped.
    expect(html).toContain('"/products/antilia-chair":{"id":11');
    expect(html).toContain("Antilia \\u003cChair>");
    expect(html).not.toContain("<Chair>");
  });

  it.each([
    ["STORIES", ".awa-sv-stories"],
    ["SINGLE_VIDEO", ".awa-sv-feature"],
    ["ADD_TO_CART_VIDEO", ".awa-sv-atc"],
    ["REEL_POPS", "[data-awa-sv-pop]"],
  ] as const)("%s renders its own block", async (kind, selector) => {
    const { doc } = await render(kind);
    expect(doc.querySelector(selector)).not.toBeNull();
  });

  it("only the widget kinds with a block are supported", () => {
    expect(previewSupported("CAROUSEL")).toBe(true);
    expect(previewSupported("GRID")).toBe(false);
  });
});
