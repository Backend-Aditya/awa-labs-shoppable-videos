import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { getOrCreateShop } from "./shop.server";
import { getDashboardStats, reelKey } from "./analytics.server";
import { BRAND_DEFAULTS, resolveBrand } from "./brand";

describe("reelKey", () => {
  it("normalises GIDs and bare ids to the same key", () => {
    expect(reelKey("gid://shopify/Metaobject/42")).toBe("42");
    expect(reelKey("42")).toBe("42");
  });
});

describe("resolveBrand", () => {
  it("fills defaults and rejects bad values", () => {
    expect(resolveBrand(null)).toEqual(BRAND_DEFAULTS);
    const brand = resolveBrand({ buttonColor: "#ABCDEF", accentColor: "blue", viewerTheme: "light", fontFamily: "comic" });
    expect(brand.buttonColor).toBe("#abcdef");
    expect(brand.accentColor).toBe(BRAND_DEFAULTS.accentColor);
    expect(brand.viewerTheme).toBe("light");
    expect(brand.fontFamily).toBe("theme");
  });
});

describe("getDashboardStats", () => {
  beforeEach(async () => {
    await prisma.reelEvent.deleteMany();
    await prisma.orderAttribution.deleteMany();
    await prisma.widget.deleteMany();
    await prisma.shop.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("splits current vs previous period and merges GID and numeric reel ids", async () => {
    const shop = await getOrCreateShop("dashboard.myshopify.com");
    const now = new Date("2026-10-10T12:00:00Z");
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

    await prisma.reelEvent.createMany({
      data: [
        { shopId: shop.id, reelId: "gid://shopify/Metaobject/7", eventType: "view", createdAt: daysAgo(1) },
        { shopId: shop.id, reelId: "7", eventType: "view", createdAt: daysAgo(2) },
        { shopId: shop.id, reelId: "7", eventType: "click_product", createdAt: daysAgo(2) },
        { shopId: shop.id, reelId: "9", eventType: "view", createdAt: daysAgo(40) },
      ],
    });
    await prisma.orderAttribution.create({
      data: {
        shopId: shop.id,
        reelId: "gid://shopify/Metaobject/7",
        orderId: "o1",
        orderName: "#1001",
        lineItemId: "l1",
        quantity: 2,
        revenueAmount: new Prisma.Decimal("50.00"),
        currencyCode: "USD",
        createdAt: daysAgo(1),
      },
    });

    const stats = await getDashboardStats(shop.id, 30, now);

    expect(stats.current).toMatchObject({ views: 2, clicks: 1, orders: 1 });
    expect(stats.current.revenue).toEqual([{ currencyCode: "USD", amount: 50 }]);
    expect(stats.previous.views).toBe(1);
    expect(stats.daily).toHaveLength(30);
    expect(stats.daily.reduce((n, d) => n + d.views, 0)).toBe(2);
    expect(stats.reels).toEqual([{ key: "7", views: 2, clicks: 1, unitsSold: 2, revenue: 50 }]);
  });
});
