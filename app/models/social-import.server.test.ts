import { describe, expect, it } from "vitest";
import { parseSocialVideoUrl } from "./social-import.server";

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
