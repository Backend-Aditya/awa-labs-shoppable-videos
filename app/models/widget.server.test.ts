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
  updateWidgetFeaturedReel,
  updateWidgetReels,
  syncShopWidgetState,
} from "./widget.server";

// Admin mock that records the variables passed to the metafieldsSet mutation.
function createRecordingAdmin() {
  const recorder: { variables?: Record<string, unknown>; callCount: number } = {
    variables: undefined,
    callCount: 0,
  };
  const admin = {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      recorder.callCount += 1;
      if (query.includes("GetShopId")) {
        return { json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" } } }) };
      }
      recorder.variables = options?.variables;
      return { json: async () => ({ data: { metafieldsSet: { userErrors: [] } } }) };
    },
  };
  return { admin, recorder };
}

// PRODUCT_PAGE_REELS always writes its reel-list field alongside its json
// state field (an empty array when the live widget has no curated reels),
// so this helper defaults to that shape unless a test overrides reelIds.
function expectedMetafields(value: unknown, reelIds: string[] = []) {
  return {
    metafields: [
      {
        ownerId: "gid://shopify/Shop/1",
        namespace: "$app",
        key: "product_page_reels_widget",
        type: "json",
        value: JSON.stringify(value),
      },
      {
        ownerId: "gid://shopify/Shop/1",
        namespace: "$app",
        key: "product_page_reels_widget_reels",
        type: "list.metaobject_reference",
        value: JSON.stringify(reelIds),
      },
    ],
  };
}

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
    const { admin } = createRecordingAdmin();

    const published = await setWidgetPublished(widget.id, true);
    expect(published.published).toBe(true);

    await deleteWidget(admin, shop.id, widget.id);
    const remaining = await listWidgetsForShop(shop.id);
    expect(remaining).toHaveLength(0);
  });

  it("syncs published:false when deleting a published PRODUCT_PAGE_REELS widget", async () => {
    const shop = await getOrCreateShop("widget-delete-sync.myshopify.com");
    const widget = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "Deleted", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(widget.id, true);
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

    await deleteWidget(admin, shop.id, widget.id);

    expect(capturedSetVariables).toEqual(
      expectedMetafields({ published: false, targetRule: { type: "all_products" } }),
    );
  });

  it("refuses to update, delete, or retarget a widget belonging to a different shop", async () => {
    const shopA = await getOrCreateShop("widget-idor-a.myshopify.com");
    const shopB = await getOrCreateShop("widget-idor-b.myshopify.com");
    const widget = await createWidget(shopA.id, "CAROUSEL", "A's widget", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const { admin } = createRecordingAdmin();

    await expect(
      updateWidget(admin, shopB.id, widget.id, { name: "Hijacked" }),
    ).rejects.toThrow();
    await expect(
      updateWidgetTargetRule(admin, shopB.id, widget.id, { type: "all_products" }),
    ).rejects.toThrow();
    await expect(
      updateWidgetFeaturedReel(admin, shopB.id, widget.id, "gid://shopify/Metaobject/1"),
    ).rejects.toThrow();
    await expect(
      updateWidgetReels(admin, shopB.id, widget.id, []),
    ).rejects.toThrow();
    // deleteWidget is a no-op (not a throw) for a widget outside the given
    // shop, since the route always 404s before reaching it anyway.
    await deleteWidget(admin, shopB.id, widget.id);

    const stillThere = await getWidget(shopA.id, widget.id);
    expect(stillThere?.name).toBe("A's widget");
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
    const { admin } = createRecordingAdmin();

    const updated = await updateWidget(admin, shop.id, widget.id, {
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
    const { admin } = createRecordingAdmin();

    const updated = await updateWidget(admin, shop.id, widget.id, { published: true });

    expect(updated.name).toBe("Keep my name");
    expect(updated.published).toBe(true);
  });

  it("publishing a widget unpublishes another published widget of the same type and shop", async () => {
    const shop = await getOrCreateShop("widget-exclusive.myshopify.com");
    const first = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "First", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const second = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "Second", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await updateWidget(
      { graphql: async () => ({ json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" }, metafieldsSet: { userErrors: [] } } }) }) },
      shop.id,
      first.id,
      { published: true },
    );

    const secondPublishedResult = await updateWidget(
      { graphql: async () => ({ json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" }, metafieldsSet: { userErrors: [] } } }) }) },
      shop.id,
      second.id,
      { published: true },
    );

    const firstAfter = await getWidget(shop.id, first.id);
    expect(firstAfter?.published).toBe(false);
    expect(secondPublishedResult.published).toBe(true);
  });

  it("publishing a widget does not unpublish a widget of a different type or shop", async () => {
    const shopA = await getOrCreateShop("widget-exclusive-a.myshopify.com");
    const shopB = await getOrCreateShop("widget-exclusive-b.myshopify.com");
    const sameShopDifferentType = await createWidget(shopA.id, "CAROUSEL", "Carousel", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const differentShop = await createWidget(shopB.id, "PRODUCT_PAGE_REELS", "Other shop", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(sameShopDifferentType.id, true);
    await setWidgetPublished(differentShop.id, true);
    const target = await createWidget(shopA.id, "PRODUCT_PAGE_REELS", "Target", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const admin = { graphql: async () => ({ json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" }, metafieldsSet: { userErrors: [] } } }) }) };

    await updateWidget(admin, shopA.id, target.id, { published: true });

    const sameShopDifferentTypeAfter = await getWidget(shopA.id, sameShopDifferentType.id);
    const differentShopAfter = await getWidget(shopB.id, differentShop.id);
    expect(sameShopDifferentTypeAfter?.published).toBe(true);
    expect(differentShopAfter?.published).toBe(true);
  });

  it("updates a widget's targetRule to specific product handles", async () => {
    const shop = await getOrCreateShop("widget-target-handles.myshopify.com");
    const widget = await createWidget(shop.id, "REEL_POPS", "Targeted pop", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const { admin } = createRecordingAdmin();

    const updated = await updateWidgetTargetRule(admin, shop.id, widget.id, {
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
    const { admin } = createRecordingAdmin();

    const updated = await updateWidgetTargetRule(admin, shop.id, widget.id, { type: "all_products" });

    expect(updated.config).toEqual({
      templateStyle: "bold",
      targetRule: { type: "all_products" },
    });
  });

  it("syncs the shop metafield when targetRule changes on a published PRODUCT_PAGE_REELS widget", async () => {
    const shop = await getOrCreateShop("widget-target-sync.myshopify.com");
    const widget = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "Synced", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(widget.id, true);
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

    await updateWidgetTargetRule(admin, shop.id, widget.id, {
      type: "handles",
      handles: ["blue-shirt"],
    });

    expect(capturedSetVariables).toEqual(
      expectedMetafields({
        published: true,
        targetRule: { type: "handles", handles: ["blue-shirt"] },
      }),
    );
  });

  describe("shop metafield reflects the live widget, not the widget just touched", () => {
    async function seedLiveAndDraft(domain: string) {
      const shop = await getOrCreateShop(domain);
      const live = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "Live A", {
        templateStyle: "classic",
        targetRule: { type: "handles", handles: ["live-product"] },
      });
      await setWidgetPublished(live.id, true);
      const draft = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "Draft B", {
        templateStyle: "classic",
        targetRule: { type: "handles", handles: ["draft-product"] },
      });
      return { shop, live, draft };
    }

    const liveValue = {
      published: true,
      targetRule: { type: "handles", handles: ["live-product"] },
    };

    it("renaming an unrelated draft widget does not clobber the live widget's state", async () => {
      const { shop, draft } = await seedLiveAndDraft("widget-clobber-rename.myshopify.com");
      const { admin, recorder } = createRecordingAdmin();

      await updateWidget(admin, shop.id, draft.id, { name: "Draft B renamed" });

      expect(recorder.variables).toEqual(expectedMetafields(liveValue));
    });

    it("changing an unrelated draft widget's targetRule does not clobber the live widget's state", async () => {
      const { shop, draft } = await seedLiveAndDraft("widget-clobber-target.myshopify.com");
      const { admin, recorder } = createRecordingAdmin();

      await updateWidgetTargetRule(admin, shop.id, draft.id, {
        type: "handles",
        handles: ["some-other-product"],
      });

      expect(recorder.variables).toEqual(expectedMetafields(liveValue));
    });

    it("deleting an unrelated draft widget does not clobber the live widget's state", async () => {
      const { shop, draft } = await seedLiveAndDraft("widget-clobber-delete.myshopify.com");
      const { admin, recorder } = createRecordingAdmin();

      await deleteWidget(admin, shop.id, draft.id);

      expect(recorder.variables).toEqual(expectedMetafields(liveValue));
    });

    it("editing a widget of a different kind syncs only that kind's own metafield, not the reels widget's", async () => {
      const { shop } = await seedLiveAndDraft("widget-clobber-other-kind.myshopify.com");
      const carousel = await createWidget(shop.id, "CAROUSEL", "A carousel", {
        templateStyle: "classic",
        targetRule: { type: "all_products" },
      });
      const { admin, recorder } = createRecordingAdmin();

      await updateWidget(admin, shop.id, carousel.id, { name: "Renamed carousel", published: true });

      // Sync is scoped per-kind now, so publishing the carousel writes only
      // the carousel's own metafield — it never touches (and so can't
      // clobber) the unrelated live PRODUCT_PAGE_REELS widget's metafield.
      expect(recorder.variables).toEqual({
        metafields: [
          {
            ownerId: "gid://shopify/Shop/1",
            namespace: "$app",
            key: "stacked_carousel_widget",
            type: "json",
            value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
          },
          {
            ownerId: "gid://shopify/Shop/1",
            namespace: "$app",
            key: "stacked_carousel_widget_reels",
            type: "list.metaobject_reference",
            value: JSON.stringify([]),
          },
        ],
      });
    });
  });
});

describe("syncShopWidgetState", () => {
  beforeEach(async () => {
    await prisma.widget.deleteMany();
    await prisma.shop.deleteMany();
  });

  it("writes a shop-level $app metafield derived from the shop's published PRODUCT_PAGE_REELS widget", async () => {
    const shop = await getOrCreateShop("sync-state-published.myshopify.com");
    const widget = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "Live", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "PRODUCT_PAGE_REELS");

    expect(recorder.variables).toEqual(
      expectedMetafields({ published: true, targetRule: { type: "all_products" } }),
    );
  });

  it("writes published:false when the shop has a PRODUCT_PAGE_REELS widget but none published", async () => {
    const shop = await getOrCreateShop("sync-state-draft.myshopify.com");
    await createWidget(shop.id, "PRODUCT_PAGE_REELS", "Draft", {
      templateStyle: "classic",
      targetRule: { type: "handles", handles: ["x"] },
    });
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "PRODUCT_PAGE_REELS");

    expect(recorder.variables).toEqual(
      expectedMetafields({ published: false, targetRule: { type: "all_products" } }),
    );
  });

  it("makes no Shopify calls for a shop with no PRODUCT_PAGE_REELS widget", async () => {
    const shop = await getOrCreateShop("sync-state-none.myshopify.com");
    await createWidget(shop.id, "CAROUSEL", "Carousel", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "PRODUCT_PAGE_REELS");

    expect(recorder.callCount).toBe(0);
  });

  it("writes published:false anyway when forced (e.g. the last reels widget was just deleted)", async () => {
    const shop = await getOrCreateShop("sync-state-forced.myshopify.com");
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "PRODUCT_PAGE_REELS", { force: true });

    expect(recorder.variables).toEqual(
      expectedMetafields({ published: false, targetRule: { type: "all_products" } }),
    );
  });

  it("throws if the metafieldsSet mutation returns userErrors", async () => {
    const shop = await getOrCreateShop("sync-state-errors.myshopify.com");
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
      syncShopWidgetState(admin, shop.id, "PRODUCT_PAGE_REELS", { force: true }),
    ).rejects.toThrow("bad value");
  });

  it("syncs a different kind to its own metafield key", async () => {
    const shop = await getOrCreateShop("sync-state-carousel.myshopify.com");
    const widget = await createWidget(shop.id, "CAROUSEL", "Live carousel", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "CAROUSEL");

    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "stacked_carousel_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "stacked_carousel_widget_reels",
          type: "list.metaobject_reference",
          value: JSON.stringify([]),
        },
      ],
    });
  });

  it("makes no Shopify calls for GRID, which has no sync config", async () => {
    const shop = await getOrCreateShop("sync-state-grid.myshopify.com");
    await createWidget(shop.id, "GRID", "A grid", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "GRID");

    expect(recorder.callCount).toBe(0);
  });

  it("includes the featured-reel reference field for SINGLE_VIDEO when one is set", async () => {
    const shop = await getOrCreateShop("sync-state-single-video.myshopify.com");
    const widget = await createWidget(shop.id, "SINGLE_VIDEO", "Featured video", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
      featuredReelId: "gid://shopify/Metaobject/999",
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "SINGLE_VIDEO");

    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "single_video_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "single_video_featured_reel",
          type: "metaobject_reference",
          value: "gid://shopify/Metaobject/999",
        },
      ],
    });
  });

  it("omits the featured-reel field for SINGLE_VIDEO when none is set", async () => {
    const shop = await getOrCreateShop("sync-state-single-video-none.myshopify.com");
    const widget = await createWidget(shop.id, "SINGLE_VIDEO", "No reel yet", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "SINGLE_VIDEO");

    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "single_video_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
      ],
    });
  });

  it("includes the featured-reel reference field for ADD_TO_CART_VIDEO when one is set", async () => {
    const shop = await getOrCreateShop("sync-state-add-to-cart-video.myshopify.com");
    const widget = await createWidget(shop.id, "ADD_TO_CART_VIDEO", "ATC video", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
      featuredReelId: "gid://shopify/Metaobject/777",
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "ADD_TO_CART_VIDEO");

    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "add_to_cart_video_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "add_to_cart_video_featured_reel",
          type: "metaobject_reference",
          value: "gid://shopify/Metaobject/777",
        },
      ],
    });
  });

  it("includes the reel-list reference field for PRODUCT_PAGE_REELS when non-empty", async () => {
    const shop = await getOrCreateShop("sync-state-reel-list.myshopify.com");
    const widget = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "Curated", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
      reelIds: ["gid://shopify/Metaobject/10", "gid://shopify/Metaobject/11"],
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "PRODUCT_PAGE_REELS");

    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "product_page_reels_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "product_page_reels_widget_reels",
          type: "list.metaobject_reference",
          value: JSON.stringify(["gid://shopify/Metaobject/10", "gid://shopify/Metaobject/11"]),
        },
      ],
    });
  });

  it("writes the reel-list field as an empty array for PRODUCT_PAGE_REELS when reelIds is empty or unset", async () => {
    const shop = await getOrCreateShop("sync-state-reel-list-empty.myshopify.com");
    const widget = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "No reels yet", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "PRODUCT_PAGE_REELS");

    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "product_page_reels_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "product_page_reels_widget_reels",
          type: "list.metaobject_reference",
          value: JSON.stringify([]),
        },
      ],
    });
  });

  it("clears a previously-written reel list to an empty array once a widget's reels are all removed", async () => {
    const shop = await getOrCreateShop("sync-state-reel-list-cleared.myshopify.com");
    const widget = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "Was curated", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
      reelIds: ["gid://shopify/Metaobject/10", "gid://shopify/Metaobject/11"],
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    await updateWidgetReels(admin, shop.id, widget.id, []);

    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "product_page_reels_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "product_page_reels_widget_reels",
          type: "list.metaobject_reference",
          value: JSON.stringify([]),
        },
      ],
    });
  });

  it("includes the reel-list reference field for CAROUSEL under its own key", async () => {
    const shop = await getOrCreateShop("sync-state-carousel-reels.myshopify.com");
    const widget = await createWidget(shop.id, "CAROUSEL", "Deck", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
      reelIds: ["gid://shopify/Metaobject/20"],
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "CAROUSEL");

    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "stacked_carousel_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "stacked_carousel_widget_reels",
          type: "list.metaobject_reference",
          value: JSON.stringify(["gid://shopify/Metaobject/20"]),
        },
      ],
    });
  });
});

