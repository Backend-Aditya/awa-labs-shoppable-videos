import { describe, expect, it, vi } from "vitest";
import {
  downloadSocialVideo,
  extractInstagramVideo,
  extractTiktokVideo,
  instagramShortcode,
  MAX_DOWNLOAD_BYTES,
  resolveSocialVideo,
  SocialImportError,
} from "./social-import.server";

// Page fixtures shaped like the real logged-out pages: the data lives in
// JSON <script> blobs, mixed with unrelated (and unparseable) scripts.
const igPage = (media: object, extra: object[] = []) =>
  [
    "<html><head><title>Instagram</title>",
    '<script type="application/json" data-sjs>{not json</script>',
    ...extra.map((e) => `<script type="application/json" data-sjs>${JSON.stringify(e)}</script>`),
    `<script type="application/json" data-sjs>${JSON.stringify({ require: [["ScheduledServerJS", { __bbox: { result: { data: { items: [media] } } } }]] })}</script>`,
    "</head></html>",
  ].join("\n");

const igReel = {
  code: "DRcloKUDRAd",
  media_type: 2,
  video_versions: [
    { type: 101, url: "https://instagram.fcdn.test/v/main.mp4?oh=1" },
    { type: 102, url: "https://instagram.fcdn.test/v/alt.mp4" },
  ],
  image_versions2: { candidates: [{ url: "https://instagram.fcdn.test/p/cover.jpg" }] },
  caption: { text: "#ad\nSummer linen, three ways ☀️ — which is your pick?\n#style #linen" },
  video_duration: 27.4,
};

// The embed page: a ServerJS handle() payload whose contextJSON field is a
// JSON string holding the GraphQL-shaped media.
const igEmbedPage = (shortcodeMedia: object) => {
  const contextJSON = JSON.stringify({ context: { type: "GraphVideo" }, gql_data: { shortcode_media: shortcodeMedia } });
  const payload = { require: [["PolarisEmbedSimple", "init", [], [{ isRichEmbed: true, contextJSON }]]] };
  return `<html><script nonce="x">requireLazy(["ServerJS"],function(ServerJS){var s=(new ServerJS());s.handle(${JSON.stringify(payload)});});</script></html>`;
};

const igEmbedReel = {
  __typename: "GraphVideo",
  shortcode: "DXMVbNOEmWh",
  is_video: true,
  video_url: "https://instagram.fcdn.test/v/embed-360.mp4",
  display_url: "https://instagram.fcdn.test/p/embed-cover.jpg",
  edge_media_to_caption: { edges: [{ node: { text: "Website no one really talks about" } }] },
};

const tiktokPage = (detail: object) =>
  `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
    __DEFAULT_SCOPE__: { "webapp.app-context": {}, "webapp.video-detail": detail },
  })}</script></html>`;

const tiktokItem = {
  desc: "Packing our bestseller 📦 #smallbusiness",
  video: {
    playAddr: "https://v16-webapp.tiktok.test/play.mp4",
    downloadAddr: "https://v16-webapp.tiktok.test/download-watermarked.mp4",
    duration: 18,
    originCover: "https://p16.tiktok.test/cover.jpg",
    bitrateInfo: [{ CodecType: "h265_hvc1", PlayAddr: { UrlList: ["https://v16.tiktok.test/h265.mp4"] } }],
  },
};

describe("instagramShortcode", () => {
  it.each([
    ["https://www.instagram.com/reel/DRcloKUDRAd/", "DRcloKUDRAd"],
    ["https://instagram.com/p/CUbHfhpswxt/?igsh=x", "CUbHfhpswxt"],
    ["https://www.instagram.com/reels/DWoi-4RDliT", "DWoi-4RDliT"],
    ["https://www.instagram.com/someshop/reel/C0xoHgDLmqg/", "C0xoHgDLmqg"],
    ["https://www.instagram.com/natgeo/", null],
  ])("%s -> %s", (url, code) => {
    expect(instagramShortcode(url)).toBe(code);
  });
});

