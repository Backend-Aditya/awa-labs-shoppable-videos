import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Events this endpoint will record. Anything else is rejected outright —
// without a whitelist, a client could write arbitrary eventType strings into
// ReelEvent, corrupting the groupBy aggregates the admin analytics views rely on.
const ALLOWED_EVENT_TYPES = new Set(["view", "click_product"]);

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // This route is only ever reached via Shopify's app proxy (/apps/reels/analytics),
  // which signs the request and injects a verified `shop` query param. Previously
  // this handler trusted a client-supplied `shopDomain` field in the POST body
  // instead — anyone could POST directly to this URL (no signature required) with
  // any shop's domain and flood its analytics, or any reelId, with fabricated
  // view/click events. authenticate.public.appProxy throws on a missing/invalid
  // signature, so a direct unsigned request never reaches the code below.
  await authenticate.public.appProxy(request);
  const shopDomain = new URL(request.url).searchParams.get("shop");

  try {
    const payload = await request.json();
    const { reelId, eventType } = payload;

    if (!shopDomain || !reelId || !eventType) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      return Response.json({ error: "Invalid eventType" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
    });

    if (!shop) {
      return Response.json({ error: "Shop not found" }, { status: 404 });
    }

    await prisma.reelEvent.create({
      data: {
        shopId: shop.id,
        reelId,
        eventType,
      },
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to track analytics", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
};
