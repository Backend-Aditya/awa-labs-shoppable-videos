import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { purgeShopStreamAssets } from "../models/stream-assets.server";
import { log } from "../lib/logger.server";

// Mandatory GDPR webhook, fires ~48h after uninstall. Must erase all data
// this app holds for the shop. Widget, ReelEvent and ReelDailyStat have an
// onDelete: Cascade relation to Shop, so deleting the Shop row alone
// takes them with it.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  // Cloudflare videos first: deleting the Shop row cascades away the
  // records of which videos it owned.
  const shopRow = await db.shop.findUnique({ where: { shopDomain: shop } });
  if (shopRow) {
    const failed = await purgeShopStreamAssets(shopRow.id);
    if (failed > 0) log.error("shop_redact.stream_assets_left", { shop, failed });
  }
  await db.shop.deleteMany({ where: { shopDomain: shop } });
  await db.session.deleteMany({ where: { shop } });

  return new Response();
};
