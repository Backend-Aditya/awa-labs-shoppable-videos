// The widget editor's live preview: the REAL storefront widget, rendered
// from the theme extension's own Liquid (blocks/*.liquid + snippets) with the
// merchant's real videos and products, and run with the real storefront CSS
// and JS in a sandboxed iframe. What the merchant sees while editing is what
// shoppers get, down to every setting, instead of a hand-drawn mock.
//
// Nothing here touches the storefront: the page's cart, product and
// recommendation requests are answered from the data loaded below, and
// links and navigation are swallowed.
import { createLiquidEngine, REEL_NAMESPACE } from "../lib/liquid-engine.server.mjs";
import type { AdminGraphqlClient, Reel } from "./reel.server";
import { assertNoGraphqlErrors } from "./reel.server";
import type { BrandConfig } from "./brand";
import type { WidgetKind, WidgetStyleConfig } from "./widget-kinds";
import type { ThemeContext } from "./theme-styles.server";
import { EMPTY_THEME } from "./theme-styles.server";

// Which block file renders each kind, and where it reads its data when no
// widget is picked in the block (the floating video only reads these).
const PREVIEW_BLOCKS: Partial<Record<WidgetKind, { file: string; widgetKey: string; reelsKey?: string; reelKey?: string }>> = {
  PRODUCT_PAGE_REELS: { file: "product-page-reels", widgetKey: "product_page_reels_widget", reelsKey: "product_page_reels_widget_reels" },
  CAROUSEL: { file: "stacked-carousel", widgetKey: "stacked_carousel_widget", reelsKey: "stacked_carousel_widget_reels" },
  STORIES: { file: "insta-stories", widgetKey: "insta_stories_widget", reelsKey: "insta_stories_widget_reels" },
  SINGLE_VIDEO: { file: "single-video", widgetKey: "single_video_widget", reelKey: "single_video_featured_reel" },
  ADD_TO_CART_VIDEO: { file: "add-to-cart-video", widgetKey: "add_to_cart_video_widget", reelKey: "add_to_cart_video_featured_reel" },
  REEL_POPS: { file: "shoppable-videos", widgetKey: "reel_pops_widget", reelKey: "reel_pops_featured_reel" },
};

// The storefront files the preview page loads (served by preview-assets.$file).
export const PREVIEW_ASSETS = new Set([
  "reel-widgets.css",
  "reel-lightbox.css",
  "reel-loader.js",
  "reel-hls.js",
  "reel-lightbox.js",
  "reel-story.js",
  "reel-trigger.js",
  "reel-pop.js",
  "reel-tracking.js",
  "hls.min.js",
]);

const cents = (amount: string | number | null | undefined) => Math.round(Number(amount ?? 0) * 100);

interface AdminVariant {
  legacyResourceId: string;
  title: string;
  price: string;
  compareAtPrice: string | null;
  availableForSale: boolean;
  image: { url: string } | null;
  selectedOptions: { name: string; value: string }[];
}
interface AdminProduct {
  id: string;
  legacyResourceId: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  hasOnlyDefaultVariant: boolean;
  featuredImage: { url: string; altText: string | null; width: number | null; height: number | null } | null;
  options: { name: string; values: string[] }[];
  images: { nodes: { url: string; altText: string | null }[] };
  variantsCount: { count: number } | null;
  variants: { nodes: AdminVariant[] };
}

async function loadProducts(admin: AdminGraphqlClient, ids: string[]): Promise<AdminProduct[]> {
  if (ids.length === 0) return [];
  const response = await admin.graphql(
    `#graphql
    query PreviewProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          legacyResourceId
          title
          handle
          descriptionHtml
          hasOnlyDefaultVariant
          featuredImage { url altText width height }
          options { name values }
          images(first: 10) { nodes { url altText } }
          variantsCount { count }
          variants(first: 30) {
            nodes {
              legacyResourceId
              title
              price
              compareAtPrice
              availableForSale
              image { url }
              selectedOptions { name value }
            }
          }
        }
      }
    }`,
    { variables: { ids } },
  );
  const json = await response.json();
  assertNoGraphqlErrors(json);
  return (json.data?.nodes ?? []).filter((node: AdminProduct | null) => node && node.id);
}

// A product the way Liquid sees it (the fields the blocks and snippets read).
function liquidProduct(product: AdminProduct) {
  const variants = product.variants.nodes.map((v) => ({
    id: Number(v.legacyResourceId),
    title: v.title,
    price: cents(v.price),
    compare_at_price: v.compareAtPrice ? cents(v.compareAtPrice) : null,
    available: v.availableForSale,
    featured_image: v.image ? { src: v.image.url } : null,
  }));
  const prices = variants.map((v) => v.price);
  const image = product.featuredImage;
  return {
    id: Number(product.legacyResourceId),
    title: product.title,
    handle: product.handle,
    url: `/products/${product.handle}`,
    featured_image: image ? { src: image.url, aspect_ratio: image.width && image.height ? image.width / image.height : 1 } : null,
    price: Math.min(...prices),
    price_min: Math.min(...prices),
    price_varies: new Set(prices).size > 1,
    has_only_default_variant: product.hasOnlyDefaultVariant,
    variants_count: product.variantsCount?.count ?? variants.length,
    variants,
    selected_or_first_available_variant: variants.find((v) => v.available) ?? variants[0],
  };
}

