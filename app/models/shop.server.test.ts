import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../db.server";
import { getOrCreateShop, updateShopPlan, PLAN_VIEW_CAPS } from "./shop.server";

describe("shop.server", () => {
  beforeEach(async () => {
    await prisma.widget.deleteMany();
    await prisma.shop.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a shop with FREE defaults on first lookup", async () => {
    const shop = await getOrCreateShop("test-shop.myshopify.com");
    expect(shop.plan).toBe("FREE");
    expect(shop.viewCapMonthly).toBe(PLAN_VIEW_CAPS.FREE);
  });

  it("returns the existing shop on a second lookup instead of creating a duplicate", async () => {
    const first = await getOrCreateShop("test-shop.myshopify.com");
    const second = await getOrCreateShop("test-shop.myshopify.com");
    expect(second.id).toBe(first.id);
    const count = await prisma.shop.count({
      where: { shopDomain: "test-shop.myshopify.com" },
    });
    expect(count).toBe(1);
  });

  it("updates plan and view cap together", async () => {
    await getOrCreateShop("test-shop.myshopify.com");
    const updated = await updateShopPlan("test-shop.myshopify.com", "PREMIUM");
    expect(updated.plan).toBe("PREMIUM");
    expect(updated.viewCapMonthly).toBe(PLAN_VIEW_CAPS.PREMIUM);
  });
});
