import type { Prisma, Widget } from "@prisma/client";
import prisma from "../db.server";
import type { AdminGraphqlClient } from "./reel.server";
import { assertNoGraphqlErrors, throwOnUserErrors } from "./reel.server";

export type WidgetKind =
  | "PRODUCT_PAGE_REELS"
  | "CAROUSEL"
  | "GRID"
  | "STORIES"
  | "REEL_POPS"
  | "SINGLE_VIDEO";

export interface WidgetConfig {
  templateStyle: string;
  targetRule:
    | { type: "all_products" }
    | { type: "handles"; handles: string[] };
  featuredReelId?: string;
  reelIds?: string[];
}

export async function createWidget(
  shopId: string,
  type: WidgetKind,
  name: string,
  config: WidgetConfig,
): Promise<Widget> {
  return prisma.widget.create({
    data: {
      shopId,
      type,
      name,
      config: config as unknown as Prisma.InputJsonValue,
      published: false,
    },
  });
}

export async function listWidgetsForShop(shopId: string): Promise<Widget[]> {
  return prisma.widget.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
}

// Test-only helper: flips `published` directly without enforcing the
// one-published-widget-per-type invariant and without syncing the shop
// metafield. Production code must go through `updateWidget` instead.
export async function setWidgetPublished(
  id: string,
  published: boolean,
): Promise<Widget> {
  return prisma.widget.update({ where: { id }, data: { published } });
}

export async function deleteWidget(admin: AdminGraphqlClient, id: string): Promise<void> {
  const existing = await prisma.widget.findUnique({ where: { id } });
  await prisma.widget.delete({ where: { id } });
  if (existing) {
    await syncShopWidgetState(admin, existing.shopId, existing.type as WidgetKind, {
      force: true,
    });
  }
}

export async function getWidget(
  shopId: string,
  id: string,
): Promise<Widget | null> {
  return prisma.widget.findFirst({ where: { id, shopId } });
}

export async function updateWidget(
  admin: AdminGraphqlClient,
  id: string,
  updates: { name?: string; published?: boolean },
): Promise<Widget> {
  const current = await prisma.widget.findUniqueOrThrow({ where: { id } });

  if (updates.published === true && !current.published) {
    const siblings = await prisma.widget.findMany({
      where: {
        shopId: current.shopId,
        type: current.type,
        published: true,
        id: { not: id },
      },
    });
    for (const sibling of siblings) {
      await prisma.widget.update({
        where: { id: sibling.id },
        data: { published: false },
      });
    }
  }

  const widget = await prisma.widget.update({ where: { id }, data: updates });
  // Single sync after all DB writes — it re-derives from the DB, so the
  // sibling unpublishes above don't need their own sync calls.
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
  return widget;
}

export async function updateWidgetTargetRule(
  admin: AdminGraphqlClient,
  id: string,
  targetRule: WidgetConfig["targetRule"],
): Promise<Widget> {
  const existing = await prisma.widget.findUniqueOrThrow({ where: { id } });
  const existingConfig = existing.config as unknown as WidgetConfig;
  const mergedConfig: WidgetConfig = { ...existingConfig, targetRule };

  const widget = await prisma.widget.update({
    where: { id },
    data: { config: mergedConfig as unknown as Prisma.InputJsonValue },
  });
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
  return widget;
}

interface WidgetMetafieldValue {
  published: boolean;
  targetRule: WidgetConfig["targetRule"];
}

interface WidgetKindSyncConfig {
  metafieldKey: string;
  featuredReelMetafieldKey?: string;
  reelListMetafieldKey?: string;
}

const WIDGET_KIND_SYNC_CONFIG: Partial<Record<WidgetKind, WidgetKindSyncConfig>> = {
  PRODUCT_PAGE_REELS: {
    metafieldKey: "product_page_reels_widget",
    reelListMetafieldKey: "product_page_reels_widget_reels",
  },
  SINGLE_VIDEO: {
    metafieldKey: "single_video_widget",
    featuredReelMetafieldKey: "single_video_featured_reel",
  },
  CAROUSEL: {
    metafieldKey: "stacked_carousel_widget",
    reelListMetafieldKey: "stacked_carousel_widget_reels",
  },
  STORIES: {
    metafieldKey: "insta_stories_widget",
    reelListMetafieldKey: "insta_stories_widget_reels",
  },
  REEL_POPS: {
    metafieldKey: "reel_pops_widget",
    featuredReelMetafieldKey: "reel_pops_featured_reel",
  },
};

