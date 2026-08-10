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

export async function setWidgetPublished(
  id: string,
  published: boolean,
): Promise<Widget> {
  return prisma.widget.update({ where: { id }, data: { published } });
}

export async function deleteWidget(id: string): Promise<void> {
  await prisma.widget.delete({ where: { id } });
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
      const unpublished = await prisma.widget.update({
        where: { id: sibling.id },
        data: { published: false },
      });
      await syncWidgetConfigMetafield(admin, unpublished);
    }
  }

  const widget = await prisma.widget.update({ where: { id }, data: updates });
  await syncWidgetConfigMetafield(admin, widget);
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
  await syncWidgetConfigMetafield(admin, widget);
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

// Mirrors Widget.published/config.targetRule into a shop-level metafield so
// the storefront Liquid block (which has no access to this app's Postgres
// DB) can read it. Scoped to PRODUCT_PAGE_REELS only — the other widget
// kinds have no theme implementation yet, so writing a metafield for them
// would just be dead data no block reads.
export async function syncWidgetConfigMetafield(
  admin: AdminGraphqlClient,
  widget: Pick<Widget, "type" | "published" | "config">,
): Promise<void> {
  if (widget.type !== "PRODUCT_PAGE_REELS") return;

  const shopGid = await getShopGid(admin);
  const config = widget.config as unknown as WidgetConfig;
  const value: WidgetMetafieldValue = {
    published: widget.published,
    targetRule: config.targetRule,
  };

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
