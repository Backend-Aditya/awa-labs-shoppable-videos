import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import { getWidget } from "../models/widget.server";
import { listReels } from "../models/reel.server";
import { getBrand } from "../models/brand.server";
import { sanitizeStyle } from "../models/widget-kinds";
import { previewSupported, renderWidgetPreview } from "../models/widget-preview.server";
import { log } from "../lib/logger.server";

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

    const [brand, moneyFormat] = await Promise.all([getBrand(shop.id), shopMoneyFormat(admin)]);
    const origin = new URL(request.url).origin;
    const html = await renderWidgetPreview({ admin, kind: widget.type, style, reels, brand, origin, moneyFormat });
    return Response.json({ html, error: null });
  } catch (error) {
    if (error instanceof Response) throw error;
    log.warn("widget.preview_failed", { widgetId: widget.id }, error);
    return Response.json({ html: null, error: "Couldn't build the live preview." });
  }
};

async function shopMoneyFormat(admin: Parameters<typeof renderWidgetPreview>[0]["admin"]): Promise<string | undefined> {
  try {
    const response = await admin.graphql(`#graphql
      query PreviewMoneyFormat { shop { currencyFormats { moneyFormat } } }`);
    const json = await response.json();
    return json.data?.shop?.currencyFormats?.moneyFormat ?? undefined;
  } catch {
    return undefined;
  }
}
