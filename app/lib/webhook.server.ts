import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifiedWebhook {
  shop: string;
  topic: string;
  payload: Record<string, unknown>;
}

// Verifies a Shopify webhook's signature and reads it, nothing more.
//
// The library's `authenticate.webhook` also loads the shop's offline session
// and, with expiring offline tokens on, refreshes it before the handler
// runs. After an uninstall that token is revoked, so the refresh fails and
// the request answers 500 before our code runs: Shopify then retries
// app/uninstalled and shop/redact for hours, and the shop's data is never
// erased. None of these handlers need the session, so they verify the
// signature alone.
export async function verifyWebhook(request: Request): Promise<VerifiedWebhook> {
  if (request.method !== "POST") throw new Response(undefined, { status: 405, statusText: "Method not allowed" });

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Response(undefined, { status: 500, statusText: "Webhook secret missing" });

  const rawBody = await request.text();
  const received = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(received, "base64");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Response(undefined, { status: 401, statusText: "Unauthorized" });
  }

  const shop = request.headers.get("x-shopify-shop-domain") ?? "";
  const topic = request.headers.get("x-shopify-topic") ?? "";
  if (!shop || !topic) throw new Response(undefined, { status: 400, statusText: "Bad Request" });

  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = rawBody ? JSON.parse(rawBody) : {};
    if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
  } catch {
    throw new Response(undefined, { status: 400, statusText: "Bad Request" });
  }
  return { shop, topic, payload };
}
