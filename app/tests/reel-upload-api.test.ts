import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsertReel: vi.fn(),
  getReel: vi.fn(),
  updateReelConfig: vi.fn(),
  deleteReel: vi.fn(),
  syncProductReelMetafields: vi.fn(),
  createDirectUploadUrl: vi.fn(),
  recordStreamAsset: vi.fn(),
  discardStreamAsset: vi.fn(),
  releaseStreamAssets: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({ admin: { graphql: vi.fn() }, session: { shop: "test.myshopify.com" } })),
  },
}));

vi.mock("../models/reel.server", () => ({
  upsertReel: mocks.upsertReel,
  getReel: mocks.getReel,
  updateReelConfig: mocks.updateReelConfig,
  deleteReel: mocks.deleteReel,
  syncProductReelMetafields: mocks.syncProductReelMetafields,
  generateReelHandle: (title: string) => `${title}-handle`,
}));

vi.mock("../models/shop.server", () => ({
  getOrCreateShop: vi.fn(async () => ({ id: "shop-1", shopDomain: "test.myshopify.com" })),
}));

vi.mock("../models/stream-assets.server", () => ({
  recordStreamAsset: mocks.recordStreamAsset,
  discardStreamAsset: mocks.discardStreamAsset,
  releaseStreamAssets: mocks.releaseStreamAssets,
}));

vi.mock("../models/cloudflare-stream.server", () => ({
  createDirectUploadUrl: mocks.createDirectUploadUrl,
  getCloudflareConfig: () => ({ accountId: "a", apiToken: "t" }),
  uploadBufferToDirectUploadUrl: vi.fn(),
}));

vi.mock("../models/social-import.server", () => ({
  parseSocialVideoUrl: (url: string) => (url.includes("instagram.com") ? { platform: "instagram" } : null),
  resolveVideoSourceUrl: vi.fn(),
  fetchSocialVideo: vi.fn(),
  SocialImportError: class extends Error {},
}));

import { action } from "../routes/app.reels.upload";

const call = async (body: unknown) => {
  const request = new Request("https://app.test/app/reels/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = (await action({ request, params: {}, context: {} } as never)) as Response;
  return { status: response.status, data: (await response.json()) as Record<string, unknown> };
};

const REEL = { id: "gid://shopify/Metaobject/7", handle: "h", title: "T", published: true, config: { productIds: [] } };

describe("reel upload API", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.upsertReel.mockResolvedValue(REEL);
    mocks.updateReelConfig.mockResolvedValue(REEL);
    mocks.getReel.mockResolvedValue(REEL);
    mocks.createDirectUploadUrl.mockResolvedValue({ uid: "uid-1", uploadURL: "https://upload.test/1" });
  });

  it("creates a reel, records the Stream uid and returns the one-time upload URL", async () => {
    const { status, data } = await call({
      intent: "create",
      title: "  Summer look  ",
      productIds: ["gid://shopify/Product/1", "not-a-gid", "gid://shopify/Product/1"],
    });

    expect(status).toBe(200);
    expect(data).toEqual({ reelId: REEL.id, uploadURL: "https://upload.test/1" });
    const [, , title, published, config] = mocks.upsertReel.mock.calls[0];
    expect(title).toBe("Summer look");
    expect(published).toBe(true);
    expect(config.productIds).toEqual(["gid://shopify/Product/1"]);
    expect(mocks.updateReelConfig).toHaveBeenCalledWith(expect.anything(), REEL.id, { cloudflareStreamUid: "uid-1" });
    // Recorded so it can be deleted from Cloudflare later.
    expect(mocks.recordStreamAsset).toHaveBeenCalledWith("shop-1", "uid-1");
  });

  it("deletes the Stream video of a first upload that failed", async () => {
    mocks.getReel.mockResolvedValue({ ...REEL, config: { productIds: [], cloudflareStreamUid: "uid-9" } });

    const { status } = await call({ intent: "failed", reelId: REEL.id });

    expect(status).toBe(200);
    expect(mocks.updateReelConfig).toHaveBeenCalledWith(
      expect.anything(),
      REEL.id,
      expect.objectContaining({ cloudflareStreamUid: "", replacingStreamUid: "" }),
    );
    expect(mocks.releaseStreamAssets).toHaveBeenCalledWith(expect.anything(), "shop-1", ["uid-9"]);
  });

  it("keeps the live video when only a replacement failed", async () => {
    mocks.getReel.mockResolvedValue({
      ...REEL,
      config: { productIds: [], cloudflareStreamUid: "live", hlsManifestUrl: "x.m3u8", replacingStreamUid: "new" },
    });

    await call({ intent: "failed", reelId: REEL.id });

    const [, , patch] = mocks.updateReelConfig.mock.calls.at(-1)!;
    expect(patch).not.toHaveProperty("cloudflareStreamUid");
    expect(mocks.releaseStreamAssets).toHaveBeenCalledWith(expect.anything(), "shop-1", ["new"]);
  });

  it("deletes the half-created reel when Cloudflare can't issue an upload URL", async () => {
    mocks.createDirectUploadUrl.mockRejectedValue(new Error("cloudflare down"));

    const { status, data } = await call({ intent: "create", title: "x", productIds: ["gid://shopify/Product/1"] });

    expect(status).toBe(502);
    expect(data.error).toMatch(/Cloudflare/);
    expect(mocks.syncProductReelMetafields).toHaveBeenLastCalledWith(expect.anything(), REEL.id, ["gid://shopify/Product/1"], []);
    expect(mocks.deleteReel).toHaveBeenCalledWith(expect.anything(), REEL.id);
  });

  it("rejects links that aren't Instagram or TikTok without creating anything", async () => {
    const { status } = await call({ intent: "import", title: "x", sourceUrl: "https://example.com/v.mp4" });
    expect(status).toBe(400);
    expect(mocks.upsertReel).not.toHaveBeenCalled();
  });

  it("starts a replacement without touching the live video", async () => {
    const { status, data } = await call({ intent: "replace", reelId: REEL.id });
    expect(status).toBe(200);
    expect(data.uploadURL).toBe("https://upload.test/1");
    expect(mocks.updateReelConfig).toHaveBeenCalledWith(expect.anything(), REEL.id, {
      replacingStreamUid: "uid-1",
      uploadFailedAt: "",
    });
  });

  it("refuses malformed reel ids", async () => {
    expect((await call({ intent: "replace", reelId: "../../etc" })).status).toBe(404);
    expect((await call({ intent: "failed", reelId: "nope" })).status).toBe(404);
    expect(mocks.updateReelConfig).not.toHaveBeenCalled();
  });

  it("rejects unknown intents and bad JSON", async () => {
    expect((await call({ intent: "explode" })).status).toBe(400);
    const request = new Request("https://app.test/app/reels/upload", { method: "POST", body: "{not json" });
    const response = (await action({ request, params: {}, context: {} } as never)) as Response;
    expect(response.status).toBe(400);
  });
});
