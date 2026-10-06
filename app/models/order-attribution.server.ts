import { Prisma } from "@prisma/client";
import prisma from "../db.server";

export interface AttributedLineItem {
  reelId: string;
  lineItemId: string;
  productId: string | null;
  variantId: string | null;
  quantity: number;
  // Shop-currency amount for this line item (price * quantity), as a
  // decimal string straight from the webhook payload — never computed by
  // multiplying floats ourselves.
  revenueAmount: string;
  currencyCode: string;
}

// Upsert, not insert: orders/paid is at-least-once delivery, and the same
// order legitimately arrives more than once. The @@unique([orderId,
// lineItemId]) constraint is what makes this idempotent rather than
// double-counting revenue on a redelivered webhook.
export async function recordOrderAttributions(
  shopId: string,
  orderId: string,
  orderName: string,
  lineItems: AttributedLineItem[],
): Promise<void> {
  if (lineItems.length === 0) return;

  await prisma.$transaction(
    lineItems.map((item) =>
      prisma.orderAttribution.upsert({
        where: { orderId_lineItemId: { orderId, lineItemId: item.lineItemId } },
        create: {
          shopId,
          reelId: item.reelId,
          orderId,
          orderName,
          lineItemId: item.lineItemId,
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          revenueAmount: new Prisma.Decimal(item.revenueAmount),
          currencyCode: item.currencyCode,
        },
        update: {}, // already recorded — webhook redelivery, nothing to change
      }),
    ),
  );
}

export interface ReelRevenueStats {
  orderCount: number;
  revenue: string;
  currencyCode: string | null;
}

// Revenue per distinct order, not per line item — a shopper buying 3 units
// in one order is 1 order, not 3. Groups by currencyCode too since a shop
// with multiple presentment currencies shouldn't have its totals silently
// summed across currencies; callers needing a single number should pick
// the shop's primary currency's entry (typically the only one in practice).
export async function getReelRevenueStats(
  shopId: string,
  reelId: string,
): Promise<ReelRevenueStats[]> {
  const rows = await prisma.orderAttribution.groupBy({
    by: ["currencyCode"],
    where: { shopId, reelId },
    _sum: { revenueAmount: true },
    _count: { _all: true },
  });

  // _count._all counts line items, not distinct orders — a reel attributed
  // to 2 line items in the same order would otherwise double-count that
  // order. Re-derive the distinct order count per currency separately.
  const results: ReelRevenueStats[] = [];
  for (const row of rows) {
    const orders = await prisma.orderAttribution.findMany({
      where: { shopId, reelId, currencyCode: row.currencyCode },
      select: { orderId: true },
      distinct: ["orderId"],
    });
    results.push({
      orderCount: orders.length,
      revenue: (row._sum.revenueAmount ?? new Prisma.Decimal(0)).toFixed(2),
      currencyCode: row.currencyCode,
    });
  }
  return results;
}

// Shopify's orders/paid REST webhook payload shape, narrowed to just the
// fields this extracts — deliberately NOT the full payload type (which
// carries customer name/email/address/etc.) so nothing beyond what's
// listed here can accidentally get threaded through to storage or logs.
export interface OrderPaidWebhookPayload {
  id: number | string;
  name: string;
  currency: string;
  line_items?: {
    id: number | string;
    product_id?: number | string | null;
    variant_id?: number | string | null;
    quantity: number;
    price: string;
    properties?: { name: string; value: string }[] | null;
  }[];
}

const ATTRIBUTION_PROPERTY_NAME = "_reelup_reel_id";

// Pure, no I/O — takes the webhook payload and returns only the line items
// that were actually added via a reel (i.e. carry the hidden property
// reel-lightbox.js/reel-story.js attach on /cart/add.js). Most orders will
// return an empty array; that's the expected common case, not an error.
export function extractAttributionsFromOrderPayload(
  payload: OrderPaidWebhookPayload,
): AttributedLineItem[] {
  const attributions: AttributedLineItem[] = [];

  for (const item of payload.line_items ?? []) {
    const reelId = item.properties?.find((p) => p.name === ATTRIBUTION_PROPERTY_NAME)?.value;
    if (!reelId) continue;

    attributions.push({
      reelId,
      lineItemId: String(item.id),
      productId: item.product_id != null ? String(item.product_id) : null,
      variantId: item.variant_id != null ? String(item.variant_id) : null,
      quantity: item.quantity,
      // Decimal multiplication, not float — price * quantity as native
      // numbers can introduce cent-level rounding error (e.g. 19.99 * 3
      // isn't guaranteed to be exactly 59.97 in floating point), which
      // compounds across an order history that's meant to be exact money.
      revenueAmount: new Prisma.Decimal(item.price).mul(item.quantity).toFixed(2),
      currencyCode: payload.currency,
    });
  }

  return attributions;
}

export interface ShopRevenueTotals {
  totalOrderCount: number;
  totalsByCurrency: { currencyCode: string; revenue: string }[];
}

export async function getShopRevenueTotals(shopId: string): Promise<ShopRevenueTotals> {
  const sums = await prisma.orderAttribution.groupBy({
    by: ["currencyCode"],
    where: { shopId },
    _sum: { revenueAmount: true },
  });
  const distinctOrders = await prisma.orderAttribution.findMany({
    where: { shopId },
    select: { orderId: true },
    distinct: ["orderId"],
  });

  return {
    totalOrderCount: distinctOrders.length,
    totalsByCurrency: sums.map((row) => ({
      currencyCode: row.currencyCode,
      revenue: (row._sum.revenueAmount ?? new Prisma.Decimal(0)).toFixed(2),
    })),
  };
}
