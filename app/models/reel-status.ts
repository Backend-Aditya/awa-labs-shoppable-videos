import type { ReelConfig } from "./reel.server";

export type ReelStatus = "draft" | "processing" | "failed" | "ready";

// A replacement upload in progress doesn't change the status: the existing
// video is still live. Callers that care check config.replacingStreamUid.
export function deriveReelStatus(config: ReelConfig): ReelStatus {
  if (config.hlsManifestUrl) return "ready";
  // Checked before the uid: a failed upload usually already has one.
  if (config.uploadFailedAt) return "failed";
  if (config.cloudflareStreamUid) return "processing";
  return "draft";
}
