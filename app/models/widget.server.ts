import type { Prisma, Widget } from "@prisma/client";
import prisma from "../db.server";
import type { AdminGraphqlClient } from "./reel.server";
import { assertNoGraphqlErrors, throwOnUserErrors } from "./reel.server";
import { log } from "../lib/logger.server";

import type { WidgetConfig, WidgetKind, WidgetStyleConfig } from "./widget-kinds";
export type { WidgetConfig, WidgetKind, WidgetStyleConfig } from "./widget-kinds";

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

// Only the floating video is one-per-store (it lives in the single app
// embed). Every other kind is a theme block, and a block picks which widget
// it shows, so any number of them can be live at once.
export const isSingleLiveKind = (kind: string) => kind === "REEL_POPS";

// Test-only helper: flips `published` directly without enforcing the
// one-live floating video rule and without syncing the shop
// metafield. Production code must go through `updateWidget` instead.
export async function setWidgetPublished(
  id: string,
  published: boolean,
): Promise<Widget> {
  return prisma.widget.update({ where: { id }, data: { published } });
}

export async function deleteWidget(
  admin: AdminGraphqlClient,
  shopId: string,
  id: string,
): Promise<void> {
  const existing = await prisma.widget.findFirst({ where: { id, shopId } });
  if (!existing) return;
  // Take it off the storefront BEFORE dropping the row: if the metafield
  // sync fails, the widget still exists (unpublished) and the merchant can
  // retry, instead of a deleted widget staying live with no way to stop it.
  if (existing.published) {
    await prisma.widget.update({ where: { id }, data: { published: false } });
    await syncShopWidgetState(admin, existing.shopId, existing.type as WidgetKind, { force: true });
  }
  await prisma.widget.delete({ where: { id } });
  // Blocks that picked it fall back to the kind's live widget.
  await deleteWidgetEntry(admin, existing);
}

export async function getWidget(
  shopId: string,
  id: string,
): Promise<Widget | null> {
  return prisma.widget.findFirst({ where: { id, shopId } });
}

export async function updateWidget(
  admin: AdminGraphqlClient,
  shopId: string,
  id: string,
  updates: { name?: string; published?: boolean },
): Promise<Widget> {
  const current = await prisma.widget.findFirstOrThrow({ where: { id, shopId } });

  // For the floating video, sibling-unpublish + this widget's own update run
  // in one transaction so two overlapping publishes can't both land live.
  const widget = await prisma.$transaction(async (tx) => {
    if (updates.published === true && !current.published && isSingleLiveKind(current.type)) {
      await tx.widget.updateMany({
        where: {
          shopId: current.shopId,
          type: current.type,
          published: true,
          id: { not: id },
        },
        data: { published: false },
      });
    }
    return tx.widget.update({ where: { id }, data: updates });
  });
  // Single sync after all DB writes, it re-derives from the DB, so the
  // sibling unpublishes above don't need their own sync calls.
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
  return widget;
}

export async function updateWidgetTargetRule(
  admin: AdminGraphqlClient,
  shopId: string,
  id: string,
  targetRule: WidgetConfig["targetRule"],
): Promise<Widget> {
  const existing = await prisma.widget.findFirstOrThrow({ where: { id, shopId } });
  const existingConfig = existing.config as unknown as WidgetConfig;
  const mergedConfig: WidgetConfig = { ...existingConfig, targetRule };

  const widget = await prisma.widget.update({
    where: { id },
    data: { config: mergedConfig as unknown as Prisma.InputJsonValue },
  });
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
  return widget;
}

export async function updateWidgetDeviceVisibility(
  admin: AdminGraphqlClient,
  shopId: string,
  id: string,
  deviceVisibility: WidgetConfig["deviceVisibility"],
): Promise<Widget> {
  const existing = await prisma.widget.findFirstOrThrow({ where: { id, shopId } });
  const existingConfig = existing.config as unknown as WidgetConfig;
  const mergedConfig: WidgetConfig = { ...existingConfig, deviceVisibility };

  const widget = await prisma.widget.update({
    where: { id },
    data: { config: mergedConfig as unknown as Prisma.InputJsonValue },
  });
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
  return widget;
}

