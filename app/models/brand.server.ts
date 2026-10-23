import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import type { AdminGraphqlClient } from "./reel.server";
import { setShopAppMetafield } from "./shop-metafield.server";
import { resolveBrand } from "./brand";
import type { BrandConfig } from "./brand";

export async function getBrand(shopId: string): Promise<BrandConfig> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { brand: true } });
  return resolveBrand(shop?.brand);
}

// Saves the brand kit and mirrors it to the shop-level `$app.brand`
// metafield, which the app embed turns into CSS variables on every page.
export async function saveBrand(
  admin: AdminGraphqlClient,
  shopId: string,
  input: unknown,
): Promise<BrandConfig> {
  const brand = resolveBrand(input);
  await prisma.shop.update({
    where: { id: shopId },
    data: { brand: brand as unknown as Prisma.InputJsonValue },
  });
  await setShopAppMetafield(admin, "brand", brand);
  return brand;
}
