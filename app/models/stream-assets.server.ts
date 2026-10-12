import prisma from "../db.server";
import { log } from "../lib/logger.server";
import { deleteStreamVideo, getCloudflareConfig } from "./cloudflare-stream.server";
import type { AdminGraphqlClient } from "./reel.server";
import { listReels } from "./reel.server";

// Bookkeeping for Cloudflare Stream videos. Stream bills per stored minute,
// so a video must be deleted once nothing uses it — but duplicated reels
// share one video, so "unused" means no reel in the shop still points at it.

export async function recordStreamAsset(shopId: string, uid: string): Promise<void> {
  await prisma.streamAsset.upsert({ where: { uid }, create: { uid, shopId }, update: {} });
}

async function deleteAsset(uid: string, context: Record<string, unknown>) {
  await deleteStreamVideo(getCloudflareConfig(), uid);
  await prisma.streamAsset.deleteMany({ where: { uid } });
  log.info("stream.asset_deleted", { uid, ...context });
}

// Deletes each uid that no remaining reel references. Never throws: a
// failed delete is logged and retried by the next release or erasure.
export async function releaseStreamAssets(
  admin: AdminGraphqlClient,
  shopId: string,
  uids: (string | undefined | null)[],
): Promise<void> {
  const candidates = [...new Set(uids.filter((u): u is string => Boolean(u)))];
  if (candidates.length === 0) return;
  try {
    const inUse = new Set(
      (await listReels(admin)).flatMap((r) => [r.config.cloudflareStreamUid, r.config.replacingStreamUid]).filter(Boolean),
    );
    for (const uid of candidates) {
      if (inUse.has(uid)) continue;
      try {
        await deleteAsset(uid, { shopId });
      } catch (error) {
        log.error("stream.asset_delete_failed", { shopId, uid }, error);
      }
    }
  } catch (error) {
    log.error("stream.release_failed", { shopId, uids: candidates }, error);
  }
}

// Deletes a video the app just created but never attached to anything
// (e.g. an import that failed mid-way). No reference check needed.
export async function discardStreamAsset(shopId: string, uid: string): Promise<void> {
  try {
    await deleteAsset(uid, { shopId, reason: "discard" });
  } catch (error) {
    log.error("stream.asset_delete_failed", { shopId, uid }, error);
  }
}

// shop/redact: erase every video the shop ever uploaded. Returns how many
// couldn't be deleted (they stay recorded so a retry can finish the job).
export async function purgeShopStreamAssets(shopId: string): Promise<number> {
  const assets = await prisma.streamAsset.findMany({ where: { shopId } });
  let failed = 0;
  for (const asset of assets) {
    try {
      await deleteAsset(asset.uid, { shopId, reason: "shop_redact" });
    } catch (error) {
      failed += 1;
      log.error("stream.asset_delete_failed", { shopId, uid: asset.uid }, error);
    }
  }
  return failed;
}
