import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../db.server";
import { getOrCreateShop, updateShopPlan, setShopEnabled, PLAN_VIEW_CAPS } from "./shop.server";

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

  it("defaults a new shop to enabled", async () => {
    const shop = await getOrCreateShop("test-shop.myshopify.com");
    expect(shop.enabled).toBe(true);
  });

  it("setShopEnabled updates the DB flag and syncs the shop.metafields.$app.enabled metafield", async () => {
    await getOrCreateShop("test-shop.myshopify.com");
    let capturedVariables: Record<string, unknown> | undefined;
    const admin = {
      graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
        if (query.includes("GetShopId")) {
          return { json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" } } }) };
        }
        capturedVariables = options?.variables;
        return { json: async () => ({ data: { metafieldsSet: { userErrors: [] } } }) };
      },
    };

    const updated = await setShopEnabled(admin, "test-shop.myshopify.com", false);

    expect(updated.enabled).toBe(false);
    expect(capturedVariables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "enabled",
          type: "boolean",
          value: "false",
        },
      ],
    });
  });
});
