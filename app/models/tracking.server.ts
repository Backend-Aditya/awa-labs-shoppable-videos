import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import type { AdminGraphqlClient } from "./reel.server";
import { setShopAppMetafield } from "./shop-metafield.server";
import { resolveTracking } from "./tracking";
import type { TrackingConfig } from "./tracking";

export async function getTracking(shopId: string): Promise<TrackingConfig> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { tracking: true } });
  return resolveTracking(shop?.tracking);
}

// Saves the tracking integrations and mirrors them to the shop-level
// `$app.tracking` metafield, which every widget's config publishes to the
// storefront (reel-config.liquid) for reel-tracking.js.
export async function saveTracking(admin: AdminGraphqlClient, shopId: string, input: unknown): Promise<TrackingConfig> {
  const tracking = resolveTracking(input);
  await prisma.shop.update({
    where: { id: shopId },
    data: { tracking: tracking as unknown as Prisma.InputJsonValue },
  });
  await setShopAppMetafield(admin, "tracking", tracking);
  return tracking;
}
