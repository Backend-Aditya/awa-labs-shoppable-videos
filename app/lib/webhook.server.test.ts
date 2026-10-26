import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyWebhook } from "./webhook.server";

const SECRET = "test-secret";
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("base64");

const request = (body: string, headers: Record<string, string> = {}, method = "POST") =>
  new Request("https://app.test/webhooks/x", {
    method,
    body: method === "GET" ? undefined : body,
    headers: {
      "x-shopify-hmac-sha256": sign(body),
      "x-shopify-shop-domain": "a.myshopify.com",
      "x-shopify-topic": "shop/redact",
      ...headers,
    },
  });

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (error) {
    return (error as Response).status;
  }
};

describe("verifyWebhook", () => {
  const original = process.env.SHOPIFY_API_SECRET;
  beforeEach(() => {
    process.env.SHOPIFY_API_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.SHOPIFY_API_SECRET = original;
  });

  it("returns the shop, topic and payload of a correctly signed webhook", async () => {
    const body = JSON.stringify({ shop_id: 1 });
    expect(await verifyWebhook(request(body))).toEqual({ shop: "a.myshopify.com", topic: "shop/redact", payload: { shop_id: 1 } });
  });

  it("rejects a bad or missing signature with 401", async () => {
    const body = "{}";
    expect(await status(verifyWebhook(request(body, { "x-shopify-hmac-sha256": sign(body, "other") })))).toBe(401);
    expect(await status(verifyWebhook(request(body, { "x-shopify-hmac-sha256": "" })))).toBe(401);
    expect(await status(verifyWebhook(request(body, { "x-shopify-hmac-sha256": "not base64 at all!!" })))).toBe(401);
  });

  it("rejects a body that was changed after signing", async () => {
    const req = request("{}", { "x-shopify-hmac-sha256": sign('{"a":1}') });
    expect(await status(verifyWebhook(req))).toBe(401);
  });

  it("rejects other methods, missing headers and unreadable bodies", async () => {
    expect(await status(verifyWebhook(request("", {}, "GET")))).toBe(405);
    expect(await status(verifyWebhook(request("{}", { "x-shopify-shop-domain": "" })))).toBe(400);
    expect(await status(verifyWebhook(request("{nope", { "x-shopify-hmac-sha256": sign("{nope") })))).toBe(400);
  });

  it("fails loudly when the secret is not configured", async () => {
    delete process.env.SHOPIFY_API_SECRET;
    expect(await status(verifyWebhook(request("{}")))).toBe(500);
  });
});
