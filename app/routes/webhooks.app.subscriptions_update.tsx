import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { planFromBillingName } from "../models/plans";
import { updateShopPlan } from "../models/shop.server";
import db from "../db.server";
import { log } from "../lib/logger.server";

// Keeps the shop's plan in step with its Shopify subscription when a charge
// is approved, declined, cancelled, frozen or expires, even if the merchant
// never comes back to the pricing page.
//
// Payload: { app_subscription: { admin_graphql_api_id, name, status, ... } }
const ENDED = new Set(["CANCELLED", "DECLINED", "EXPIRED", "FROZEN"]);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  log.info("billing.subscription_update", { shop, topic });

  const subscription = (payload as { app_subscription?: { name?: string; status?: string } }).app_subscription;
  const plan = planFromBillingName(subscription?.name);
  const status = subscription?.status ?? "";
  if (!plan) return new Response();

  const row = await db.shop.findUnique({ where: { shopDomain: shop }, select: { plan: true } });
  if (!row) return new Response();

  if (status === "ACTIVE") {
    await updateShopPlan(shop, plan.tier);
  } else if (ENDED.has(status) && row.plan === plan.tier) {
    // Only downgrade if the ended subscription is the one the shop is on; an
    // old plan being replaced by a new one must not undo the new plan.
    await updateShopPlan(shop, "FREE");
  }

  return new Response();
};
