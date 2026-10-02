import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import { assertNoGraphqlErrors, throwOnUserErrors } from "./reel.server";
import type { AdminGraphqlClient } from "./reel.server";
import { getShopGid } from "./widget.server";

const SHOP_METAFIELD_NAMESPACE = "$app";

export type PlanTier = "FREE" | "BASIC" | "PREMIUM" | "ELITE";

// 2x ReelUp's equivalent tier (Free 100 / Basic 3,000 / Premium 20,000 / Elite 50,000),
// priced 30% below ReelUp at each tier.
export const PLAN_VIEW_CAPS: Record<PlanTier, number> = {
  FREE: 200,
  BASIC: 6000,
  PREMIUM: 40000,
  ELITE: 100000,
};

export async function getOrCreateShop(shopDomain: string): Promise<Shop> {
  return prisma.shop.upsert({
    where: { shopDomain },
    update: {},
    create: {
      shopDomain,
      plan: "FREE",
      viewCapMonthly: PLAN_VIEW_CAPS.FREE,
    },
  });
}

export async function updateShopPlan(
  shopDomain: string,
  plan: PlanTier,
): Promise<Shop> {
  return prisma.shop.update({
    where: { shopDomain },
    data: { plan, viewCapMonthly: PLAN_VIEW_CAPS[plan] },
  });
}

// Pushes the shop's master enable flag to shop.metafields.$app.enabled —
// every storefront block reads this one metafield in addition to its own
// widget-level published state, so flipping it off hides everything at
// once without touching each widget individually.
export async function syncShopEnabledState(
  admin: AdminGraphqlClient,
  shopGid: string,
  enabled: boolean,
): Promise<void> {
  const response = await admin.graphql(
    `#graphql
    mutation SetShopEnabledMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopGid,
            namespace: SHOP_METAFIELD_NAMESPACE,
            key: "enabled",
            type: "boolean",
            value: enabled ? "true" : "false",
          },
        ],
      },
    },
  );
  const json = await response.json();
  assertNoGraphqlErrors(json);
  throwOnUserErrors(json.data.metafieldsSet.userErrors);
}

export async function setShopEnabled(
  admin: AdminGraphqlClient,
  shopDomain: string,
  enabled: boolean,
): Promise<Shop> {
  const shop = await prisma.shop.update({
    where: { shopDomain },
    data: { enabled },
  });
  const shopGid = await getShopGid(admin);
  await syncShopEnabledState(admin, shopGid, enabled);
  return shop;
}
