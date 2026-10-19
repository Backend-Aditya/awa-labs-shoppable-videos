import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsertReel: vi.fn(),
  getReel: vi.fn(),
  updateReelConfig: vi.fn(),
  deleteReel: vi.fn(),
  syncProductReelMetafields: vi.fn(),
  createDirectUploadUrl: vi.fn(),
  copyVideoFromUrl: vi.fn(),
  uploadBufferToDirectUploadUrl: vi.fn(),
  resolveSocialVideo: vi.fn(),
  downloadSocialVideo: vi.fn(),
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
  copyVideoFromUrl: mocks.copyVideoFromUrl,
  getCloudflareConfig: () => ({ accountId: "a", apiToken: "t" }),
  uploadBufferToDirectUploadUrl: mocks.uploadBufferToDirectUploadUrl,
}));

vi.mock("../models/social-import.server", () => ({
  resolveSocialVideo: mocks.resolveSocialVideo,
  downloadSocialVideo: mocks.downloadSocialVideo,
  SocialImportError: class SocialImportError extends Error {},
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
    expect(data.error).toMatch(/temporarily unavailable/);
    expect(mocks.syncProductReelMetafields).toHaveBeenLastCalledWith(expect.anything(), REEL.id, ["gid://shopify/Product/1"], []);
    expect(mocks.deleteReel).toHaveBeenCalledWith(expect.anything(), REEL.id);
  });

  it("refuses an import until the merchant confirms the rights", async () => {
    const { status } = await call({ intent: "import", title: "x", sourceUrl: "https://cdn.shop.com/v.mp4" });
    expect(status).toBe(400);
    expect(mocks.upsertReel).not.toHaveBeenCalled();
  });

  it("imports a video file link by having Cloudflare download it", async () => {
    mocks.copyVideoFromUrl.mockResolvedValue({ uid: "uid-copy" });

    const { status, data } = await call({
      intent: "import",
      title: "Launch",
      sourceUrl: "https://www.dropbox.com/scl/fi/abc/launch.mp4?rlkey=k&dl=0",
      rightsConfirmed: true,
    });

    expect(status).toBe(200);
    expect(data).toEqual({ reelId: REEL.id });
    const [, url, meta] = mocks.copyVideoFromUrl.mock.calls[0];
    expect(url).toBe("https://www.dropbox.com/scl/fi/abc/launch.mp4?rlkey=k&dl=1");
    // The webhook finds the reel by these.
    expect(meta).toMatchObject({ reelId: REEL.id, shop: "test.myshopify.com" });
    const [, , , , config] = mocks.upsertReel.mock.calls[0];
    expect(config.source).toEqual({ type: "link", originalUrl: "https://www.dropbox.com/scl/fi/abc/launch.mp4?rlkey=k&dl=0" });
    expect(mocks.recordStreamAsset).toHaveBeenCalledWith("shop-1", "uid-copy");
    expect(mocks.updateReelConfig).toHaveBeenCalledWith(expect.anything(), REEL.id, { cloudflareStreamUid: "uid-copy" });
    // Nothing is downloaded through this server.
    expect(mocks.createDirectUploadUrl).not.toHaveBeenCalled();
  });

  it("cleans up and explains when Cloudflare rejects the link", async () => {
    mocks.copyVideoFromUrl.mockRejectedValue(new Error("Invalid URL"));

    const { status, data } = await call({
      intent: "import",
      title: "x",
      sourceUrl: "https://cdn.shop.com/v.mp4",
      rightsConfirmed: true,
    });

    expect(status).toBe(502);
    expect(data.error).toMatch(/couldn't accept that link/);
    expect(mocks.deleteReel).toHaveBeenCalledWith(expect.anything(), REEL.id);
    expect(mocks.recordStreamAsset).not.toHaveBeenCalled();
  });

  it.each([
    ["https://drive.google.com/file/d/1abc/view", /Google Drive/],
    ["https://www.youtube.com/shorts/abc", /YouTube/],
    ["http://localhost/v.mp4", /publicly reachable/],
    ["", /Paste a link/],
  ])("rejects %s with a reason and creates nothing", async (sourceUrl, message) => {
    const { status, data } = await call({ intent: "import", title: "x", sourceUrl, rightsConfirmed: true });
    expect(status).toBe(400);
    expect(data.error).toMatch(message);
    expect(mocks.upsertReel).not.toHaveBeenCalled();
    expect(mocks.copyVideoFromUrl).not.toHaveBeenCalled();
  });

  it("imports an Instagram reel: titled from its caption, downloaded by Cloudflare", async () => {
    mocks.resolveSocialVideo.mockResolvedValue({
      platform: "instagram",
      videoUrl: "https://instagram.fcdn.test/v.mp4",
      posterUrl: null,
      title: "Summer linen, three ways",
      durationSeconds: 27,
      downloadHeaders: null,
    });
    mocks.copyVideoFromUrl.mockResolvedValue({ uid: "uid-ig" });

    const { status, data } = await call({
      intent: "import",
      title: "",
      sourceUrl: "https://www.instagram.com/reel/DRcloKUDRAd/",
      rightsConfirmed: true,
    });

    expect(status).toBe(200);
    expect(data).toEqual({ reelId: REEL.id });
    expect(mocks.resolveSocialVideo).toHaveBeenCalledWith("instagram", "https://www.instagram.com/reel/DRcloKUDRAd/");
    const [, , title, , config] = mocks.upsertReel.mock.calls[0];
    expect(title).toBe("Summer linen, three ways");
    expect(config.source).toEqual({ type: "instagram", originalUrl: "https://www.instagram.com/reel/DRcloKUDRAd/" });
    expect(mocks.copyVideoFromUrl.mock.calls[0][1]).toBe("https://instagram.fcdn.test/v.mp4");
    expect(mocks.copyVideoFromUrl.mock.calls[0][2]).toMatchObject({ reelId: REEL.id, shop: "test.myshopify.com" });
    expect(mocks.downloadSocialVideo).not.toHaveBeenCalled();
    expect(mocks.recordStreamAsset).toHaveBeenCalledWith("shop-1", "uid-ig");
    expect(mocks.updateReelConfig).toHaveBeenCalledWith(expect.anything(), REEL.id, { cloudflareStreamUid: "uid-ig" });
  });

  it("imports a TikTok: downloaded here with the page's cookies, then uploaded to Stream", async () => {
    const resolved = {
      platform: "tiktok",
      videoUrl: "https://v16.tiktok.test/play.mp4",
      posterUrl: null,
      title: null,
      durationSeconds: 18,
      downloadHeaders: { cookie: "tt_chain_token=a" },
    };
    mocks.resolveSocialVideo.mockResolvedValue(resolved);
    const file = new Response("bytes");
    mocks.downloadSocialVideo.mockResolvedValue(file);

    const { status } = await call({
      intent: "import",
      title: "My title",
      sourceUrl: "https://www.tiktok.com/@shop/video/7590942601512013086",
      rightsConfirmed: true,
    });

    expect(status).toBe(200);
    expect(mocks.upsertReel.mock.calls[0][2]).toBe("My title");
    expect(mocks.downloadSocialVideo).toHaveBeenCalledWith(resolved);
    expect(mocks.uploadBufferToDirectUploadUrl).toHaveBeenCalledWith("https://upload.test/1", file, "h.mp4");
    expect(mocks.copyVideoFromUrl).not.toHaveBeenCalled();
    expect(mocks.updateReelConfig).toHaveBeenCalledWith(expect.anything(), REEL.id, { cloudflareStreamUid: "uid-1" });
  });

  it("falls back to a platform title when the post has no caption", async () => {
    mocks.resolveSocialVideo.mockResolvedValue({
      platform: "tiktok",
      videoUrl: "https://v",
      posterUrl: null,
      title: null,
      durationSeconds: null,
      downloadHeaders: {},
    });
    mocks.downloadSocialVideo.mockResolvedValue(new Response("x"));
    await call({ intent: "import", sourceUrl: "https://vm.tiktok.com/ZMabc/", rightsConfirmed: true });
    expect(mocks.upsertReel.mock.calls[0][2]).toBe("TikTok video");
  });

  it("creates nothing when the post can't be read, and passes the reason on", async () => {
    const { SocialImportError } = await import("../models/social-import.server");
    mocks.resolveSocialVideo.mockRejectedValue(new SocialImportError("That Instagram post is a photo, not a video."));

    const { status, data } = await call({
      intent: "import",
      sourceUrl: "https://www.instagram.com/p/CUbHfhpswxt/",
      rightsConfirmed: true,
    });

    expect(status).toBe(502);
    expect(data.error).toBe("That Instagram post is a photo, not a video.");
    expect(mocks.upsertReel).not.toHaveBeenCalled();
  });

  it("removes the reel and its Stream video when the hand-off fails", async () => {
    mocks.resolveSocialVideo.mockResolvedValue({
      platform: "tiktok",
      videoUrl: "https://v",
      posterUrl: null,
      title: "t",
      durationSeconds: null,
      downloadHeaders: {},
    });
    mocks.downloadSocialVideo.mockResolvedValue(new Response("x"));
    mocks.uploadBufferToDirectUploadUrl.mockRejectedValue(new Error("Cloudflare 500"));

    const { status, data } = await call({
      intent: "import",
      sourceUrl: "https://www.tiktok.com/@a/video/1",
      rightsConfirmed: true,
    });

    expect(status).toBe(502);
    expect(data.error).toMatch(/Couldn't import that video/);
    expect(mocks.deleteReel).toHaveBeenCalledWith(expect.anything(), REEL.id);
    expect(mocks.discardStreamAsset).toHaveBeenCalledWith("shop-1", "uid-1");
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
