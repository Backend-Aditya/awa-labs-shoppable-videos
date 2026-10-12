import { afterEach, describe, expect, it, vi } from "vitest";
import { animatedPreviewUrl, formatDuration, isStreamThumbnail, posterAt } from "./reel-media";
import { deriveReelStatus } from "./reel-status";
import { healProcessingReels } from "./reel-media.server";
import type { Reel, ReelConfig } from "./reel.server";

const THUMB = "https://customer-abc.cloudflarestream.com/uid123/thumbnails/thumbnail.jpg";

describe("posterAt", () => {
  it("adds the cover time to a Stream thumbnail", () => {
    expect(posterAt(THUMB, 3.25)).toBe(`${THUMB}?time=3.3s`);
  });

  it("replaces an existing time rather than stacking params", () => {
    expect(posterAt(`${THUMB}?time=9s`, 2)).toBe(`${THUMB}?time=2s`);
  });

  it("returns the plain frame for zero or missing times", () => {
    expect(posterAt(`${THUMB}?time=9s`, 0)).toBe(THUMB);
    expect(posterAt(THUMB, undefined)).toBe(THUMB);
  });

  it("leaves non-Stream URLs untouched", () => {
    const other = "https://cdn.shopify.com/poster.jpg";
    expect(posterAt(other, 4)).toBe(other);
    expect(isStreamThumbnail(other)).toBe(false);
  });
});

describe("animatedPreviewUrl", () => {
  it("builds a short gif from the cover frame", () => {
    expect(animatedPreviewUrl(`${THUMB}?time=5s`, 5)).toBe(
      "https://customer-abc.cloudflarestream.com/uid123/thumbnails/thumbnail.gif?time=5s&duration=4s&height=360&fps=12",
    );
  });

  it("returns null for anything that isn't a Stream thumbnail", () => {
    expect(animatedPreviewUrl(undefined)).toBeNull();
    expect(animatedPreviewUrl("https://example.com/a.jpg")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats m:ss", () => {
    expect(formatDuration(65.4)).toBe("1:05");
    expect(formatDuration(undefined)).toBe("");
  });
});

const base: ReelConfig = { productIds: [], interactions: {}, source: { type: "upload" } };

describe("deriveReelStatus", () => {
  it("reports a failed upload as failed even when it already has a Stream uid", () => {
    expect(deriveReelStatus({ ...base, cloudflareStreamUid: "u", uploadFailedAt: "2026-10-12T00:00:00Z" })).toBe("failed");
  });

  it("keeps a live video ready while a replacement fails", () => {
    expect(deriveReelStatus({ ...base, hlsManifestUrl: "x.m3u8", uploadFailedAt: "2026-10-12T00:00:00Z" })).toBe("ready");
  });

  it("orders draft < processing < ready", () => {
    expect(deriveReelStatus(base)).toBe("draft");
    expect(deriveReelStatus({ ...base, cloudflareStreamUid: "u" })).toBe("processing");
    expect(deriveReelStatus({ ...base, cloudflareStreamUid: "u", hlsManifestUrl: "x" })).toBe("ready");
  });
});

describe("healProcessingReels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const reel = (config: Partial<ReelConfig>): Reel => ({
    id: "gid://shopify/Metaobject/1",
    handle: "r1",
    title: "R1",
    published: true,
    config: { ...base, ...config },
  });

  it("applies a finished video, keeping the chosen cover frame", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          errors: [],
          result: {
            uid: "u1",
            status: { state: "ready" },
            readyToStream: true,
            duration: 12,
            thumbnail: THUMB,
            meta: {},
            playback: { hls: "https://h/u1.m3u8", dash: "https://h/u1.mpd" },
          },
        }),
      ),
    );

    const writes: string[] = [];
    const admin = {
      graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
        if (query.includes("GetReel")) {
          return { json: async () => ({ data: { metaobject: { id: "gid://shopify/Metaobject/1", handle: "r1", title: { jsonValue: "R1" }, published: { jsonValue: "true" }, config: { jsonValue: { ...base, cloudflareStreamUid: "u1", coverTimeSeconds: 4 } } } } }) };
        }
        const fields = (options?.variables?.metaobject as { fields: { key: string; value: string }[] }).fields;
        const config = fields.find((f) => f.key === "config")!.value;
        writes.push(config);
        return { json: async () => ({ data: { metaobjectUpsert: { metaobject: { id: "gid://shopify/Metaobject/1", handle: "r1", title: { jsonValue: "R1" }, published: { jsonValue: "true" }, config: { jsonValue: JSON.parse(config) } }, userErrors: [] } } }) };
      },
    };

    const [healed] = await healProcessingReels(admin, [reel({ cloudflareStreamUid: "u1", coverTimeSeconds: 4 })]);

    expect(healed.config.hlsManifestUrl).toBe("https://h/u1.m3u8");
    expect(healed.config.posterUrl).toBe(`${THUMB}?time=4s`);
    expect(deriveReelStatus(healed.config)).toBe("ready");
    expect(writes).toHaveLength(1);
  });

  it("makes no calls when nothing is waiting", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const ready = reel({ cloudflareStreamUid: "u", hlsManifestUrl: "x" });
    expect(await healProcessingReels({ graphql: vi.fn() }, [ready])).toEqual([ready]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never throws when Cloudflare is unreachable", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "token");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    const waiting = reel({ cloudflareStreamUid: "u" });
    expect(await healProcessingReels({ graphql: vi.fn() }, [waiting])).toEqual([waiting]);
  });
});
