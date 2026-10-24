import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReelConfig } from "../models/reel.server";

const mocks = vi.hoisted(() => ({
  getReel: vi.fn(),
  upsertReel: vi.fn(),
  syncProductReelMetafields: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: { admin: vi.fn(async () => ({ admin: { graphql: vi.fn() }, session: { shop: "test.myshopify.com" } })) },
}));
vi.mock("../models/shop.server", () => ({ getOrCreateShop: vi.fn(async () => ({ id: "shop-1" })) }));
vi.mock("../models/reel.server", () => ({
  getReel: mocks.getReel,
  upsertReel: mocks.upsertReel,
  syncProductReelMetafields: mocks.syncProductReelMetafields,
  getProductsByIds: vi.fn(),
  generateReelHandle: vi.fn((t: string) => t),
  toGid: (id: string) => `gid://shopify/Metaobject/${id}`,
}));
vi.mock("../models/reel-media.server", () => ({ healProcessingReels: vi.fn() }));
vi.mock("../models/stream-assets.server", () => ({ releaseStreamAssets: vi.fn() }));
vi.mock("../models/reel-lifecycle.server", () => ({ deleteReelEverywhere: vi.fn() }));
vi.mock("../models/widget.server", () => ({ listWidgetsForShop: vi.fn() }));
vi.mock("../models/analytics.server", () => ({ getReelStats: vi.fn() }));

import { action } from "../routes/app.reels.$id";

const config = (over: Partial<ReelConfig> = {}): ReelConfig => ({
  productIds: ["gid://shopify/Product/7", "gid://shopify/Product/8"],
  interactions: {},
  source: { type: "upload" },
  durationSeconds: 30,
  ...over,
});
const save = (body: object) =>
  action({
    request: new Request("https://app.test/app/reels/5", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Morning routine", published: true, ...body }),
    }),
    params: { id: "5" },
    context: {},
  } as never);
const savedConfig = () => mocks.upsertReel.mock.calls[0][4] as ReelConfig;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsertReel.mockResolvedValue({ id: "gid://shopify/Metaobject/5" });
});

describe("reel save: product moments", () => {
  it("stores sanitised times for tagged products", async () => {
    mocks.getReel.mockResolvedValue({ id: "gid://shopify/Metaobject/5", handle: "r", title: "R", published: true, config: config() });
    await expect(save({ productTimes: { "7": 3.4, "8": 99, "9": 1, "x": "y" } })).resolves.toEqual({ ok: true, error: null });
    expect(savedConfig().productTimes).toEqual({ "7": 3, "8": 29 });
  });

  it("keeps stored times when the moments weren't edited, dropping products no longer tagged", async () => {
    mocks.getReel.mockResolvedValue({
      id: "gid://shopify/Metaobject/5",
      handle: "r",
      title: "R",
      published: true,
      config: config({ productTimes: { "7": 4, "8": 9 } }),
    });
    await save({ productIds: ["gid://shopify/Product/8"] });
    expect(savedConfig().productTimes).toEqual({ "8": 9 });
  });

  it("no times leaves the config without the key", async () => {
    mocks.getReel.mockResolvedValue({ id: "gid://shopify/Metaobject/5", handle: "r", title: "R", published: true, config: config({ productTimes: { "7": 4 } }) });
    await save({ productTimes: {} });
    expect("productTimes" in savedConfig() && savedConfig().productTimes !== undefined).toBe(false);
  });
});
