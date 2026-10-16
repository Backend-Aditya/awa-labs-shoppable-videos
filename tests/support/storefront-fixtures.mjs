// Fixture builders for Liquid drops (shop, product, reel metaobject,
// widget metafield) shaped like what Shopify hands the theme extension.
// Shared by the liquid, storefront and e2e layers.
import { REEL_NAMESPACE } from "./liquid-engine.mjs";

/**
 * @typedef {{ id: number, title?: string, price?: number, compare_at_price?: number | null, available?: boolean }} VariantInput
 * @typedef {{ id?: number, title?: string, handle?: string, image?: string | null, variants?: VariantInput[], collections?: string[] }} ProductInput
 */

/** @param {ProductInput} [input] */
export function makeProduct({ id = 1, title = `Product ${id}`, handle, image = `https://cdn.test/products/${id}.jpg`, variants, collections = [] } = {}) {
  const list = (variants ?? [{ id: id * 100, title: "Default Title", price: 2500, compare_at_price: null, available: true }]).map((v) => ({
    title: "Default Title",
    price: 2500,
    compare_at_price: null,
    available: true,
    ...v,
  }));
  const productHandle = handle ?? `product-${id}`;
  return {
    id,
    title,
    handle: productHandle,
    url: `/products/${productHandle}`,
    featured_image: image ? { src: image } : null,
    price: list[0].price,
    has_only_default_variant: list.length === 1 && list[0].title === "Default Title",
    variants: list,
    selected_or_first_available_variant: list.find((v) => v.available) ?? list[0],
    collections: collections.map((c) => ({ handle: c })),
  };
}

/**
 * @param {{ id?: number, title?: string, published?: boolean, hls?: string, poster?: string | null, duration?: number | null, products?: object[], ctaUrl?: string, ctaLabel?: string, createdAt?: string }} [input]
 */
export function makeReel({
  id = 101,
  title = `Reel ${id}`,
  published = true,
  hls = `https://customer-test.cloudflarestream.com/${id}/manifest/video.m3u8`,
  poster = `https://cdn.test/posters/${id}.jpg`,
  duration = 42,
  products = [],
  ctaUrl,
  ctaLabel,
  createdAt = "2026-10-01T10:00:00Z",
} = {}) {
  const interactions = ctaUrl || ctaLabel ? { ctaUrl, ctaLabel } : undefined;
  return {
    system: { id: `gid://shopify/Metaobject/${id}`, created_at: createdAt },
    title: { value: title },
    published: { value: published },
    config: { value: { hlsManifestUrl: hls, posterUrl: poster, durationSeconds: duration, uploadedAt: createdAt, interactions } },
    tagged_products: { value: products },
  };
}

/**
 * @param {{ published?: boolean, targetRule?: object, pageTypes?: string[], style?: object, deviceVisibility?: string }} [input]
 */
export function makeWidget({ published = true, targetRule = { type: "all_products" }, pageTypes, style = {}, deviceVisibility } = {}) {
  return { published, targetRule, pageTypes, style, deviceVisibility };
}

/** Shop drop with app-owned metafields: { key: value } → shop.metafields[ns][key].value */
export function makeShop(metafields = {}) {
  const ns = {};
  for (const [key, value] of Object.entries(metafields)) ns[key] = { value };
  return { money_format: "${{amount}}", metafields: { [REEL_NAMESPACE]: ns } };
}

// Which shop metafields each block reads.
export const BLOCK_METAFIELDS = {
  "product-page-reels": { widget: "product_page_reels_widget", reels: "product_page_reels_widget_reels" },
  "stacked-carousel": { widget: "stacked_carousel_widget", reels: "stacked_carousel_widget_reels" },
  "insta-stories": { widget: "insta_stories_widget", reels: "insta_stories_widget_reels" },
  "single-video": { widget: "single_video_widget", reel: "single_video_featured_reel" },
  "add-to-cart-video": { widget: "add_to_cart_video_widget", reel: "add_to_cart_video_featured_reel" },
  "shoppable-videos": { widget: "reel_pops_widget", reel: "reel_pops_featured_reel" },
};

/**
 * Builds the full render context for one block.
 * @param {keyof typeof BLOCK_METAFIELDS} block
 * @param {{ widget?: object, reels?: object[], reel?: object, product?: object | null, template?: string, brand?: object, blockId?: string }} input
 */
export function blockContext(block, { widget = makeWidget(), reels = [], reel, product = null, template = "product", brand, blockId = "block-1" }) {
  const keys = BLOCK_METAFIELDS[block];
  const metafields = { [keys.widget]: widget };
  if ("reels" in keys) metafields[keys.reels] = reels;
  if ("reel" in keys) metafields[keys.reel] = reel ?? reels[0];
  if (brand) metafields.brand = brand;
  return {
    shop: makeShop(metafields),
    product,
    template: { name: template },
    block: { id: blockId, shopify_attributes: "" },
    routes: {
      cart_url: "/cart",
      cart_add_url: "/cart/add",
      product_recommendations_url: "/recommendations/products",
    },
    cart: { currency: { iso_code: "USD" } },
    request: { locale: { iso_code: "en" } },
  };
}

/** A two-variant product (one sold out, one on sale) used across layers. */
export function multiVariantProduct(id = 7) {
  return makeProduct({
    id,
    title: "Linen Shirt",
    variants: [
      { id: id * 100 + 1, title: "Small", price: 4800, compare_at_price: 6000, available: true },
      { id: id * 100 + 2, title: "Medium", price: 5200, compare_at_price: null, available: true },
      { id: id * 100 + 3, title: "Large", price: 5200, compare_at_price: null, available: false },
    ],
  });
}
