import type { ActionFunctionArgs } from "react-router";
import { verifyWebhook } from "../lib/webhook.server";
import db from "../db.server";
import { PLAN_VIEW_CAPS } from "../models/shop.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await verifyWebhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled,
  // so deleting sessions that may already be gone is fine.
  await db.session.deleteMany({ where: { shop } });

  // Shopify cancels the subscription on uninstall; a reinstall starts on Free
  // until the shop subscribes again.
  await db.shop.updateMany({ where: { shopDomain: shop }, data: { plan: "FREE", viewCapMonthly: PLAN_VIEW_CAPS.FREE } });

  return new Response();
};
