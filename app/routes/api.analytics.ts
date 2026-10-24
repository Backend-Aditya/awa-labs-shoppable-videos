import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { log } from "../lib/logger.server";
import { recordEvent } from "../models/analytics.server";
import type { TrackedEvent } from "../models/analytics.server";

// Storefront shopper events, reached only through Shopify's app proxy
// (/apps/reels/analytics), which signs each request and supplies the shop.
// The signature proves the shop, not the visitor, so this endpoint also:
// - accepts only known event types and reel-id shapes, and watch time
//   only as a whole number of seconds within one long session's worth,
// - counts into per-day rollups keyed by the canonical numeric reel id,
// - caps events per shop per minute in this process (best effort, a
//   single Fly machine today; move to a shared store if scaled out),
// - caches the shop lookup instead of hitting the DB on every event.

const ALLOWED_EVENT_TYPES = new Set<TrackedEvent>(["view", "click_product", "add_to_cart", "complete", "watch"]);
const REEL_ID = /^(?:gid:\/\/shopify\/Metaobject\/)?(\d{1,20})$/;
const MAX_WATCH_SECONDS = 900;
const SHOP_CACHE_TTL_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
// A viewing session sends up to three events (view, completion, watch time)
// plus its taps, so this is ~400 sessions a minute per shop.
const RATE_LIMIT_PER_SHOP = 1200;

const shopCache = new Map<string, { id: string | null; expires: number }>();
const rateWindows = new Map<string, { start: number; count: number }>();

async function shopIdFor(domain: string): Promise<string | null> {
  const cached = shopCache.get(domain);
  if (cached && cached.expires > Date.now()) return cached.id;
  const shop = await prisma.shop.findUnique({ where: { shopDomain: domain }, select: { id: true } });
  shopCache.set(domain, { id: shop?.id ?? null, expires: Date.now() + SHOP_CACHE_TTL_MS });
  return shop?.id ?? null;
}

function overLimit(shopId: string): boolean {
  const now = Date.now();
  const window = rateWindows.get(shopId);
  if (!window || now - window.start >= RATE_WINDOW_MS) {
    rateWindows.set(shopId, { start: now, count: 1 });
    return false;
  }
  window.count += 1;
  return window.count > RATE_LIMIT_PER_SHOP;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  await authenticate.public.appProxy(request);
  const shopDomain = new URL(request.url).searchParams.get("shop");
  if (!shopDomain) return Response.json({ error: "Missing shop" }, { status: 400 });

  let payload: { reelId?: unknown; eventType?: unknown; seconds?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = (typeof payload.eventType === "string" ? payload.eventType : "") as TrackedEvent;
  const match = typeof payload.reelId === "string" ? payload.reelId.match(REEL_ID) : null;
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    return Response.json({ error: "Invalid eventType" }, { status: 400 });
  }
  if (!match) {
    return Response.json({ error: "Invalid reelId" }, { status: 400 });
  }
  let amount = 1;
  if (eventType === "watch") {
    const seconds = payload.seconds;
    if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 1 || seconds > MAX_WATCH_SECONDS) {
      return Response.json({ error: "Invalid seconds" }, { status: 400 });
    }
    amount = seconds;
  }

  try {
    const shopId = await shopIdFor(shopDomain);
    if (!shopId) return Response.json({ error: "Shop not found" }, { status: 404 });
    if (overLimit(shopId)) return Response.json({ error: "Too many events" }, { status: 429 });

    await recordEvent(shopId, match[1], eventType, new Date(), amount);
    return Response.json({ success: true });
  } catch (error) {
    log.error("analytics.record_failed", { shop: shopDomain, eventType }, error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
};
