// Deep links into the merchant's live theme editor. The shopify://admin form
// is resolved by App Bridge, so it works without knowing the shop domain and
// keeps the merchant inside the Shopify admin.
type Placement = { block: string; template: string; target: string } | { embed: string };

const PLACEMENT: Record<string, Placement> = {
  PRODUCT_PAGE_REELS: { block: "product-page-reels", template: "product", target: "mainSection" },
  ADD_TO_CART_VIDEO: { block: "add-to-cart-video", template: "product", target: "mainSection" },
  CAROUSEL: { block: "stacked-carousel", template: "index", target: "newAppsSection" },
  STORIES: { block: "insta-stories", template: "index", target: "newAppsSection" },
  SINGLE_VIDEO: { block: "single-video", template: "index", target: "newAppsSection" },
  REEL_POPS: { embed: "shoppable-videos" },
};

const BASE = "shopify://admin/themes/current/editor";

export function themeEditorUrl(apiKey: string, kind?: string): string {
  const placement = kind ? PLACEMENT[kind] : undefined;
  if (!placement || "embed" in placement) {
    return `${BASE}?context=apps&template=index&activateAppId=${apiKey}/shoppable-videos`;
  }
  return `${BASE}?template=${placement.template}&addAppBlockId=${apiKey}/${placement.block}&target=${placement.target}`;
}

export function blockHandleFor(kind: string): string | null {
  const placement = PLACEMENT[kind];
  return placement && "block" in placement ? placement.block : null;
}
