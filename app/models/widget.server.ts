import type { Prisma, Widget } from "@prisma/client";
import prisma from "../db.server";

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
  id: string,
  updates: { name?: string; published?: boolean },
): Promise<Widget> {
  return prisma.widget.update({ where: { id }, data: updates });
}

export async function updateWidgetTargetRule(
  id: string,
  targetRule: WidgetConfig["targetRule"],
): Promise<Widget> {
  const existing = await prisma.widget.findUniqueOrThrow({ where: { id } });
  const existingConfig = existing.config as unknown as WidgetConfig;
  const mergedConfig: WidgetConfig = { ...existingConfig, targetRule };

  return prisma.widget.update({
    where: { id },
    data: { config: mergedConfig as unknown as Prisma.InputJsonValue },
  });
}
