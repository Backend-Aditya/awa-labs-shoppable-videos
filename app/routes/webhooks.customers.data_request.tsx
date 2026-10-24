import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { log } from "../lib/logger.server";

// Mandatory GDPR webhook. The app stores no customer profile data; the only
// customer-linked records are OrderAttribution rows for the customer's
// orders. They're logged here so the store owner can be sent them (reel,
// order name, quantity, amount), Shopify relays the request to the merchant.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const orderIds = ((payload as { orders_requested?: (number | string)[] }).orders_requested ?? []).map(String);

  let records: { reelId: string; orderName: string; quantity: number; revenueAmount: string; currencyCode: string }[] = [];
  if (orderIds.length > 0) {
    const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop } });
    if (shopRow) {
      const rows = await prisma.orderAttribution.findMany({
        where: { shopId: shopRow.id, orderId: { in: orderIds } },
        select: { reelId: true, orderName: true, quantity: true, revenueAmount: true, currencyCode: true },
      });
      records = rows.map((r) => ({ ...r, revenueAmount: r.revenueAmount.toFixed(2) }));
    }
  }

  log.info("gdpr.customers_data_request", { shop, topic, orders: orderIds.length, records });
  return new Response();
};
