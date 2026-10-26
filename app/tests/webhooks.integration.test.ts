import { createHmac } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "../db.server";

// The mandatory and lifecycle webhooks, signed and sent the way Shopify
// sends them, to a shop that holds data in every table. A shop with nothing in
// it hides erase failures: Shopify retries a 500 for hours, and an app that
// can't erase a shop fails review. The shop's session here is expired with a
// refresh token, as an uninstalled shop's is, and no handler may depend on it.
vi.mock("../models/cloudflare-stream.server", () => ({
  getCloudflareConfig: () => ({ accountId: "a", apiToken: "t" }),
  deleteStreamVideo: vi.fn(async () => {}),
}));

import { action as uninstalled } from "../routes/webhooks.app.uninstalled";
import { action as shopRedact } from "../routes/webhooks.shop.redact";
import { action as customersRedact } from "../routes/webhooks.customers.redact";
import { action as dataRequest } from "../routes/webhooks.customers.data_request";

const SHOP = "app-review-test-victim.myshopify.com";
const SECRET = "integration-secret";
const call = (handler: (args: ActionFunctionArgs) => Promise<Response>, topic: string, payload: object = { shop_domain: SHOP }) => {
  const body = JSON.stringify(payload);
  return handler({
    request: new Request("https://app.test/webhooks", {
      method: "POST",
      body,
      headers: {
        "x-shopify-hmac-sha256": createHmac("sha256", SECRET).update(body).digest("base64"),
        "x-shopify-shop-domain": SHOP,
        "x-shopify-topic": topic,
      },
    }),
  } as ActionFunctionArgs);
};

async function seedShop() {
  const shop = await prisma.shop.create({
    data: { shopDomain: SHOP, plan: "BASIC", viewCapMonthly: 6000, brand: { color: "#000" }, tracking: { ga4: true } },
  });
  const day = new Date("2026-10-20");
  await prisma.session.create({
    data: {
      id: `offline_${SHOP}`,
      shop: SHOP,
      state: "s",
      accessToken: "revoked",
      expires: new Date("2026-10-01"),
      refreshToken: "revoked-refresh",
      refreshTokenExpires: new Date("2026-10-02"),
    },
  });
  await prisma.widget.create({ data: { shopId: shop.id, type: "carousel", name: "w", config: {}, published: true } });
  await prisma.reelDailyStat.create({ data: { shopId: shop.id, reelId: "1", day, views: 3 } });
  await prisma.widgetDailyStat.create({ data: { shopId: shop.id, source: "carousel", day, views: 3 } });
  await prisma.productDailyStat.create({ data: { shopId: shop.id, productId: "9", day, clicks: 1 } });
  await prisma.reelEvent.create({ data: { shopId: shop.id, reelId: "1", eventType: "view" } });
  await prisma.streamAsset.create({ data: { uid: "cf-video-1", shopId: shop.id } });
  await prisma.orderAttribution.create({
    data: { shopId: shop.id, reelId: "1", orderId: "5001", orderName: "#1001", lineItemId: "l1", quantity: 1, revenueAmount: "10.00", currencyCode: "USD" },
  });
  return shop;
}

beforeEach(async () => {
  await prisma.session.deleteMany();
  await prisma.shop.deleteMany();
  process.env.SHOPIFY_API_SECRET = SECRET;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("webhooks for a shop that holds data", () => {
  it("rejects a request that is not signed by Shopify, and erases nothing", async () => {
    await seedShop();
    const response = await shopRedact({
      request: new Request("https://app.test/webhooks", { method: "POST", body: "{}", headers: { "x-shopify-hmac-sha256": "AAAA", "x-shopify-shop-domain": SHOP, "x-shopify-topic": "shop/redact" } }),
    } as ActionFunctionArgs).catch((r: Response) => r);
    expect(response.status).toBe(401);
    expect(await prisma.shop.count({ where: { shopDomain: SHOP } })).toBe(1);
  });

  it("app/uninstalled drops the session and puts the shop back on Free", async () => {
    await seedShop();
    expect((await call(uninstalled, "app/uninstalled")).status).toBe(200);
    expect(await prisma.session.count({ where: { shop: SHOP } })).toBe(0);
    expect((await prisma.shop.findUnique({ where: { shopDomain: SHOP } }))?.plan).toBe("FREE");
  });

  it("shop/redact erases the shop and everything that hangs off it", async () => {
    await seedShop();
    expect((await call(shopRedact, "shop/redact")).status).toBe(200);
    expect(await prisma.shop.count({ where: { shopDomain: SHOP } })).toBe(0);
    expect(await prisma.session.count({ where: { shop: SHOP } })).toBe(0);
    for (const table of ["widget", "reelDailyStat", "widgetDailyStat", "productDailyStat", "reelEvent", "streamAsset", "orderAttribution"] as const) {
      expect(await (prisma[table] as unknown as { count: () => Promise<number> }).count(), table).toBe(0);
    }
  });

  it("shop/redact is safe to run twice, as Shopify retries", async () => {
    await seedShop();
    expect((await call(shopRedact, "shop/redact")).status).toBe(200);
    expect((await call(shopRedact, "shop/redact")).status).toBe(200);
  });

  it("customers/redact keeps revenue totals but drops order identifiers", async () => {
    await seedShop();
    expect((await call(customersRedact, "customers/redact", { shop_domain: SHOP, orders_to_redact: [5001] })).status).toBe(200);
    const row = await prisma.orderAttribution.findFirstOrThrow();
    expect(row.orderName).toBe("Redacted");
    expect(row.orderId.startsWith("redacted-")).toBe(true);
  });

  it("customers/data_request answers for a shop with and without data", async () => {
    await seedShop();
    const payload = { shop_domain: SHOP, orders_requested: [5001] };
    expect((await call(dataRequest, "customers/data_request", payload)).status).toBe(200);
    await prisma.shop.deleteMany();
    expect((await call(dataRequest, "customers/data_request", payload)).status).toBe(200);
  });
});
