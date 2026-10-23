import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  recordEvent: vi.fn(),
  appProxy: vi.fn(),
}));

vi.mock("../shopify.server", () => ({ authenticate: { public: { appProxy: mocks.appProxy } } }));
vi.mock("../db.server", () => ({ default: { shop: { findUnique: mocks.findUnique } } }));
vi.mock("../models/analytics.server", () => ({ recordEvent: mocks.recordEvent }));
vi.mock("../lib/logger.server", () => ({ log: { error: vi.fn() } }));

import { action } from "../routes/api.analytics";

// Each test gets its own shop: the shop cache and rate windows live in the module.
let shop = 0;
let domain = "";
const send = (body: unknown, method = "POST") =>
  action({
    request: new Request(`https://app.test/api/analytics?shop=${domain}`, {
      method,
      body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    }),
    params: {},
    context: {},
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  shop += 1;
  domain = `shop-${shop}.myshopify.com`;
  mocks.findUnique.mockResolvedValue({ id: `id-${shop}` });
  mocks.recordEvent.mockResolvedValue(undefined);
});

describe("storefront analytics endpoint", () => {
  it.each(["view", "click_product", "add_to_cart", "complete"])("counts %s once, under the numeric reel id", async (eventType) => {
    const response = await send({ reelId: "gid://shopify/Metaobject/42", eventType });
    expect(response.status).toBe(200);
    expect(mocks.recordEvent).toHaveBeenCalledWith(`id-${shop}`, "42", eventType, expect.any(Date), 1);
  });

  it("adds watch time in seconds", async () => {
    expect((await send({ reelId: "42", eventType: "watch", seconds: 37 })).status).toBe(200);
    expect(mocks.recordEvent).toHaveBeenCalledWith(`id-${shop}`, "42", "watch", expect.any(Date), 37);
  });

  it.each([undefined, 0, -5, 2.5, "30", 901])("rejects watch time of %j seconds", async (seconds) => {
    expect((await send({ reelId: "42", eventType: "watch", seconds })).status).toBe(400);
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it.each([
    [{ reelId: "42", eventType: "purchase" }, "Invalid eventType"],
    [{ reelId: "gid://shopify/Product/42", eventType: "view" }, "Invalid reelId"],
    [{ reelId: "42; drop table", eventType: "view" }, "Invalid reelId"],
    ["{not json", "Invalid JSON"],
  ])("rejects %j", async (body, error) => {
    const response = await send(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
  });

  it("only accepts POST through the signed app proxy", async () => {
    expect((await send(null, "GET")).status).toBe(405);
    await send({ reelId: "42", eventType: "view" });
    expect(mocks.appProxy).toHaveBeenCalled();
  });

  it("unknown shops get a 404", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect((await send({ reelId: "42", eventType: "view" })).status).toBe(404);
  });

  it("caps events per shop per minute", async () => {
    const statuses = [];
    for (let i = 0; i < 1201; i++) statuses.push((await send({ reelId: "42", eventType: "view" })).status);
    expect(statuses.slice(0, 1200).every((s) => s === 200)).toBe(true);
    expect(statuses[1200]).toBe(429);
    // The shop lookup is cached, not repeated per event.
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
  });
});
