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
import type { AdminGraphqlClient, ReelConfig } from "../models/reel.server";
import { getOrCreateShop } from "../models/shop.server";
import { discardStreamAsset, recordStreamAsset, releaseStreamAssets } from "../models/stream-assets.server";
import { log } from "../lib/logger.server";
import {
  copyVideoFromUrl,
  createDirectUploadUrl,
  getCloudflareConfig,
  uploadBufferToDirectUploadUrl,
} from "../models/cloudflare-stream.server";
import { classifyImportLink } from "../models/video-link";
import { downloadSocialVideo, resolveSocialVideo, SocialImportError } from "../models/social-import.server";

// JSON API behind the reels library's upload queue and the editor's
// "Replace video". Browsers upload the file straight to Cloudflare with the
// one-time URL returned here (so large files never pass through this
// server); App Bridge's fetch adds the session token to these requests.
//
//   { intent: "create",  title, published, productIds } -> { reelId, uploadURL }
//   { intent: "import",  title, published, productIds, sourceUrl } -> { reelId }
//       sourceUrl: a public Instagram/TikTok post, or a link to a video
//       file (incl. Dropbox share links) that Cloudflare downloads itself.
//   { intent: "replace", reelId } -> { uploadURL }
//   { intent: "failed",  reelId } -> {}

type Body = {
  intent?: string;
  title?: string;
  published?: boolean;
  productIds?: unknown;
  sourceUrl?: string;
  reelId?: string;
  rightsConfirmed?: boolean;
};

// Shoppable videos are short; capping length bounds storage cost per upload.
const MAX_VIDEO_SECONDS = 600;
const GID = /^gid:\/\/shopify\/Metaobject\/\d+$/;

const json = (data: Record<string, unknown>, status = 200) => Response.json(data, { status });

function cleanProductIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter((id) => /^gid:\/\/shopify\/Product\/\d+$/.test(id)))].slice(0, 50);
}

async function createReel(admin: AdminGraphqlClient, body: Body, source: ReelConfig["source"]) {
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
        return json({ error: "Uploads are temporarily unavailable. Try again in a few minutes." }, 502);
      }
    }

    if (body.intent === "import") {
      if (body.rightsConfirmed !== true) {
        return json({ error: "Confirm you own this video or have permission to use it." }, 400);
      }
      const sourceUrl = String(body.sourceUrl ?? "").trim().slice(0, 2048);
      const link = classifyImportLink(sourceUrl);
      if (link.kind === "empty") return json({ error: "Paste a link to the video." }, 400);
      if (link.kind === "invalid") return json({ error: link.error }, 400);

      // A video file (or Dropbox) link: Cloudflare fetches it directly.
      if (link.kind === "file") {
        const { reel, productIds } = await createReel(admin, body, { type: "link", originalUrl: sourceUrl });
        try {
          const { uid } = await copyVideoFromUrl(getCloudflareConfig(), link.url, {
            reelId: reel.id,
            shop: session.shop,
            name: reel.title,
          });
          await recordStreamAsset(shop.id, uid);
          await updateReelConfig(admin, reel.id, { cloudflareStreamUid: uid });
          return json({ reelId: reel.id });
        } catch (e) {
          log.warn("upload.link_import_failed", { shop: session.shop, reelId: reel.id, source: link.source }, e);
          await discardReel(admin, reel.id, productIds);
          return json(
            { error: "Cloudflare couldn't accept that link. Check it opens or downloads the video file, then try again." },
            502,
          );
        }
      }

      // An Instagram or TikTok post. Look the video up before creating
      // anything, so a private or photo-only post leaves no trace.
      const platformName = link.platform === "instagram" ? "Instagram" : "TikTok";
      let resolved;
      try {
        resolved = await resolveSocialVideo(link.platform, sourceUrl);
      } catch (e) {
        log.warn("upload.social_resolve_failed", { shop: session.shop, platform: link.platform }, e);
        const message =
          e instanceof SocialImportError ? e.message : `Couldn't read that ${platformName} post. Try again in a minute.`;
        return json({ error: message }, 502);
      }

      const title = String(body.title ?? "").trim() || resolved.title || `${platformName} video`;
      const { reel, productIds } = await createReel(
        admin,
        { ...body, title },
        { type: link.platform, originalUrl: sourceUrl },
      );
      let createdUid: string | null = null;
      try {
        const meta = { reelId: reel.id, shop: session.shop, name: reel.title };
        if (!resolved.downloadHeaders) {
          // Publicly fetchable (Instagram's signed CDN link): Cloudflare
          // downloads it, nothing passes through this server.
          createdUid = (await copyVideoFromUrl(getCloudflareConfig(), resolved.videoUrl, meta)).uid;
          await recordStreamAsset(shop.id, createdUid);
        } else {
          // Needs the page's cookies (TikTok): fetch it here, hand it on.
          const video = await downloadSocialVideo(resolved);
          const { uid, uploadURL } = await createDirectUploadUrl(getCloudflareConfig(), MAX_VIDEO_SECONDS, meta);
          createdUid = uid;
          await recordStreamAsset(shop.id, uid);
          await uploadBufferToDirectUploadUrl(uploadURL, video, `${reel.handle}.mp4`);
        }
        await updateReelConfig(admin, reel.id, { cloudflareStreamUid: createdUid });
        return json({ reelId: reel.id });
      } catch (e) {
        log.warn("upload.import_failed", { shop: session.shop, reelId: reel.id, platform: link.platform }, e);
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

    if (body.intent === "discard") {
      const reelId = String(body.reelId ?? "");
      if (!GID.test(reelId)) return json({ error: "Video not found." }, 404);
      const reel = await getReel(admin, reelId);
      if (!reel) return json({});
      // Only ever for a reel whose first upload never arrived.
      if (reel.config.hlsManifestUrl) return json({ error: "This video already has footage." }, 409);
      await discardReel(admin, reel.id, reel.config.productIds);
      if (reel.config.cloudflareStreamUid) await discardStreamAsset(shop.id, reel.config.cloudflareStreamUid);
      return json({});
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