export async function updateWidgetPageTypes(
  admin: AdminGraphqlClient,
  shopId: string,
  id: string,
  pageTypes: string[],
): Promise<Widget> {
  const existing = await prisma.widget.findFirstOrThrow({ where: { id, shopId } });
  const existingConfig = existing.config as unknown as WidgetConfig;
  const mergedConfig: WidgetConfig = { ...existingConfig, pageTypes };

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
  style: WidgetStyleConfig;
  deviceVisibility: WidgetConfig["deviceVisibility"];
  pageTypes: string[];
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
  ADD_TO_CART_VIDEO: {
    metafieldKey: "add_to_cart_video_widget",
    featuredReelMetafieldKey: "add_to_cart_video_featured_reel",
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
// WIDGET_KIND_SYNC_CONFIG (GRID) are a no-op, no theme implementation
// reads a metafield for them yet, so writing one would just be dead data.
//
// The value is always DERIVED from the DB (the shop's one published widget
// of this kind, if any) rather than from whichever widget was just written
//, syncing "the widget that was just touched" would let an edit to an
// unrelated draft widget of the same kind clobber the live widget's state
// (this exact bug was fixed for PRODUCT_PAGE_REELS in the previous plan;
// every kind added here is subject to the same risk).
//
// `force` writes the metafield even when the shop has no widgets of this
// kind at all, needed by `deleteWidget`, which may have just removed the
// last one and still has to clear what it wrote.
export async function syncShopWidgetState(
  admin: AdminGraphqlClient,
  shopId: string,
  kind: WidgetKind,
  options: { force?: boolean } = {},
): Promise<void> {
  const syncConfig = WIDGET_KIND_SYNC_CONFIG[kind];
  if (!syncConfig) return;

  // Blocks with no widget picked show the kind's most recently saved live
  // widget (several can be live now that blocks pick their own).
  const live = await prisma.widget.findFirst({
    where: { shopId, type: kind, published: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!live && !options.force) {
    const everOfKind = await prisma.widget.count({ where: { shopId, type: kind } });
    if (everOfKind === 0) return;
  }

  const liveConfig = live ? (live.config as unknown as WidgetConfig) : null;
  const value: WidgetMetafieldValue = liveConfig
    ? {
        published: true,
        targetRule: liveConfig.targetRule,
        style: liveConfig.style ?? {},
        deviceVisibility: liveConfig.deviceVisibility ?? "all",
        pageTypes: liveConfig.pageTypes ?? [],
      }
    : {
        published: false,
        targetRule: { type: "all_products" },
        style: {},
        deviceVisibility: "all",
        pageTypes: [],
      };

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

  // No featured reel (none picked, or the live widget changed): remove the
  // old reference, or the storefront keeps playing the previous video,
  // possibly one that has since been deleted.
  if (syncConfig.featuredReelMetafieldKey && !liveConfig?.featuredReelId) {
    const deleteResponse = await admin.graphql(
      `#graphql
      mutation ClearFeaturedReel($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      { variables: { metafields: [{ ownerId: shopGid, namespace: "$app", key: syncConfig.featuredReelMetafieldKey }] } },
    );
    const deleteJson = await deleteResponse.json();
    assertNoGraphqlErrors(deleteJson);
    throwOnUserErrors(deleteJson.data?.metafieldsDelete?.userErrors ?? []);
  }

  if (syncConfig.featuredReelMetafieldKey && liveConfig?.featuredReelId) {
    metafields.push({
      ownerId: shopGid,
      namespace: "$app",
      key: syncConfig.featuredReelMetafieldKey,
      type: "metaobject_reference",
      value: liveConfig.featuredReelId,
    });
  }

  if (syncConfig.reelListMetafieldKey) {
    metafields.push({
      ownerId: shopGid,
      namespace: "$app",
      key: syncConfig.reelListMetafieldKey,
      type: "list.metaobject_reference",
      value: JSON.stringify(liveConfig?.reelIds ?? []),
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

  await syncWidgetEntries(admin, shopId, kind);
}

/* --------------------------------------------- per-widget entries */

// Each block-based widget is mirrored into its own app metaobject entry
// (types in shopify.app.toml, one per kind), so the theme block's "Widget"
// setting, a metaobject picker, lists the merchant's widgets of that kind
// by name and the block renders the one picked. Handles are derived from
// the widget id, so upserts need no stored metaobject id.
export const widgetEntryType = (kind: WidgetKind) => {
  const key = WIDGET_KIND_SYNC_CONFIG[kind]?.metafieldKey;
  return key && !isSingleLiveKind(kind) ? `$app:${key}` : null;
};
export const widgetEntryHandle = (widgetId: string) => `widget-${widgetId}`.toLowerCase();

function metafieldValueFor(widget: Widget): WidgetMetafieldValue {
  const config = widget.config as unknown as WidgetConfig;
  return {
    published: widget.published,
    targetRule: config.targetRule,
    style: config.style ?? {},
    deviceVisibility: config.deviceVisibility ?? "all",
    pageTypes: config.pageTypes ?? [],
  };
}

async function upsertWidgetEntry(admin: AdminGraphqlClient, widget: Widget): Promise<void> {
  const type = widgetEntryType(widget.type as WidgetKind);
  if (!type) return;
  const config = widget.config as unknown as WidgetConfig;
  const syncConfig = WIDGET_KIND_SYNC_CONFIG[widget.type as WidgetKind]!;
  const fields: { key: string; value: string }[] = [
    { key: "name", value: widget.name },
    { key: "config", value: JSON.stringify(metafieldValueFor(widget)) },
  ];
  if (syncConfig.reelListMetafieldKey) fields.push({ key: "reels", value: JSON.stringify(config.reelIds ?? []) });
  if (syncConfig.featuredReelMetafieldKey) fields.push({ key: "featured_reel", value: config.featuredReelId ?? "" });

  const response = await admin.graphql(
    `#graphql
    mutation UpsertWidgetEntry($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }`,
    { variables: { handle: { type, handle: widgetEntryHandle(widget.id) }, metaobject: { fields } } },
  );
  const json = await response.json();
  assertNoGraphqlErrors(json);
  throwOnUserErrors(json.data?.metaobjectUpsert?.userErrors ?? []);
}

// Refreshes every widget entry of one kind from the DB. Failures are logged,
// not thrown: blocks with no widget picked keep working off the shop-level
// metafield, so a save must not fail just because an entry couldn't be
// written (e.g. before the app version defining the types is released).
export async function syncWidgetEntries(admin: AdminGraphqlClient, shopId: string, kind: WidgetKind): Promise<void> {
  if (!widgetEntryType(kind)) return;
  const widgets = await prisma.widget.findMany({ where: { shopId, type: kind } });
  for (const widget of widgets) {
    try {
      await upsertWidgetEntry(admin, widget);
    } catch (error) {
      log.warn("widget.entry_sync_failed", { widgetId: widget.id, kind }, error);
    }
  }
}

// Widgets saved before entries existed get one the first time the shop's
// Widgets page loads in this server process, so the theme editor's picker
// lists them without the merchant re-saving each one. Best effort and
// once per shop per process: a later save re-syncs anyway.
const entriesBackfilled = new Set<string>();
export async function backfillWidgetEntries(admin: AdminGraphqlClient, shopId: string, widgets: Widget[]): Promise<void> {
  if (entriesBackfilled.has(shopId)) return;
  entriesBackfilled.add(shopId);
  for (const kind of new Set(widgets.map((w) => w.type as WidgetKind))) {
    await syncWidgetEntries(admin, shopId, kind);
  }
}

async function deleteWidgetEntry(admin: AdminGraphqlClient, widget: Widget): Promise<void> {
  const type = widgetEntryType(widget.type as WidgetKind);
  if (!type) return;
  try {
    const found = await admin.graphql(
      `#graphql
      query WidgetEntry($handle: MetaobjectHandleInput!) {
        metaobjectByHandle(handle: $handle) { id }
      }`,
      { variables: { handle: { type, handle: widgetEntryHandle(widget.id) } } },
    );
    const foundJson = await found.json();
    assertNoGraphqlErrors(foundJson);
    const entryId = foundJson.data?.metaobjectByHandle?.id;
    if (!entryId) return;
    const removed = await admin.graphql(
      `#graphql
      mutation DeleteWidgetEntry($id: ID!) {
        metaobjectDelete(id: $id) {
          userErrors { field message }
        }
      }`,
      { variables: { id: entryId } },
    );
    const removedJson = await removed.json();
    assertNoGraphqlErrors(removedJson);
    throwOnUserErrors(removedJson.data?.metaobjectDelete?.userErrors ?? []);
  } catch (error) {
    log.warn("widget.entry_delete_failed", { widgetId: widget.id }, error);
  }
}

export async function updateWidgetFeaturedReel(
  admin: AdminGraphqlClient,
  shopId: string,
  id: string,
  featuredReelId: string,
): Promise<Widget> {
  const existing = await prisma.widget.findFirstOrThrow({ where: { id, shopId } });
  const existingConfig = existing.config as unknown as WidgetConfig;
  const mergedConfig: WidgetConfig = { ...existingConfig, featuredReelId };

  const widget = await prisma.widget.update({
    where: { id },
    data: { config: mergedConfig as unknown as Prisma.InputJsonValue },
  });
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
  return widget;
}

export async function updateWidgetStyle(
  admin: AdminGraphqlClient,
  shopId: string,
  id: string,
  style: WidgetStyleConfig,
): Promise<Widget> {
  const existing = await prisma.widget.findFirstOrThrow({ where: { id, shopId } });
  const existingConfig = existing.config as unknown as WidgetConfig;
  const mergedConfig: WidgetConfig = { ...existingConfig, style };

  const widget = await prisma.widget.update({
    where: { id },
    data: { config: mergedConfig as unknown as Prisma.InputJsonValue },
  });
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
  return widget;
}

export interface WidgetSettingsUpdate {
  name: string;
  published: boolean;
  targetRule: WidgetConfig["targetRule"];
  deviceVisibility: NonNullable<WidgetConfig["deviceVisibility"]>;
  pageTypes: string[];
  featuredReelId?: string;
  reelIds?: string[];
  style: WidgetStyleConfig;
}

// The editor's single Save: name, publish state and every config field land
// in one transaction followed by one metafield sync, instead of the old
// one-fetcher-per-section saves that each round-tripped to Shopify. Same
// sibling-unpublish invariant as updateWidget.
export async function saveWidgetSettings(
  admin: AdminGraphqlClient,
  shopId: string,
  id: string,
  update: WidgetSettingsUpdate,
): Promise<Widget> {
  const current = await prisma.widget.findFirstOrThrow({ where: { id, shopId } });
  const currentConfig = current.config as unknown as WidgetConfig;
  const config: WidgetConfig = {
    ...currentConfig,
    targetRule: update.targetRule,
    deviceVisibility: update.deviceVisibility,
    pageTypes: update.pageTypes,
    style: update.style,
  };
  if (update.featuredReelId !== undefined) config.featuredReelId = update.featuredReelId || undefined;
  if (update.reelIds !== undefined) config.reelIds = update.reelIds;

  const widget = await prisma.$transaction(async (tx) => {
    if (update.published && !current.published && isSingleLiveKind(current.type)) {
      await tx.widget.updateMany({
        where: { shopId: current.shopId, type: current.type, published: true, id: { not: id } },
        data: { published: false },
      });
    }
    return tx.widget.update({
      where: { id },
      data: {
        name: update.name,
        published: update.published,
        config: config as unknown as Prisma.InputJsonValue,
      },
    });
  });
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
  return widget;
}

export async function updateWidgetReels(
  admin: AdminGraphqlClient,
  shopId: string,
  id: string,
  reelIds: string[],
): Promise<Widget> {
  const existing = await prisma.widget.findFirstOrThrow({ where: { id, shopId } });
  const existingConfig = existing.config as unknown as WidgetConfig;
  const mergedConfig: WidgetConfig = { ...existingConfig, reelIds };

  const widget = await prisma.widget.update({
    where: { id },
    data: { config: mergedConfig as unknown as Prisma.InputJsonValue },
  });
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
  return widget;
}

// Drops a deleted reel from every widget that referenced it (curated list
// or featured slot) and re-syncs those kinds. Without this, the next
// metafield sync for that kind writes a reference to a metaobject that no
// longer exists and Shopify rejects the whole metafieldsSet call.
export async function removeReelFromWidgets(
  admin: AdminGraphqlClient,
  shopId: string,
  reelId: string,
): Promise<void> {
  const widgets = await prisma.widget.findMany({ where: { shopId } });
  const touchedKinds = new Set<WidgetKind>();

  for (const widget of widgets) {
    const config = widget.config as unknown as WidgetConfig;
    const inList = config.reelIds?.includes(reelId) ?? false;
    const isFeatured = config.featuredReelId === reelId;
    if (!inList && !isFeatured) continue;

    const next: WidgetConfig = {
      ...config,
      reelIds: inList ? config.reelIds!.filter((id) => id !== reelId) : config.reelIds,
      featuredReelId: isFeatured ? undefined : config.featuredReelId,
    };
    await prisma.widget.update({
      where: { id: widget.id },
      data: { config: next as unknown as Prisma.InputJsonValue },
    });
    touchedKinds.add(widget.type as WidgetKind);
  }

  for (const kind of touchedKinds) {
    await syncShopWidgetState(admin, shopId, kind);
  }
}
