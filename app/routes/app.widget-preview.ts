import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import { getWidget } from "../models/widget.server";
import { listReels } from "../models/reel.server";
import { getBrand } from "../models/brand.server";
import { sanitizeStyle } from "../models/widget-kinds";
import { previewSupported, renderWidgetPreview, themePagesFor, WIDGET_ROOT_CLASS } from "../models/widget-preview.server";
import { log } from "../lib/logger.server";
import { themeContextFor } from "../models/theme-styles.server";

// The widget editor's live preview (see widget-preview.server.ts): renders
// the real storefront block for the editor's current, unsaved settings.
// A resource route called with fetch (App Bridge adds the session token),
// so editing doesn't make React Router revalidate the editor's loader.
//
// Body: { widgetId, style, reelIds?, featuredReelId? }. The style goes
// through the same sanitizer as a save, so the preview can only show what
// could actually be saved.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ html: null, error: "Bad request" }, { status: 400 });
  }

  const widget = await getWidget(shop.id, String(body.widgetId ?? ""));
  if (!widget) return Response.json({ html: null, error: "Widget not found" }, { status: 404 });
  if (!previewSupported(widget.type)) return Response.json({ html: null, error: "No live preview for this widget" });

  const style = sanitizeStyle(widget.type, body.style);
  const wanted: string[] = Array.isArray(body.reelIds)
    ? body.reelIds.map(String)
    : body.featuredReelId
      ? [String(body.featuredReelId)]
      : [];

  try {
    const all = await listReels(admin);
    const reels = wanted
      .map((id) => all.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r && r.config.hlsManifestUrl));
    if (reels.length === 0) return Response.json({ html: null, error: null, empty: true });

    const [brand, shopInfo] = await Promise.all([getBrand(shop.id), shopDetails(admin)]);
    const handles = await productHandles(admin, [...new Set(reels.flatMap((r) => r.config.productIds ?? []))].slice(0, 3));
    const theme = shopInfo.storefrontUrl
      ? await themeContextFor(themePagesFor(widget.type, shopInfo.storefrontUrl, handles), WIDGET_ROOT_CLASS[widget.type] ?? "awa-sv")
      : undefined;
    const origin = new URL(request.url).origin;
    const html = await renderWidgetPreview({ admin, kind: widget.type, style, reels, brand, origin, moneyFormat: shopInfo.moneyFormat, theme });
    return Response.json({ html, error: null });
  } catch (error) {
    if (error instanceof Response) throw error;
    log.warn("widget.preview_failed", { widgetId: widget.id }, error);
    return Response.json({ html: null, error: "Couldn't build the live preview." });
  }
};

// Tagged products' handles: product page reels live on product pages, so
// that's where to look for the theme around them.
async function productHandles(admin: Parameters<typeof renderWidgetPreview>[0]["admin"], ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  try {
    const response = await admin.graphql(
      `#graphql
      query PreviewHandles($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { handle } } }`,
      { variables: { ids } },
    );
    const json = await response.json();
    return (json.data?.nodes ?? []).map((n: { handle?: string } | null) => n?.handle).filter(Boolean);
  } catch {
    return [];
  }
}

// The shop's money format and its storefront address (for the theme's styles).
async function shopDetails(
  admin: Parameters<typeof renderWidgetPreview>[0]["admin"],
): Promise<{ moneyFormat?: string; storefrontUrl?: string }> {
  try {
    const response = await admin.graphql(`#graphql
      query PreviewShop { shop { currencyFormats { moneyFormat } primaryDomain { url } } }`);
    const json = await response.json();
    return {
      moneyFormat: json.data?.shop?.currencyFormats?.moneyFormat ?? undefined,
      storefrontUrl: json.data?.shop?.primaryDomain?.url ?? undefined,
    };
  } catch {
    return {};
  }
}