describe("extractInstagramVideo", () => {
  it("finds the post's own media among unrelated posts and takes its first video", () => {
    const other = { code: "OTHERPOST", media_type: 2, video_versions: [{ url: "https://instagram.fcdn.test/other.mp4" }] };
    expect(extractInstagramVideo(igPage(igReel, [{ data: other }]), "DRcloKUDRAd")).toEqual({
      videoUrl: "https://instagram.fcdn.test/v/main.mp4?oh=1",
      posterUrl: "https://instagram.fcdn.test/p/cover.jpg",
      title: "Summer linen, three ways ☀️ — which is your pick?",
      durationSeconds: 27.4,
    });
  });

  it("uses the first video in a carousel", () => {
    const carousel = {
      code: "CAROUSEL01",
      media_type: 8,
      carousel_media: [
        { media_type: 1, image_versions2: { candidates: [{ url: "https://i/1.jpg" }] } },
        { media_type: 2, video_versions: [{ url: "https://v/2.mp4" }], image_versions2: { candidates: [{ url: "https://i/2.jpg" }] } },
      ],
    };
    expect(extractInstagramVideo(igPage(carousel), "CAROUSEL01")).toMatchObject({
      videoUrl: "https://v/2.mp4",
      posterUrl: "https://i/2.jpg",
    });
  });

  it("skips a light stub of the same post and uses the object with the video", () => {
    const stub = { code: "DRcloKUDRAd", __typename: "XDTMediaDict", caption: { text: "Stub caption" } };
    expect(extractInstagramVideo(igPage(igReel, [{ header: stub }]), "DRcloKUDRAd")).toMatchObject({
      videoUrl: "https://instagram.fcdn.test/v/main.mp4?oh=1",
    });
  });

  it("reads the embed page's nested contextJSON", () => {
    expect(extractInstagramVideo(igEmbedPage(igEmbedReel), "DXMVbNOEmWh")).toEqual({
      videoUrl: "https://instagram.fcdn.test/v/embed-360.mp4",
      posterUrl: "https://instagram.fcdn.test/p/embed-cover.jpg",
      title: "Website no one really talks about",
      durationSeconds: null,
    });
  });

  it("uses the first video in an embed-format carousel", () => {
    const sidecar = {
      __typename: "GraphSidecar",
      shortcode: "SIDECAR001",
      edge_sidecar_to_children: {
        edges: [
          { node: { __typename: "GraphImage", display_url: "https://i/1.jpg" } },
          { node: { __typename: "GraphVideo", video_url: "https://v/2.mp4", display_url: "https://i/2.jpg" } },
        ],
      },
    };
    expect(extractInstagramVideo(igEmbedPage(sidecar), "SIDECAR001")).toMatchObject({
      videoUrl: "https://v/2.mp4",
      posterUrl: "https://i/2.jpg",
    });
  });

  it("says when the post is a photo", () => {
    const photo = { code: "PHOTOPOST1", media_type: 1, image_versions2: { candidates: [{ url: "https://i/1.jpg" }] } };
    expect(extractInstagramVideo(igPage(photo), "PHOTOPOST1")).toEqual({ error: "That Instagram post is a photo, not a video." });
  });

  it("says when the page has no data for the post (private, login wall, removed)", () => {
    const result = extractInstagramVideo("<html><title>Instagram</title></html>", "DRcloKUDRAd");
    expect(result).toEqual({ error: expect.stringMatching(/didn't share this post/) });
  });

  it("titles from the first real caption line, shortened", () => {
    const long = { ...igReel, caption: { text: `${"Very long caption ".repeat(10)}end` } };
    const result = extractInstagramVideo(igPage(long), "DRcloKUDRAd");
    expect("title" in result && result.title?.length).toBe(80);
    expect("title" in result && result.title?.endsWith("…")).toBe(true);
    const none = { ...igReel, caption: null };
    expect(extractInstagramVideo(igPage(none), "DRcloKUDRAd")).toMatchObject({ title: null });
  });
});

describe("extractTiktokVideo", () => {
  it("prefers the unwatermarked playAddr", () => {
    expect(extractTiktokVideo(tiktokPage({ statusCode: 0, itemInfo: { itemStruct: tiktokItem } }))).toEqual({
      videoUrl: "https://v16-webapp.tiktok.test/play.mp4",
      posterUrl: "https://p16.tiktok.test/cover.jpg",
      title: "Packing our bestseller 📦 #smallbusiness",
      durationSeconds: 18,
    });
  });

  it("falls back to an H.264 stream, then any stream, then the watermarked download", () => {
    const streams = (video: object) =>
      extractTiktokVideo(tiktokPage({ statusCode: 0, itemInfo: { itemStruct: { video } } }));
    expect(
      streams({
        bitrateInfo: [
          { CodecType: "h265_hvc1", PlayAddr: { UrlList: ["https://h265"] } },
          { CodecType: "h264", PlayAddr: { UrlList: ["https://h264"] } },
        ],
      }),
    ).toMatchObject({ videoUrl: "https://h264" });
    expect(streams({ bitrateInfo: [{ CodecType: "h265", PlayAddr: { UrlList: ["https://h265"] } }] })).toMatchObject({
      videoUrl: "https://h265",
    });
    expect(streams({ downloadAddr: "https://wm" })).toMatchObject({ videoUrl: "https://wm" });
  });

  it("reads older pages' SIGI_STATE", () => {
    const html = `<script id="SIGI_STATE" type="application/json">${JSON.stringify({ ItemModule: { "7590": tiktokItem } })}</script>`;
    expect(extractTiktokVideo(html)).toMatchObject({ videoUrl: "https://v16-webapp.tiktok.test/play.mp4" });
  });

  it("explains private/removed videos and photo posts", () => {
    expect(extractTiktokVideo(tiktokPage({ statusCode: 10204 }))).toEqual({
      error: expect.stringMatching(/private or removed/),
    });
    expect(extractTiktokVideo("<html></html>")).toEqual({ error: expect.stringMatching(/didn't share/) });
    expect(
      extractTiktokVideo(tiktokPage({ statusCode: 0, itemInfo: { itemStruct: { imagePost: { images: [] } } } })),
    ).toEqual({ error: "That TikTok is a photo post, not a video." });
  });
});

function pageResponse(body: string, init: { status?: number; cookies?: string[] } = {}) {
  const headers = new Headers({ "content-type": "text/html" });
  for (const c of init.cookies ?? []) headers.append("set-cookie", c);
  return new Response(body, { status: init.status ?? 200, headers });
}

describe("resolveSocialVideo", () => {
  it("Instagram: fetches the canonical post page like a browser, and Cloudflare can fetch the file", async () => {
    const fetchMock = vi.fn().mockResolvedValue(pageResponse(igPage(igReel)));
    const video = await resolveSocialVideo(
      "instagram",
      "https://www.instagram.com/reel/DRcloKUDRAd/?igsh=abc",
      fetchMock as never,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.instagram.com/p/DRcloKUDRAd/");
    expect(init.headers["sec-fetch-mode"]).toBe("navigate");
    expect(video).toMatchObject({ platform: "instagram", videoUrl: "https://instagram.fcdn.test/v/main.mp4?oh=1" });
    expect(video.downloadHeaders).toBeNull();
  });

  it("TikTok: forwards the page's cookies and referer for the download", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      pageResponse(tiktokPage({ statusCode: 0, itemInfo: { itemStruct: tiktokItem } }), {
        cookies: ["tt_chain_token=abc; Path=/; Secure", "ttwid=1%7Cxyz; Domain=.tiktok.com; HttpOnly"],
      }),
    );
    const video = await resolveSocialVideo("tiktok", "https://vm.tiktok.com/ZMabc/", fetchMock as never);
    expect(fetchMock.mock.calls[0][1].redirect).toBe("follow");
    expect(video.downloadHeaders).toMatchObject({
      referer: "https://www.tiktok.com/",
      cookie: "tt_chain_token=abc; ttwid=1%7Cxyz",
    });
  });

  it.each([
    [404, /doesn't exist or was removed/],
    [429, /limiting requests/],
    [500, /didn't share/],
  ])("maps HTTP %i to a merchant message", async (status, message) => {
    const fetchMock = vi.fn().mockImplementation(async () => pageResponse("", { status }));
    await expect(
      resolveSocialVideo("instagram", "https://www.instagram.com/p/DRcloKUDRAd/", fetchMock as never),
    ).rejects.toThrow(message);
  });

  it("Instagram: falls back to the embed page when the post page is rate-limited", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageResponse("", { status: 429 }))
      .mockResolvedValueOnce(pageResponse(igEmbedPage(igEmbedReel)));
    const video = await resolveSocialVideo("instagram", "https://www.instagram.com/reel/DXMVbNOEmWh/", fetchMock as never);
    expect(fetchMock.mock.calls[1][0]).toBe("https://www.instagram.com/p/DXMVbNOEmWh/embed/captioned/");
    expect(fetchMock.mock.calls[1][1].headers["sec-fetch-dest"]).toBe("iframe");
    expect(video.videoUrl).toBe("https://instagram.fcdn.test/v/embed-360.mp4");
  });

  it("Instagram: tries the embed page when the post page has no data, and stops at a 404", async () => {
    const shellThenEmbed = vi
      .fn()
      .mockResolvedValueOnce(pageResponse("<html><title>Instagram</title></html>"))
      .mockResolvedValueOnce(pageResponse(igEmbedPage(igEmbedReel)));
    await expect(
      resolveSocialVideo("instagram", "https://www.instagram.com/reel/DXMVbNOEmWh/", shellThenEmbed as never),
    ).resolves.toMatchObject({ videoUrl: "https://instagram.fcdn.test/v/embed-360.mp4" });

    const notFound = vi.fn().mockResolvedValue(pageResponse("", { status: 404 }));
    await expect(
      resolveSocialVideo("instagram", "https://www.instagram.com/reel/DXMVbNOEmWh/", notFound as never),
    ).rejects.toThrow(/doesn't exist/);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("Instagram: a photo post on the first page is final", async () => {
    const photo = { code: "PHOTOPOST1", media_type: 1, image_versions2: { candidates: [{ url: "https://i/1.jpg" }] } };
    const fetchMock = vi.fn().mockResolvedValue(pageResponse(igPage(photo)));
    await expect(
      resolveSocialVideo("instagram", "https://www.instagram.com/p/PHOTOPOST1/", fetchMock as never),
    ).rejects.toThrow(/photo, not a video/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an unreachable platform", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(resolveSocialVideo("tiktok", "https://www.tiktok.com/@a/video/1", fetchMock as never)).rejects.toThrow(
      new SocialImportError("Couldn't reach TikTok. Try again in a minute."),
    );
  });
});

describe("downloadSocialVideo", () => {
  const resolved = {
    platform: "tiktok" as const,
    videoUrl: "https://v16.tiktok.test/play.mp4",
    posterUrl: null,
    title: null,
    durationSeconds: null,
    downloadHeaders: { cookie: "tt_chain_token=abc", referer: "https://www.tiktok.com/" },
  };

  it("sends the cookies and returns the video", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bytes", { headers: { "content-type": "video/mp4" } }));
    const response = await downloadSocialVideo(resolved, fetchMock as never);
    expect(await response.text()).toBe("bytes");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ cookie: "tt_chain_token=abc" });
  });

  it("refuses refusals, web pages and oversized files", async () => {
    const reply = (body: string, headers: Record<string, string>, status = 200) =>
      vi.fn().mockResolvedValue(new Response(body, { status, headers }));
    await expect(downloadSocialVideo(resolved, reply("", {}, 403) as never)).rejects.toThrow(/refused/);
    await expect(downloadSocialVideo(resolved, reply("<html>", { "content-type": "text/html" }) as never)).rejects.toThrow(
      /web page/,
    );
    await expect(
      downloadSocialVideo(
        resolved,
        reply("x", { "content-type": "video/mp4", "content-length": String(MAX_DOWNLOAD_BYTES + 1) }) as never,
      ),
    ).rejects.toThrow(/too large/);
  });
});
