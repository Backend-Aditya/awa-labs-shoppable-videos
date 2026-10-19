import { describe, expect, it } from "vitest";
import { classifyImportLink } from "./video-link";

describe("classifyImportLink", () => {
  it("is empty for blank input", () => {
    expect(classifyImportLink("   ")).toEqual({ kind: "empty" });
  });

  it.each([
    ["https://www.instagram.com/reel/DRcloKUDRAd/", "instagram"],
    ["https://instagram.com/p/CUbHfhpswxt/?igsh=abc", "instagram"],
    ["https://www.instagram.com/someshop/reel/DRcloKUDRAd/", "instagram"],
    ["instagram.com/reels/DRcloKUDRAd", "instagram"],
    ["https://www.tiktok.com/@gashi/video/7590942601512013086", "tiktok"],
    ["https://m.tiktok.com/@gashi/video/7590942601512013086?lang=en", "tiktok"],
    ["https://vm.tiktok.com/ZMabc123/", "tiktok"],
  ])("routes %s to the %s importer", (link, platform) => {
    expect(classifyImportLink(link)).toEqual({ kind: "social", platform });
  });

  it("passes direct video file links through untouched, minus any #fragment", () => {
    expect(classifyImportLink("https://cdn.shop.com/videos/launch.mp4?v=2#t=10")).toEqual({
      kind: "file",
      url: "https://cdn.shop.com/videos/launch.mp4?v=2",
      source: "direct",
    });
    // CDN links often have no extension; Cloudflare decides if it's a video.
    expect(classifyImportLink("https://pub-123.r2.dev/abc")).toMatchObject({ kind: "file", source: "direct" });
  });

  it("rewrites Dropbox share links to download the file", () => {
    expect(classifyImportLink("https://www.dropbox.com/scl/fi/xyz/clip.mov?rlkey=k1&dl=0")).toEqual({
      kind: "file",
      url: "https://www.dropbox.com/scl/fi/xyz/clip.mov?rlkey=k1&dl=1",
      source: "dropbox",
    });
    expect(classifyImportLink("https://www.dropbox.com/s/abc/clip.mp4?raw=1")).toEqual({
      kind: "file",
      url: "https://www.dropbox.com/s/abc/clip.mp4?dl=1",
      source: "dropbox",
    });
    expect(classifyImportLink("https://www.dropbox.com/home/videos")).toMatchObject({ kind: "invalid" });
  });

  it.each([
    ["https://drive.google.com/file/d/1abc/view?usp=sharing", /Google Drive/],
    ["https://www.youtube.com/shorts/abc123", /YouTube links open a web page/],
    ["https://youtu.be/abc123", /YouTube/],
    ["https://www.facebook.com/reel/123", /Facebook/],
    ["https://vimeo.com/123456", /Vimeo/],
    ["https://x.com/user/status/1", /X links/],
    ["https://www.instagram.com/natgeo/", /not a profile/],
    ["https://www.tiktok.com/@gashi", /not a profile/],
  ])("explains why %s can't be imported", (link, message) => {
    const result = classifyImportLink(link);
    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.error).toMatch(message);
  });

  it.each([
    "http://localhost:3000/video.mp4",
    "http://127.0.0.1/video.mp4",
    "http://169.254.169.254/latest/meta-data",
    "https://intranet/video.mp4",
    "https://files.internal/video.mp4",
    "http://[::1]/video.mp4",
  ])("refuses non-public address %s", (link) => {
    expect(classifyImportLink(link)).toMatchObject({ kind: "invalid", error: expect.stringMatching(/publicly reachable/) });
  });

  it("rejects non-web schemes and gibberish", () => {
    expect(classifyImportLink("ftp://files.shop.com/a.mp4")).toMatchObject({ kind: "invalid" });
    expect(classifyImportLink("javascript:alert(1)")).toMatchObject({ kind: "invalid" });
    expect(classifyImportLink("not a link at all")).toMatchObject({ kind: "invalid" });
  });
});
