import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../db.server";
import { getOrCreateShop } from "./shop.server";
import {
  extractAttributionsFromOrderPayload,
  getReelRevenueStats,
  getShopRevenueTotals,
  recordOrderAttributions,
} from "./order-attribution.server";
import type { OrderPaidWebhookPayload } from "./order-attribution.server";

describe("extractAttributionsFromOrderPayload", () => {
  it("returns an empty array when no line item carries the attribution property", () => {
    const payload: OrderPaidWebhookPayload = {
      id: 1,
      name: "#1001",
      currency: "USD",
      line_items: [
        { id: 10, product_id: 100, variant_id: 200, quantity: 1, price: "19.99", properties: [] },
        { id: 11, product_id: 101, variant_id: 201, quantity: 1, price: "9.99", properties: null },
      ],
    };
    expect(extractAttributionsFromOrderPayload(payload)).toEqual([]);
  });

  it("extracts only the line items carrying _reelup_reel_id", () => {
    const payload: OrderPaidWebhookPayload = {
      id: 2,
      name: "#1002",
      currency: "USD",
      line_items: [
        {
          id: 20,
          product_id: 100,
          variant_id: 200,
          quantity: 3,
          price: "19.99",
          properties: [{ name: "_reelup_reel_id", value: "gid://shopify/Metaobject/1" }],
        },
        { id: 21, product_id: 101, variant_id: 201, quantity: 1, price: "9.99", properties: [] },
      ],
    };

    expect(extractAttributionsFromOrderPayload(payload)).toEqual([
      {
        reelId: "gid://shopify/Metaobject/1",
        lineItemId: "20",
        productId: "100",
        variantId: "200",
        quantity: 3,
        revenueAmount: "59.97",
        currencyCode: "USD",
      },
    ]);
  });

  it("computes revenue with decimal precision, not float multiplication", () => {
    // 19.99 * 3 in native floating point is 59.964999999999996, not 59.97 —
    // this is exactly the rounding error the Decimal arithmetic avoids.
    const payload: OrderPaidWebhookPayload = {
      id: 3,
      name: "#1003",
      currency: "USD",
      line_items: [
        {
          id: 30,
          quantity: 3,
          price: "19.99",
          properties: [{ name: "_reelup_reel_id", value: "gid://shopify/Metaobject/1" }],
        },
      ],
    };
    expect(extractAttributionsFromOrderPayload(payload)[0].revenueAmount).toBe("59.97");
  });

  it("handles a missing line_items array without throwing", () => {
    const payload: OrderPaidWebhookPayload = { id: 4, name: "#1004", currency: "USD" };
    expect(extractAttributionsFromOrderPayload(payload)).toEqual([]);
  });
});

describe("recordOrderAttributions / revenue stats", () => {
  beforeEach(async () => {
    await prisma.orderAttribution.deleteMany();
    await prisma.shop.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records an attribution and reflects it in per-reel and shop-wide stats", async () => {
    const shop = await getOrCreateShop("order-attribution-test.myshopify.com");
    const reelId = "gid://shopify/Metaobject/1";

    await recordOrderAttributions(shop.id, "order-1", "#1001", [
      {
        reelId,
        lineItemId: "li-1",
        productId: "100",
        variantId: "200",
        quantity: 2,
        revenueAmount: "39.98",
        currencyCode: "USD",
      },
    ]);

    const reelStats = await getReelRevenueStats(shop.id, reelId);
    expect(reelStats).toEqual([{ orderCount: 1, revenue: "39.98", currencyCode: "USD" }]);

    const shopTotals = await getShopRevenueTotals(shop.id);
    expect(shopTotals).toEqual({
      totalOrderCount: 1,
      totalsByCurrency: [{ currencyCode: "USD", revenue: "39.98" }],
    });
  });

  it("is idempotent — redelivering the same order/line-item webhook doesn't double-count revenue", async () => {
    const shop = await getOrCreateShop("order-attribution-idempotent.myshopify.com");
    const reelId = "gid://shopify/Metaobject/1";
    const attribution = [
      {
        reelId,
        lineItemId: "li-1",
        productId: "100",
        variantId: "200",
        quantity: 1,
        revenueAmount: "19.99",
        currencyCode: "USD",
      },
    ];

    await recordOrderAttributions(shop.id, "order-1", "#1001", attribution);
    await recordOrderAttributions(shop.id, "order-1", "#1001", attribution); // redelivery

    const reelStats = await getReelRevenueStats(shop.id, reelId);
    expect(reelStats).toEqual([{ orderCount: 1, revenue: "19.99", currencyCode: "USD" }]);
  });

  it("counts a multi-line-item order as one order, not one per line item", async () => {
    const shop = await getOrCreateShop("order-attribution-multi-line.myshopify.com");
    const reelId = "gid://shopify/Metaobject/1";

    await recordOrderAttributions(shop.id, "order-1", "#1001", [
      {
        reelId,
        lineItemId: "li-1",
        productId: "100",
        variantId: "200",
        quantity: 1,
        revenueAmount: "10.00",
        currencyCode: "USD",
      },
      {
        reelId,
        lineItemId: "li-2",
        productId: "101",
        variantId: "201",
        quantity: 1,
        revenueAmount: "15.00",
        currencyCode: "USD",
      },
    ]);

    const reelStats = await getReelRevenueStats(shop.id, reelId);
    expect(reelStats).toEqual([{ orderCount: 1, revenue: "25.00", currencyCode: "USD" }]);
  });

  it("keeps separate currencies as separate totals rather than summing across them", async () => {
    const shop = await getOrCreateShop("order-attribution-multi-currency.myshopify.com");
    const reelId = "gid://shopify/Metaobject/1";

    await recordOrderAttributions(shop.id, "order-usd", "#1001", [
      {
        reelId,
        lineItemId: "li-1",
        productId: "100",
        variantId: "200",
        quantity: 1,
        revenueAmount: "20.00",
        currencyCode: "USD",
      },
    ]);
    await recordOrderAttributions(shop.id, "order-eur", "#1002", [
      {
        reelId,
        lineItemId: "li-2",
        productId: "100",
        variantId: "200",
        quantity: 1,
        revenueAmount: "18.00",
        currencyCode: "EUR",
      },
    ]);

    const reelStats = await getReelRevenueStats(shop.id, reelId);
    expect(reelStats.sort((a, b) => a.currencyCode!.localeCompare(b.currencyCode!))).toEqual([
      { orderCount: 1, revenue: "18.00", currencyCode: "EUR" },
      { orderCount: 1, revenue: "20.00", currencyCode: "USD" },
    ]);
  });

  it("does nothing when given an empty attribution list", async () => {
    const shop = await getOrCreateShop("order-attribution-empty.myshopify.com");
    await recordOrderAttributions(shop.id, "order-1", "#1001", []);

    const shopTotals = await getShopRevenueTotals(shop.id);
    expect(shopTotals).toEqual({ totalOrderCount: 0, totalsByCurrency: [] });
  });
});