// The same product as Shopify's Ajax endpoint (/products/<handle>.js)
// returns it: what the in-viewer product details view fetches.
function ajaxProduct(product: AdminProduct) {
  const variants = product.variants.nodes.map((v) => ({
    id: Number(v.legacyResourceId),
    title: v.title,
    options: v.selectedOptions.map((o) => o.value),
    price: cents(v.price),
    compare_at_price: v.compareAtPrice ? cents(v.compareAtPrice) : null,
    available: v.availableForSale,
    featured_image: v.image ? { src: v.image.url } : null,
  }));
  return {
    id: Number(product.legacyResourceId),
    title: product.title,
    handle: product.handle,
    url: `/products/${product.handle}`,
    description: product.descriptionHtml,
    options: product.options.map((o) => ({ name: o.name, values: o.values })),
    images: product.images.nodes.map((i) => i.url),
    media: product.images.nodes.map((i) => ({ src: i.url, alt: i.altText ?? "" })),
    price: Math.min(...variants.map((v) => v.price)),
    compare_at_price: variants[0]?.compare_at_price ?? null,
    featured_image: product.featuredImage?.url ?? null,
    variants,
  };
}

export interface PreviewInput {
  admin: AdminGraphqlClient;
  kind: WidgetKind;
  style: WidgetStyleConfig;
  reels: Reel[];
  brand: BrandConfig;
  // The app's origin: the preview page loads the storefront assets from it.
  origin: string;
  moneyFormat?: string;
  // The theme around the widget (theme-styles.server.ts), so the preview
  // matches the storefront; empty = the preview's neutral defaults.
  theme?: ThemeContext;
}

// The class on each kind's root element, to find it on the storefront.
export const WIDGET_ROOT_CLASS: Partial<Record<WidgetKind, string>> = {
  PRODUCT_PAGE_REELS: "awa-sv-strip",
  CAROUSEL: "awa-sv-deck",
  STORIES: "awa-sv-stories",
  SINGLE_VIDEO: "awa-sv-feature",
  ADD_TO_CART_VIDEO: "awa-sv-atc",
  REEL_POPS: "awa-sv-pop",
};

// The storefront pages where a kind's widget is most likely placed.
export function themePagesFor(kind: WidgetKind, storefrontUrl: string, productHandles: string[] = []): string[] {
  const home = storefrontUrl.replace(/\/$/, "") + "/";
  const products = productHandles.slice(0, 3).map((h) => `${home}products/${encodeURIComponent(h)}`);
  const onProductPage = kind === "PRODUCT_PAGE_REELS" || kind === "ADD_TO_CART_VIDEO";
  return onProductPage ? [...products, home] : [home, ...products];
}

export function previewSupported(kind: string): kind is WidgetKind {
  return kind in PREVIEW_BLOCKS;
}

export async function renderWidgetPreview({ admin, kind, style, reels, brand, origin, moneyFormat, theme = EMPTY_THEME }: PreviewInput): Promise<string> {
  const block = PREVIEW_BLOCKS[kind];
  if (!block) throw new Error(`No preview for ${kind}`);

  const productIds = [...new Set(reels.flatMap((r) => r.config.productIds ?? []))];
  const adminProducts = await loadProducts(admin, productIds);
  const byGid = new Map(adminProducts.map((p) => [p.id, p]));

  const reelObjects = reels.map((reel) => ({
    system: { id: reel.id, handle: reel.handle },
    title: { value: reel.title },
    // Drafts are previewed too: the merchant is looking at their widget.
    published: { value: true },
    config: { value: reel.config },
    tagged_products: {
      value: (reel.config.productIds ?? [])
        .map((id) => byGid.get(id))
        .filter((p): p is AdminProduct => Boolean(p))
        .map(liquidProduct),
    },
  }));

  // Always shown in the preview, wherever the widget is set to appear.
  const widgetValue = {
    published: true,
    targetRule: { type: "all_products" },
    style: kind === "REEL_POPS" ? { ...style, popDelay: 0 } : style,
    deviceVisibility: "all",
    pageTypes: [],
  };
  const entry = {
    name: { value: "Preview" },
    config: { value: widgetValue },
    reels: { value: reelObjects },
    featured_reel: { value: reelObjects[0] ?? null },
  };
  const metafields: Record<string, { value: unknown }> = {
    brand: { value: brand },
    [block.widgetKey]: { value: widgetValue },
  };
  if (block.reelsKey) metafields[block.reelsKey] = { value: reelObjects };
  if (block.reelKey) metafields[block.reelKey] = { value: reelObjects[0] ?? null };

  const assetBase = `${origin}/preview-assets`;
  const engine = createLiquidEngine({ assetBase, moneyFormat });
  const blockHtml = await engine.renderFile(block.file, {
    shop: { metafields: { [REEL_NAMESPACE]: metafields }, money_format: moneyFormat ?? "${{amount}}" },
    product: null,
    template: { name: "product" },
    block: { id: "preview", shopify_attributes: "", settings: { widget: kind === "REEL_POPS" ? undefined : entry } },
    routes: { cart_url: "/cart", cart_add_url: "/cart/add", product_recommendations_url: "/recommendations/products" },
    cart: { currency: { iso_code: "USD" } },
    request: { locale: { iso_code: "en" }, design_mode: false },
  });

  const ajax = Object.fromEntries(adminProducts.map((p) => [`/products/${p.handle}`, ajaxProduct(p)]));
  return previewPage(blockHtml, assetBase, ajax, theme);
}