describe("updateWidgetFeaturedReel", () => {
  beforeEach(async () => {
    await prisma.widget.deleteMany();
    await prisma.shop.deleteMany();
  });

  it("sets featuredReelId on the widget's config and syncs", async () => {
    const shop = await getOrCreateShop("featured-reel-set.myshopify.com");
    const widget = await createWidget(shop.id, "SINGLE_VIDEO", "Featured", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    const updated = await updateWidgetFeaturedReel(admin, shop.id, widget.id, "gid://shopify/Metaobject/42");

    expect((updated.config as { featuredReelId?: string }).featuredReelId).toBe(
      "gid://shopify/Metaobject/42",
    );
    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "single_video_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "single_video_featured_reel",
          type: "metaobject_reference",
          value: "gid://shopify/Metaobject/42",
        },
      ],
    });
  });
});

describe("updateWidgetReels", () => {
  beforeEach(async () => {
    await prisma.widget.deleteMany();
    await prisma.shop.deleteMany();
  });

  it("sets reelIds on the widget's config, preserving order, and syncs", async () => {
    const shop = await getOrCreateShop("reels-set.myshopify.com");
    const widget = await createWidget(shop.id, "CAROUSEL", "Deck", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    const updated = await updateWidgetReels(admin, shop.id, widget.id, [
      "gid://shopify/Metaobject/2",
      "gid://shopify/Metaobject/1",
    ]);

    expect((updated.config as { reelIds?: string[] }).reelIds).toEqual([
      "gid://shopify/Metaobject/2",
      "gid://shopify/Metaobject/1",
    ]);
    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "stacked_carousel_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "stacked_carousel_widget_reels",
          type: "list.metaobject_reference",
          value: JSON.stringify(["gid://shopify/Metaobject/2", "gid://shopify/Metaobject/1"]),
        },
      ],
    });
  });

  it("syncing an unpublished widget's reel list writes an empty reel list (published:false wins)", async () => {
    const shop = await getOrCreateShop("reels-set-unpublished.myshopify.com");
    const widget = await createWidget(shop.id, "CAROUSEL", "Draft deck", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const { admin, recorder } = createRecordingAdmin();

    await updateWidgetReels(admin, shop.id, widget.id, ["gid://shopify/Metaobject/5"]);

    // Widget was never published, so syncShopWidgetState finds no "live"
    // widget for this kind — it writes published:false and, since `live`
    // is null, an empty reel list (the reference field is only ever built
    // from the DB's live/published widget's config, never from whichever
    // widget was just touched, and is always written — even empty — so a
    // stale reel list from a previously-live widget of this kind gets
    // cleared too).
    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "stacked_carousel_widget",
          type: "json",
          value: JSON.stringify({ published: false, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "stacked_carousel_widget_reels",
          type: "list.metaobject_reference",
          value: JSON.stringify([]),
        },
      ],
    });
  });
});
