import type { Shop } from "@prisma/client";
import prisma from "../db.server";

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
  const existing = await prisma.shop.findUnique({ where: { shopDomain } });
  if (existing) return existing;

  return prisma.shop.create({
    data: {
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
