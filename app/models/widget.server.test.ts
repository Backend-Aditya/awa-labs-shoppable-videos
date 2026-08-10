import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../db.server";
import { getOrCreateShop } from "./shop.server";
import {
  createWidget,
  listWidgetsForShop,
  setWidgetPublished,
  deleteWidget,
  getWidget,
  updateWidget,
  updateWidgetTargetRule,
  syncWidgetConfigMetafield,
} from "./widget.server";

describe("widget.server", () => {
  beforeEach(async () => {
    await prisma.widget.deleteMany();
    await prisma.shop.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a widget scoped to a shop, unpublished by default", async () => {
    const shop = await getOrCreateShop("widget-test.myshopify.com");
    const widget = await createWidget(shop.id, "CAROUSEL", "Homepage carousel", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });

    expect(widget.type).toBe("CAROUSEL");
    expect(widget.published).toBe(false);
  });

  it("lists only widgets belonging to the given shop", async () => {
    const shopA = await getOrCreateShop("widget-a.myshopify.com");
    const shopB = await getOrCreateShop("widget-b.myshopify.com");
    await createWidget(shopA.id, "GRID", "A grid", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await createWidget(shopB.id, "STORIES", "B stories", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });

    const widgetsForA = await listWidgetsForShop(shopA.id);
    expect(widgetsForA).toHaveLength(1);
    expect(widgetsForA[0].name).toBe("A grid");
  });

  it("publishes and deletes a widget", async () => {
    const shop = await getOrCreateShop("widget-c.myshopify.com");
    const widget = await createWidget(shop.id, "REEL_POPS", "Pop", {
      templateStyle: "classic",
      targetRule: { type: "handles", handles: ["a-product"] },
    });

    const published = await setWidgetPublished(widget.id, true);
    expect(published.published).toBe(true);

    await deleteWidget(widget.id);
    const remaining = await listWidgetsForShop(shop.id);
    expect(remaining).toHaveLength(0);
  });

  it("gets a widget scoped to its shop, returns null for a different shop or missing id", async () => {
    const shopA = await getOrCreateShop("widget-get-a.myshopify.com");
    const shopB = await getOrCreateShop("widget-get-b.myshopify.com");
    const widget = await createWidget(shopA.id, "GRID", "A grid", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });

    const found = await getWidget(shopA.id, widget.id);
    expect(found?.id).toBe(widget.id);

    const wrongShop = await getWidget(shopB.id, widget.id);
    expect(wrongShop).toBeNull();

    const missing = await getWidget(shopA.id, "nonexistent-id");
    expect(missing).toBeNull();
  });

  it("updates a widget's name and published flag", async () => {
    const shop = await getOrCreateShop("widget-update.myshopify.com");
    const widget = await createWidget(shop.id, "CAROUSEL", "Original name", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });

    const updated = await updateWidget(widget.id, {
      name: "Renamed carousel",
      published: true,
    });

    expect(updated.name).toBe("Renamed carousel");
    expect(updated.published).toBe(true);
  });

  it("updates only the provided fields, leaving others unchanged", async () => {
    const shop = await getOrCreateShop("widget-partial-update.myshopify.com");
    const widget = await createWidget(shop.id, "STORIES", "Keep my name", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });

    const updated = await updateWidget(widget.id, { published: true });

    expect(updated.name).toBe("Keep my name");
    expect(updated.published).toBe(true);
  });

  it("updates a widget's targetRule to specific product handles", async () => {
    const shop = await getOrCreateShop("widget-target-handles.myshopify.com");
    const widget = await createWidget(shop.id, "REEL_POPS", "Targeted pop", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });

    const updated = await updateWidgetTargetRule(widget.id, {
      type: "handles",
      handles: ["blue-shirt", "red-hat"],
    });

    expect(updated.config).toEqual({
      templateStyle: "classic",
      targetRule: { type: "handles", handles: ["blue-shirt", "red-hat"] },
    });
  });

  it("resets a widget's targetRule to all_products, preserving other config keys", async () => {
    const shop = await getOrCreateShop("widget-target-reset.myshopify.com");
    const widget = await createWidget(shop.id, "REEL_POPS", "Reset pop", {
      templateStyle: "bold",
      targetRule: { type: "handles", handles: ["old-handle"] },
    });

    const updated = await updateWidgetTargetRule(widget.id, { type: "all_products" });

    expect(updated.config).toEqual({
      templateStyle: "bold",
      targetRule: { type: "all_products" },
    });
  });
});

describe("syncWidgetConfigMetafield", () => {
  it("writes a shop-level $app metafield with published state and targetRule", async () => {
    let capturedSetVariables: Record<string, unknown> | undefined;
    const admin = {
      graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
        if (query.includes("GetShopId")) {
          return { json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" } } }) };
        }
        capturedSetVariables = options?.variables;
        return { json: async () => ({ data: { metafieldsSet: { userErrors: [] } } }) };
      },
    };

    await syncWidgetConfigMetafield(admin, {
      type: "PRODUCT_PAGE_REELS",
      published: true,
      config: { templateStyle: "classic", targetRule: { type: "all_products" } },
    });

    expect(capturedSetVariables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "product_page_reels_widget",
          type: "json",
          value: JSON.stringify({
            published: true,
            targetRule: { type: "all_products" },
          }),
        },
      ],
    });
  });

  it("does nothing for widget kinds other than PRODUCT_PAGE_REELS", async () => {
    let callCount = 0;
    const admin = {
      graphql: async () => {
        callCount += 1;
        return { json: async () => ({ data: {} }) };
      },
    };

    await syncWidgetConfigMetafield(admin, {
      type: "CAROUSEL",
      published: true,
      config: { templateStyle: "classic", targetRule: { type: "all_products" } },
    });

    expect(callCount).toBe(0);
  });

  it("throws if the metafieldsSet mutation returns userErrors", async () => {
    const admin = {
      graphql: async (query: string) => {
        if (query.includes("GetShopId")) {
          return { json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" } } }) };
        }
        return {
          json: async () => ({
            data: {
              metafieldsSet: {
                userErrors: [{ field: ["metafields", "0", "value"], message: "bad value" }],
              },
            },
          }),
        };
      },
    };

    await expect(
      syncWidgetConfigMetafield(admin, {
        type: "PRODUCT_PAGE_REELS",
        published: false,
        config: { templateStyle: "classic", targetRule: { type: "all_products" } },
      }),
    ).rejects.toThrow("bad value");
  });
});
