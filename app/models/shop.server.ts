import type { Shop } from "@prisma/client";
import prisma from "../db.server";

import { PLANS } from "./plans";
import type { PlanTier } from "./plans";

export type { PlanTier };

export const PLAN_VIEW_CAPS = Object.fromEntries(PLANS.map((p) => [p.tier, p.viewCap])) as Record<PlanTier, number>;

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
