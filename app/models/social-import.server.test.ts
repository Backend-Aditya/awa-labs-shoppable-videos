import { afterEach, describe, expect, it, vi } from "vitest";
import { listProfilePostUrls, parseSocialVideoUrl, SocialImportError } from "./social-import.server";

describe("parseSocialVideoUrl", () => {
  it("recognizes an Instagram reel URL", () => {
    expect(parseSocialVideoUrl("https://www.instagram.com/reel/Cxyz123/")).toEqual({
      platform: "instagram",
    });
  });

  it("recognizes an Instagram post URL without www", () => {
    expect(parseSocialVideoUrl("https://instagram.com/p/Cxyz123/")).toEqual({
      platform: "instagram",
    });
  });

  it("recognizes a TikTok video URL", () => {
    expect(
      parseSocialVideoUrl("https://www.tiktok.com/@someone/video/1234567890"),
    ).toEqual({ platform: "tiktok" });
  });

  it("recognizes a TikTok short link by host alone", () => {
    expect(parseSocialVideoUrl("https://vm.tiktok.com/ZMabcdefg/")).toEqual({
      platform: "tiktok",
    });
  });

  it("rejects an unrelated URL", () => {
    expect(parseSocialVideoUrl("https://example.com/video/1")).toBeNull();
  });

  it("rejects an Instagram profile URL with no post path", () => {
    expect(parseSocialVideoUrl("https://www.instagram.com/someone/")).toBeNull();
  });

  it("rejects a malformed URL", () => {
    expect(parseSocialVideoUrl("not a url")).toBeNull();
  });
});

describe("listProfilePostUrls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts deduped Instagram post URLs from shortcodes in the page HTML", async () => {
    const html = `<script>{"shortcode":"ABC123"}{"shortcode":"DEF456"}{"shortcode":"ABC123"}</script>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => html }),
    );

    const posts = await listProfilePostUrls("instagram", "@someone");

    expect(posts).toEqual([
      { url: "https://www.instagram.com/p/ABC123/", thumbnailUrl: null },
      { url: "https://www.instagram.com/p/DEF456/", thumbnailUrl: null },
    ]);
  });

  it("extracts TikTok video URLs from 17-19 digit ids, ignoring shorter numeric ids", async () => {
    const html = `{"id":"12345"}{"id":"72345678901234567"}`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => html }),
    );

    const posts = await listProfilePostUrls("tiktok", "someone");

    expect(posts).toEqual([
      { url: "https://www.tiktok.com/@someone/video/72345678901234567", thumbnailUrl: null },
    ]);
  });

  it("throws SocialImportError when the profile page has no matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => "<html></html>" }),
    );

    await expect(listProfilePostUrls("instagram", "someone")).rejects.toThrow(SocialImportError);
  });

  it("throws SocialImportError on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, text: async () => "" }));

    await expect(listProfilePostUrls("instagram", "someone")).rejects.toThrow(SocialImportError);
  });
});
