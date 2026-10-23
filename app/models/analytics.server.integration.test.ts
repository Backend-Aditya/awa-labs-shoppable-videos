import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { getOrCreateShop } from "./shop.server";
import { getDashboardStats, getReelStats, getViewCountsByReel, parseRange, recordEvent, reelKey } from "./analytics.server";
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
    await prisma.reelDailyStat.deleteMany();
    await prisma.orderAttribution.deleteMany();
    await prisma.widget.deleteMany();
    await prisma.shop.deleteMany();
  });

  // Leave nothing behind: other files use the same order/line-item ids.
  afterEach(async () => {
    await prisma.reelDailyStat.deleteMany();
    await prisma.orderAttribution.deleteMany();
    await prisma.shop.deleteMany({ where: { shopDomain: "dashboard.myshopify.com" } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("splits current vs previous period and merges GID and numeric reel ids", async () => {
    const shop = await getOrCreateShop("dashboard.myshopify.com");
    const now = new Date("2026-10-10T12:00:00Z");
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

    await recordEvent(shop.id, "gid://shopify/Metaobject/7", "view", daysAgo(1));
    await recordEvent(shop.id, "7", "view", daysAgo(2));
    await recordEvent(shop.id, "7", "click_product", daysAgo(2));
    await recordEvent(shop.id, "9", "view", daysAgo(40));
    await prisma.orderAttribution.create({
      data: {
        shopId: shop.id,
        reelId: "gid://shopify/Metaobject/7",
        orderId: "dashboard-order-1",
        orderName: "#1001",
        lineItemId: "dashboard-line-1",
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
    expect(stats.reels).toEqual([
      { key: "7", views: 2, clicks: 1, addToCarts: 0, completions: 0, watchSeconds: 0, unitsSold: 2, revenue: 50 },
    ]);
  });

  it("accumulates concurrent events into one row per reel and day", async () => {
    const shop = await getOrCreateShop("dashboard.myshopify.com");
    const at = new Date("2026-10-10T08:00:00Z");
    // Small bursts: the hosted test database's pooler caps connections.
    for (let i = 0; i < 3; i++) {
      await Promise.all(Array.from({ length: 4 }, () => recordEvent(shop.id, "5", "view", at)));
    }
    await Promise.all(Array.from({ length: 3 }, () => recordEvent(shop.id, "gid://shopify/Metaobject/5", "click_product", at)));
    await recordEvent(shop.id, "5", "view", new Date("2026-10-10T23:59:59Z"));

    const rows = await prisma.reelDailyStat.findMany({ where: { shopId: shop.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reelId: "5", views: 13, clicks: 3 });
    expect(await getViewCountsByReel(shop.id)).toEqual({ "5": 13 });
  });

  it("counts adds to cart, completions and watch time into the same rollup row", async () => {
    const shop = await getOrCreateShop("dashboard.myshopify.com");
    const at = new Date("2026-10-10T08:00:00Z");
    const now = new Date("2026-10-10T12:00:00Z");
    await recordEvent(shop.id, "5", "view", at);
    await recordEvent(shop.id, "5", "view", at);
    await recordEvent(shop.id, "5", "add_to_cart", at);
    await recordEvent(shop.id, "5", "complete", at);
    await Promise.all([recordEvent(shop.id, "5", "watch", at, 31), recordEvent(shop.id, "5", "watch", at, 12)]);

    const rows = await prisma.reelDailyStat.findMany({ where: { shopId: shop.id } });
    expect(rows).toEqual([
      expect.objectContaining({ reelId: "5", views: 2, clicks: 0, addToCarts: 1, completions: 1, watchSeconds: 43 }),
    ]);
    const dashboard = await getDashboardStats(shop.id, 7, now);
    expect(dashboard.current).toMatchObject({ views: 2, addToCarts: 1, completions: 1, watchSeconds: 43 });
    expect(dashboard.reels[0]).toMatchObject({ key: "5", addToCarts: 1, completions: 1, watchSeconds: 43 });
    expect(await getReelStats(shop.id, "5", 7, now)).toMatchObject({ addToCarts: 1, completions: 1, watchSeconds: 43 });
  });

  it("reports one reel's window with a zero-filled daily series", async () => {
    const shop = await getOrCreateShop("dashboard.myshopify.com");
    const now = new Date("2026-10-10T12:00:00Z");
    await recordEvent(shop.id, "5", "view", new Date("2026-10-09T10:00:00Z"));
    await recordEvent(shop.id, "5", "click_product", new Date("2026-10-09T11:00:00Z"));
    await recordEvent(shop.id, "5", "view", new Date("2026-09-01T10:00:00Z"));
    await recordEvent(shop.id, "6", "view", new Date("2026-10-09T10:00:00Z"));

    const stats = await getReelStats(shop.id, "gid://shopify/Metaobject/5", 7, now);
    expect(stats).toMatchObject({ days: 7, views: 1, clicks: 1, orders: 0 });
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily.at(-1)?.date).toBe("2026-10-10");
    expect(stats.daily.find((d) => d.date === "2026-10-09")).toEqual({ date: "2026-10-09", views: 1, clicks: 1 });
  });
});

describe("parseRange", () => {
  it("accepts the supported windows and falls back to 30 days", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange("90")).toBe(90);
    expect(parseRange("365")).toBe(30);
    expect(parseRange(null)).toBe(30);
  });
});
