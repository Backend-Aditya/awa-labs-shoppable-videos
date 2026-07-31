import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import {
  getVideoDetails,
  verifyWebhookSignature,
} from "../models/cloudflare-stream.server";
import { updateReelConfig } from "../models/reel.server";

interface CloudflareWebhookPayload {
  uid: string;
  status?: { state: string };
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

  if (payload.status?.state !== "ready") {
    return new Response("OK", { status: 200 });
  }

  try {
    const { admin } = await unauthenticated.admin(shop);

    const details = await getVideoDetails(
      {
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
        apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
      },
      payload.uid,
    );

    await updateReelConfig(admin, reelId, {
      cloudflareStreamUid: payload.uid,
      posterUrl: details.thumbnail ?? undefined,
      durationSeconds: details.duration ?? undefined,
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Cloudflare Stream webhook processing failed:", error);
    return new Response("Processing failed", { status: 500 });
  }
};