const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

function previewPage(blockHtml: string, assetBase: string, products: Record<string, ReturnType<typeof ajaxProduct>>, theme: ThemeContext) {
  const themed = theme.head.trim().length > 0;
  const themeHead = theme.head;
  return `<!doctype html>
<html${theme.htmlAttrs || ' lang="en"'}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${themeHead}
<link rel="stylesheet" href="${assetBase}/reel-widgets.css">
<style>
${
  themed
    ? `  /* Your theme's styles are loaded above; only keep the page from scrolling sideways. */
  html, body { overflow-x: hidden; }
  body { min-height: 0 !important; }`
    : `  html, body { margin: 0; background: #fff; color: #1a1a1a; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 8px 24px 24px; }
  @media (max-width: 749px) { body { padding: 4px 16px 16px; } }`
}
  /* The editor outlines the part being edited (html[data-highlight]). */
  html[data-highlight="header"] .awa-sv-header,
  html[data-highlight="cards"] :is(.awa-sv-deck__poster, .awa-sv-strip__poster, .awa-sv-stories__avatar, .awa-sv-feature__poster, .awa-sv-atc__thumb),
  html[data-highlight="layout"] :is(.awa-sv-strip__track, .awa-sv-deck__stage, .awa-sv-stories__row),
  html[data-highlight="section"] section.awa-sv {
    outline: 2px dashed #005bd3;
    outline-offset: 3px;
  }
  html[data-highlight="layout"] .awa-sv-strip__track { outline-offset: -2px; }
</style>
<script>
  // Preview sandbox: answer the storefront's requests from the editor's data.
  (() => {
    const products = ${json(products)};
    const reply = (body, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    const realFetch = window.fetch.bind(window);
    let itemCount = 0;
    window.fetch = (input, init) => {
      // srcdoc pages have location "about:srcdoc"; resolve against the
      // document's base (the app's URL) instead.
      const url = new URL(typeof input === "string" ? input : input.url, document.baseURI);
      const path = url.pathname;
      if (path.startsWith("/cart/add")) {
        const body = JSON.parse((init && init.body) || "{}");
        const item = (body.items || [])[0] || {};
        itemCount += Number(item.quantity) || 1;
        return new Promise((resolve) => setTimeout(() => resolve(reply({ items: [{ ...item, variant_id: item.id, final_line_price: 0 }] })), 350));
      }
      if (path.startsWith("/cart")) return reply({ item_count: itemCount, items: [] });
      if (path.startsWith("/recommendations/")) {
        return reply({ products: Object.values(products).map((p) => ({ id: p.id, title: p.title, url: p.url, price: p.price, compare_at_price: p.compare_at_price, featured_image: p.featured_image })) });
      }
      if (path.startsWith("/apps/")) return reply({ ok: true });
      const product = products[path.replace(/\\.js$/, "")];
      if (product) return reply(product);
      return realFetch(input, init);
    };
    // Links and checkout don't leave the editor.
    window.addEventListener("click", (event) => {
      const link = event.target.closest && event.target.closest("a[href]");
      if (link) event.preventDefault();
    });
    const quiet = () => {
      if (window.AwaSvViewer) window.AwaSvViewer.navigate = () => {};
      else setTimeout(quiet, 100);
    };
    quiet();
  })();
</script>
</head>
<body${theme.bodyAttrs}>
<div id="awa-sv-preview-root">
${theme.placed ? `${theme.wrapOpen}
${blockHtml}
${theme.wrapClose}` : themed ? `<div style="padding-inline: clamp(16px, 4vw, 48px)">
${blockHtml}
</div>` : blockHtml}
</div>
<script src="${assetBase}/reel-loader.js"></script>
</body>
</html>`;
}
