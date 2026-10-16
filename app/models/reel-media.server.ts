import type { AdminGraphqlClient, Reel } from "./reel.server";
import { updateReelConfig } from "./reel.server";
import { getCloudflareConfig, getVideoDetails } from "./cloudflare-stream.server";
import type { VideoDetails } from "./cloudflare-stream.server";
import { posterAt } from "./reel-media";
import { log } from "../lib/logger.server";

// Writes a finished Cloudflare Stream video onto its reel: playback URLs,
// duration, and a poster at the merchant's chosen cover frame. Shared by
// the Stream webhook and the loaders' self-heal below, so both produce the
// same result.
// Returns the updated reel plus the Stream uid it replaced (if any), which
// the caller should release so the old video stops costing storage.
export async function applyReadyVideo(
  admin: AdminGraphqlClient,
  reel: Reel,
  details: VideoDetails,
): Promise<{ reel: Reel; replacedUid: string | null }> {
  const previous = reel.config.cloudflareStreamUid;
  const updated = await updateReelConfig(admin, reel.id, {
    cloudflareStreamUid: details.uid,
    posterUrl: details.thumbnail ? posterAt(details.thumbnail, reel.config.coverTimeSeconds) : undefined,
    durationSeconds: details.duration ?? undefined,
    hlsManifestUrl: details.playback.hls ?? undefined,
    dashManifestUrl: details.playback.dash ?? undefined,
    uploadedAt:
      previous === details.uid && reel.config.uploadedAt ? reel.config.uploadedAt : new Date().toISOString(),
    // A replacement finished: it's now the live video.
    replacingStreamUid: "",
    uploadFailedAt: "",
  });
  return { reel: updated, replacedUid: previous && previous !== details.uid ? previous : null };
}

// Cloudflare's "ready" webhook can be missed (it needs the app's public URL
// registered, and deliveries can fail). Rather than leave a reel stuck on
// "Processing" forever, ask Stream directly for reels that are still waiting
// and apply any that have finished. Errors are swallowed per reel: this is
// a best-effort catch-up, never a reason to fail the page.
export async function healProcessingReels(
  admin: AdminGraphqlClient,
  reels: Reel[],
  maxChecks = 6,
  onReleased?: (uids: string[]) => Promise<void>,
): Promise<Reel[]> {
  const waiting = reels
    .filter((r) => {
      const pending = r.config.replacingStreamUid || (!r.config.hlsManifestUrl && r.config.cloudflareStreamUid);
      return Boolean(pending) && !r.config.uploadFailedAt;
    })
    .slice(0, maxChecks);
  if (waiting.length === 0) return reels;

  let config;
  try {
    config = getCloudflareConfig();
  } catch {
    return reels;
  }

  const updated = new Map<string, Reel>();
  const released: string[] = [];
  await Promise.all(
    waiting.map(async (reel) => {
      const uid = reel.config.replacingStreamUid || reel.config.cloudflareStreamUid!;
      try {
        const details = await getVideoDetails(config, uid);
        if (details.state === "ready" && details.playback.hls) {
          const result = await applyReadyVideo(admin, reel, details);
          updated.set(reel.id, result.reel);
          if (result.replacedUid) released.push(result.replacedUid);
        } else if (details.state === "error") {
          released.push(uid);
          const isFirstUpload = !reel.config.replacingStreamUid;
          updated.set(
            reel.id,
            await updateReelConfig(admin, reel.id, {
              uploadFailedAt: new Date().toISOString(),
              replacingStreamUid: "",
              // Unhook a first upload that never played so it can be deleted.
              ...(isFirstUpload ? { cloudflareStreamUid: "" } : {}),
            }),
          );
        }
      } catch (error) {
        // Leave it for the next page load or the webhook.
        log.warn("stream.heal_check_failed", { reelId: reel.id, uid }, error);
      }
    }),
  );
  if (released.length && onReleased) await onReleased(released);
  return reels.map((r) => updated.get(r.id) ?? r);
}
