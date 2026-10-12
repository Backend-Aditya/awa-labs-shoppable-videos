import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  deleteReel,
  generateReelHandle,
  getReel,
  syncProductReelMetafields,
  updateReelConfig,
  upsertReel,
} from "../models/reel.server";
import type { AdminGraphqlClient } from "../models/reel.server";
import { getOrCreateShop } from "../models/shop.server";
import { discardStreamAsset, recordStreamAsset, releaseStreamAssets } from "../models/stream-assets.server";
import { log } from "../lib/logger.server";
import {
  createDirectUploadUrl,
  getCloudflareConfig,
  uploadBufferToDirectUploadUrl,
} from "../models/cloudflare-stream.server";
import {
  fetchSocialVideo,
  parseSocialVideoUrl,
  resolveVideoSourceUrl,
  SocialImportError,
} from "../models/social-import.server";

// JSON API behind the reels library's upload queue and the editor's
// "Replace video". Browsers upload the file straight to Cloudflare with the
// one-time URL returned here (so large files never pass through this
// server); App Bridge's fetch adds the session token to these requests.
//
//   { intent: "create",  title, published, productIds } -> { reelId, uploadURL }
//   { intent: "import",  title, published, productIds, sourceUrl } -> { reelId }
//   { intent: "replace", reelId } -> { uploadURL }
//   { intent: "failed",  reelId } -> {}

type Body = {
  intent?: string;
  title?: string;
  published?: boolean;
  productIds?: unknown;
  sourceUrl?: string;
  reelId?: string;
};

// Shoppable videos are short; capping length bounds storage cost per upload.
const MAX_VIDEO_SECONDS = 600;
const GID = /^gid:\/\/shopify\/Metaobject\/\d+$/;

const json = (data: Record<string, unknown>, status = 200) => Response.json(data, { status });

function cleanProductIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter((id) => /^gid:\/\/shopify\/Product\/\d+$/.test(id)))].slice(0, 50);
}

async function createReel(admin: AdminGraphqlClient, body: Body, source: { type: "upload" | "instagram" | "tiktok"; originalUrl?: string }) {
  const title = String(body.title ?? "").trim().slice(0, 120);
  const productIds = cleanProductIds(body.productIds);
  const reel = await upsertReel(admin, generateReelHandle(title || "reel"), title || "Untitled video", body.published !== false, {
    productIds,
    interactions: {},
    source,
  });
  if (productIds.length > 0) {
    await syncProductReelMetafields(admin, reel.id, [], productIds);
  }
  return { reel, productIds };
}

async function discardReel(admin: AdminGraphqlClient, reelId: string, productIds: string[]) {
  try {
    // Clear product references first so no product points at a deleted reel.
    if (productIds.length > 0) await syncProductReelMetafields(admin, reelId, productIds, []);
    await deleteReel(admin, reelId);
  } catch {
    // Best effort; the caller reports the original failure.
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  try {
    if (body.intent === "create") {
      const { reel, productIds } = await createReel(admin, body, { type: "upload" });
      try {
        const { uid, uploadURL } = await createDirectUploadUrl(getCloudflareConfig(), MAX_VIDEO_SECONDS, {
          reelId: reel.id,
          shop: session.shop,
        });
        // Record the uid now, not only when the "ready" webhook arrives, so
        // the reel can self-heal from Stream if that webhook is missed.
        await recordStreamAsset(shop.id, uid);
        await updateReelConfig(admin, reel.id, { cloudflareStreamUid: uid });
        return json({ reelId: reel.id, uploadURL });
      } catch (error) {
        log.error("upload.create_failed", { shop: session.shop, reelId: reel.id }, error);
        await discardReel(admin, reel.id, productIds);
        return json({ error: "Video uploads aren't available right now. Check the Cloudflare Stream settings." }, 502);
      }
    }

    if (body.intent === "import") {
      const sourceUrl = String(body.sourceUrl ?? "").trim();
      const parsed = parseSocialVideoUrl(sourceUrl);
      if (!parsed) return json({ error: "Paste a link to a public Instagram or TikTok video." }, 400);

      const { reel, productIds } = await createReel(admin, body, { type: parsed.platform, originalUrl: sourceUrl });
      let createdUid: string | null = null;
      try {
        const resolved = await resolveVideoSourceUrl(parsed.platform, sourceUrl);
        const video = await fetchSocialVideo(resolved.videoUrl, sourceUrl);
        const { uid, uploadURL } = await createDirectUploadUrl(getCloudflareConfig(), MAX_VIDEO_SECONDS, {
          reelId: reel.id,
          shop: session.shop,
        });
        createdUid = uid;
        await recordStreamAsset(shop.id, uid);
        await uploadBufferToDirectUploadUrl(uploadURL, video, `${reel.handle}.mp4`);
        await updateReelConfig(admin, reel.id, { cloudflareStreamUid: uid });
        return json({ reelId: reel.id });
      } catch (e) {
        log.warn("upload.import_failed", { shop: session.shop, reelId: reel.id }, e);
        await discardReel(admin, reel.id, productIds);
        if (createdUid) await discardStreamAsset(shop.id, createdUid);
        const message =
          e instanceof SocialImportError ? e.message : "Couldn't import that video. Try again or upload the file instead.";
        return json({ error: message }, 502);
      }
    }

    if (body.intent === "replace") {
      const reelId = String(body.reelId ?? "");
      if (!GID.test(reelId) || !(await getReel(admin, reelId))) return json({ error: "Video not found." }, 404);
      const { uid, uploadURL } = await createDirectUploadUrl(getCloudflareConfig(), MAX_VIDEO_SECONDS, {
        reelId,
        shop: session.shop,
      });
      await recordStreamAsset(shop.id, uid);
      await updateReelConfig(admin, reelId, { replacingStreamUid: uid, uploadFailedAt: "" });
      return json({ uploadURL });
    }

    if (body.intent === "failed") {
      const reelId = String(body.reelId ?? "");
      if (!GID.test(reelId)) return json({ error: "Video not found." }, 404);
      const reel = await getReel(admin, reelId);
      if (!reel) return json({ error: "Video not found." }, 404);
      // The video that failed: a pending replacement, or a first upload that
      // never became playable.
      const failedUid = reel.config.replacingStreamUid || (!reel.config.hlsManifestUrl ? reel.config.cloudflareStreamUid : "");
      await updateReelConfig(admin, reelId, {
        uploadFailedAt: new Date().toISOString(),
        replacingStreamUid: "",
        // Unhook a first upload that never played so it can be deleted.
        ...(failedUid && failedUid === reel.config.cloudflareStreamUid ? { cloudflareStreamUid: "" } : {}),
      });
      if (failedUid) await releaseStreamAssets(admin, shop.id, [failedUid]);
      return json({});
    }

    return json({ error: "Unknown request." }, 400);
  } catch (e) {
    if (e instanceof Response) throw e;
    log.error("upload.unexpected_error", { shop: session.shop, intent: body.intent }, e);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
};
