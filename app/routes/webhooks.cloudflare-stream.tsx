/**
 * Receives Cloudflare Stream's webhook when a video's transcoding status changes.
 *
 * This URL must be registered with Cloudflare before it will ever be called:
 *   PUT https://api.cloudflare.com/client/v4/accounts/{account_id}/stream/webhook
 *   Authorization: Bearer <CLOUDFLARE_API_TOKEN>
 *   Body: { "notificationUrl": "<SHOPIFY_APP_URL>/webhooks/cloudflare-stream" }
 *
 * The response's result.secret is the value that goes into
 * CLOUDFLARE_STREAM_WEBHOOK_SECRET — Cloudflare generates it, you don't choose it.
 * This is a one-time account-level setup step, not something this app does at runtime.
 */
import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import {
  getCloudflareConfig,
  getVideoDetails,
  verifyWebhookSignature,
  type VideoDetails,
} from "../models/cloudflare-stream.server";
import { getReel, updateReelConfig } from "../models/reel.server";
import { applyReadyVideo } from "../models/reel-media.server";

interface CloudflareWebhookPayload {
  uid: string;
  status?: { state: VideoDetails["state"] };
  meta?: Record<string, string>;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("Webhook-Signature");
  const secret = process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;

  if (
    !secret ||
    !signatureHeader ||
    !verifyWebhookSignature(rawBody, signatureHeader, secret)
  ) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: CloudflareWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as CloudflareWebhookPayload;
  } catch {
    return new Response("Malformed payload", { status: 400 });
  }

  const shop = payload.meta?.shop;
  const reelId = payload.meta?.reelId;

  if (!shop || !reelId) {
    return new Response("Missing shop/reelId metadata", { status: 400 });
  }

  if (payload.status?.state === "error") {
    console.error(
      `Cloudflare Stream transcode failed for uid=${payload.uid}, reelId=${reelId}, shop=${shop}`,
    );
    try {
      const { admin } = await unauthenticated.admin(shop);
      await updateReelConfig(admin, reelId, { uploadFailedAt: new Date().toISOString(), replacingStreamUid: "" });
    } catch (error) {
      console.error("Could not mark reel as failed:", error);
    }
    return new Response("OK", { status: 200 });
  }

  if (payload.status?.state !== "ready") {
    return new Response("OK", { status: 200 });
  }

  try {
    const { admin } = await unauthenticated.admin(shop);

    const [details, reel] = await Promise.all([
      getVideoDetails(getCloudflareConfig(), payload.uid),
      getReel(admin, reelId),
    ]);
    if (!reel) return new Response("OK", { status: 200 });
    // A late webhook for a video that's since been replaced again: ignore.
    const expected = reel.config.replacingStreamUid || reel.config.cloudflareStreamUid;
    if (expected && expected !== payload.uid) return new Response("OK", { status: 200 });

    await applyReadyVideo(admin, reel, details);

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Cloudflare Stream webhook processing failed:", error);
    return new Response("Processing failed", { status: 500 });
  }
};
