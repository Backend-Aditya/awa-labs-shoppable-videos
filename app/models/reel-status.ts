import type { ReelConfig } from "./reel.server";

export type ReelStatus = "draft" | "processing" | "failed" | "ready";

export function deriveReelStatus(config: ReelConfig): ReelStatus {
  if (config.hlsManifestUrl) return "ready";
  if (config.cloudflareStreamUid) return "processing";
  if (config.uploadFailedAt) return "failed";
  return "draft";
}
