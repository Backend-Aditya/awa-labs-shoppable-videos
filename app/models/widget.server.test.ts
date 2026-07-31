import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../db.server";
import { getOrCreateShop } from "./shop.server";
import {
  createWidget,
  listWidgetsForShop,
  setWidgetPublished,
  deleteWidget,
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
});
