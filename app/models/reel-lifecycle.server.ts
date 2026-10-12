import type { AdminGraphqlClient, Reel } from "./reel.server";
import { deleteReel, syncProductReelMetafields } from "./reel.server";
import { removeReelFromWidgets } from "./widget.server";

// Deletes a reel and every reference to it: tagged products' `reels`
// metafields first (so no product points at a missing metaobject), then the
// reel, then any widget that showed it.
export async function deleteReelEverywhere(
  admin: AdminGraphqlClient,
  shopId: string,
  reel: Reel,
): Promise<void> {
  if (reel.config.productIds.length > 0) {
    await syncProductReelMetafields(admin, reel.id, reel.config.productIds, []);
  }
  await deleteReel(admin, reel.id);
  await removeReelFromWidgets(admin, shopId, reel.id);
}
