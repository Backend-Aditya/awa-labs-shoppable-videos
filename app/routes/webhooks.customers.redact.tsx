import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { log } from "../lib/logger.server";

// Mandatory GDPR webhook. The only customer-linked data this app keeps is
// OrderAttribution (which reel led to which order line). For the orders
// Shopify lists, drop the order identifiers but keep the anonymous amounts
// so a merchant's revenue totals stay correct.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const orderIds = ((payload as { orders_to_redact?: (number | string)[] }).orders_to_redact ?? []).map(String);

  let redacted = 0;
  if (orderIds.length > 0) {
    const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop } });
    if (shopRow) {
      const rows = await prisma.orderAttribution.findMany({
        where: { shopId: shopRow.id, orderId: { in: orderIds } },
        select: { id: true },
      });
      for (const row of rows) {
        await prisma.orderAttribution.update({
          where: { id: row.id },
          data: { orderId: `redacted-${row.id}`, orderName: "Redacted" },
        });
      }
      redacted = rows.length;
    }
  }

  log.info("gdpr.customers_redact", { shop, topic, orders: orderIds.length, redacted });
  return new Response();
};