async function getShopGid(admin: AdminGraphqlClient): Promise<string> {
  const response = await admin.graphql(
    `#graphql
    query GetShopId {
      shop { id }
    }`,
  );
  const json = await response.json();
  assertNoGraphqlErrors(json);
  return json.data.shop.id;
}

// Mirrors the shop's *current* state for one widget kind into that kind's
// shop-level metafield, so the storefront Liquid block for that kind (which
// has no access to this app's DB) can read it. Kinds absent from
// WIDGET_KIND_SYNC_CONFIG (GRID) are a no-op — no theme implementation
// reads a metafield for them yet, so writing one would just be dead data.
//
// The value is always DERIVED from the DB (the shop's one published widget
// of this kind, if any) rather than from whichever widget was just written
// — syncing "the widget that was just touched" would let an edit to an
// unrelated draft widget of the same kind clobber the live widget's state
// (this exact bug was fixed for PRODUCT_PAGE_REELS in the previous plan;
// every kind added here is subject to the same risk).
//
// `force` writes the metafield even when the shop has no widgets of this
// kind at all — needed by `deleteWidget`, which may have just removed the
// last one and still has to clear what it wrote.
export async function syncShopWidgetState(
  admin: AdminGraphqlClient,
  shopId: string,
  kind: WidgetKind,
  options: { force?: boolean } = {},
): Promise<void> {
  const syncConfig = WIDGET_KIND_SYNC_CONFIG[kind];
  if (!syncConfig) return;

  const live = await prisma.widget.findFirst({
    where: { shopId, type: kind, published: true },
  });

  if (!live && !options.force) {
    const everOfKind = await prisma.widget.count({ where: { shopId, type: kind } });
    if (everOfKind === 0) return;
  }

  const liveConfig = live ? (live.config as unknown as WidgetConfig) : null;
  const value: WidgetMetafieldValue = liveConfig
    ? { published: true, targetRule: liveConfig.targetRule }
    : { published: false, targetRule: { type: "all_products" } };

  const shopGid = await getShopGid(admin);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- metafieldsSet input shape varies per entry (json vs metaobject_reference)
  const metafields: any[] = [
    {
      ownerId: shopGid,
      namespace: "$app",
      key: syncConfig.metafieldKey,
      type: "json",
      value: JSON.stringify(value),
    },
  ];

  if (syncConfig.featuredReelMetafieldKey && liveConfig?.featuredReelId) {
    metafields.push({
      ownerId: shopGid,
      namespace: "$app",
      key: syncConfig.featuredReelMetafieldKey,
      type: "metaobject_reference",
      value: liveConfig.featuredReelId,
    });
  }

  if (syncConfig.reelListMetafieldKey && liveConfig?.reelIds && liveConfig.reelIds.length > 0) {
    metafields.push({
      ownerId: shopGid,
      namespace: "$app",
      key: syncConfig.reelListMetafieldKey,
      type: "list.metaobject_reference",
      value: JSON.stringify(liveConfig.reelIds),
    });
  }

  const response = await admin.graphql(
    `#graphql
    mutation SetWidgetConfigMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    { variables: { metafields } },
  );
  const json = await response.json();
  assertNoGraphqlErrors(json);
  throwOnUserErrors(json.data.metafieldsSet.userErrors);
}

export async function updateWidgetFeaturedReel(
  admin: AdminGraphqlClient,
  id: string,
  featuredReelId: string,
): Promise<Widget> {
  const existing = await prisma.widget.findUniqueOrThrow({ where: { id } });
  const existingConfig = existing.config as unknown as WidgetConfig;
  const mergedConfig: WidgetConfig = { ...existingConfig, featuredReelId };

  const widget = await prisma.widget.update({
    where: { id },
    data: { config: mergedConfig as unknown as Prisma.InputJsonValue },
  });
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
  return widget;
}

export async function updateWidgetReels(
  admin: AdminGraphqlClient,
  id: string,
  reelIds: string[],
): Promise<Widget> {
  const existing = await prisma.widget.findUniqueOrThrow({ where: { id } });
  const existingConfig = existing.config as unknown as WidgetConfig;
  const mergedConfig: WidgetConfig = { ...existingConfig, reelIds };

  const widget = await prisma.widget.update({
    where: { id },
    data: { config: mergedConfig as unknown as Prisma.InputJsonValue },
  });
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
  return widget;
}
