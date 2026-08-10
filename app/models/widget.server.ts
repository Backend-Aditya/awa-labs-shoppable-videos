import type { Prisma, Widget } from "@prisma/client";
import prisma from "../db.server";
import type { AdminGraphqlClient } from "./reel.server";
import { assertNoGraphqlErrors, throwOnUserErrors } from "./reel.server";

export type WidgetKind =
  | "PRODUCT_PAGE_REELS"
  | "CAROUSEL"
  | "GRID"
  | "STORIES"
  | "REEL_POPS";

export interface WidgetConfig {
  templateStyle: string;
  targetRule:
    | { type: "all_products" }
    | { type: "handles"; handles: string[] };
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
    // Force the sync when the deleted widget was the reels widget: after the
    // delete the shop may have no PRODUCT_PAGE_REELS rows left at all, and we
    // still need to clear any metafield the deleted widget had written.
    await syncShopWidgetState(admin, existing.shopId, {
      force: existing.type === "PRODUCT_PAGE_REELS",
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
  await syncShopWidgetState(admin, widget.shopId);
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
  await syncShopWidgetState(admin, widget.shopId);
  return widget;
}

interface WidgetMetafieldValue {
  published: boolean;
  targetRule: WidgetConfig["targetRule"];
}

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

// Mirrors the shop's *current* PRODUCT_PAGE_REELS state into a shop-level
// metafield so the storefront Liquid block (which has no access to this
// app's DB) can read it. Scoped to PRODUCT_PAGE_REELS only — the other
// widget kinds have no theme implementation yet, so writing a metafield for
// them would just be dead data no block reads.
//
// The value is always DERIVED from the DB (the shop's one published
// PRODUCT_PAGE_REELS widget, if any) rather than from whichever widget was
// just written. The metafield is a shop-level singleton, so syncing "the
// widget that was just touched" would let an edit to an unrelated draft
// widget clobber the live widget's state.
//
// `force` writes the metafield even when the shop has no PRODUCT_PAGE_REELS
// widgets at all — needed by `deleteWidget`, which may have just removed the
// last one and still has to clear what it wrote.
export async function syncShopWidgetState(
  admin: AdminGraphqlClient,
  shopId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const live = await prisma.widget.findFirst({
    where: { shopId, type: "PRODUCT_PAGE_REELS", published: true },
  });

  if (!live && !options.force) {
    // Nothing published now — only worth a write if this shop has a
    // PRODUCT_PAGE_REELS widget whose state could have been mirrored before.
    // A shop that has never had one has no metafield to correct, so skip the
    // Shopify round-trips entirely.
    const everReels = await prisma.widget.count({
      where: { shopId, type: "PRODUCT_PAGE_REELS" },
    });
    if (everReels === 0) return;
  }

  const value: WidgetMetafieldValue = live
    ? {
        published: true,
        targetRule: (live.config as unknown as WidgetConfig).targetRule,
      }
    : { published: false, targetRule: { type: "all_products" } };

  const shopGid = await getShopGid(admin);

  const response = await admin.graphql(
    `#graphql
    mutation SetWidgetConfigMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopGid,
            namespace: "$app",
            key: "product_page_reels_widget",
            type: "json",
            value: JSON.stringify(value),
          },
        ],
      },
    },
  );
  const json = await response.json();
  assertNoGraphqlErrors(json);
  throwOnUserErrors(json.data.metafieldsSet.userErrors);
}
