// snippets/reel-trigger.liquid (the data-attribute contract with the
// storefront JS), reel-duration and reel-video-schema.
import { describe, expect, it } from "vitest";
import { makeProduct, makeReel } from "../support/storefront-fixtures.mjs";
import { colorBrightness, shiftLightness } from "../support/liquid-engine.mjs";
import { renderDom } from "./helpers";

const INNER = '<button type="button" class="reelup-trigger__button">Play</button>';
const trigger = async (reel: object, style: object = {}, extra: object = {}) => {
  const { $ } = await renderDom("reel-trigger", { reel, style, inner: INNER, muted_default: true, ...extra });
  return $("[data-reelup-trigger]")!;
};

describe("reel-trigger data attributes", () => {
  it("defaults", async () => {
    const t = await trigger(makeReel({ id: 9, products: [makeProduct()] }));
    expect(t.dataset).toMatchObject({
      reelId: "gid://shopify/Metaobject/9",
      hlsSrc: "https://customer-test.cloudflarestream.com/9/manifest/video.m3u8",
      posterUrl: "https://cdn.test/posters/9.jpg",
      title: "Reel 9",
      ctaStyle: "pill",
      showTitle: "true",
      tagRevealMode: "always",
      mutedDefault: "true",
      loop: "false",
      playTrigger: "click",
      autoplayScroll: "false",
      storyDuration: "15000",
      productCount: "1",
      linkUrl: "",
      linkLabel: "",
      showShare: "true",
      showRecommendations: "true",
    });
    expect(t.querySelector(".reelup-trigger__button")).not.toBeNull();
    expect(t.querySelector("template[data-reelup-products]")).not.toBeNull();
  });

  it("no tagged products → no product template", async () => {
    const t = await trigger(makeReel());
    expect(t.querySelector("template")).toBeNull();
    expect(t.dataset.productCount).toBe("0");
  });

  it("merchant style overrides", async () => {
    const t = await trigger(makeReel(), {
      mutedDefault: false,
      showTitleOverlay: false,
      autoplayOnScroll: true,
      loop: true,
      ctaStyle: "square",
      tagRevealMode: "tap",
      playTrigger: "hover",
      storyDuration: 7,
      showShare: false,
      showRecommendations: false,
    });
    expect(t.dataset).toMatchObject({
      mutedDefault: "false",
      showTitle: "false",
      autoplayScroll: "true",
      loop: "true",
      ctaStyle: "square",
      tagRevealMode: "tap",
      playTrigger: "hover",
      storyDuration: "7000",
      showShare: "false",
      showRecommendations: "false",
    });
  });

  it("muted_default / autoplay_default / autoplay_preview fallbacks", async () => {
    expect((await trigger(makeReel(), {}, { muted_default: false })).dataset.mutedDefault).toBe("false");
    expect((await trigger(makeReel(), {}, { autoplay_default: true })).dataset.autoplayScroll).toBe("true");
    expect((await trigger(makeReel(), { autoplayOnScroll: false }, { autoplay_default: true })).dataset.autoplayScroll).toBe("false");
    expect((await trigger(makeReel(), { autoplayOnScroll: false }, { autoplay_preview: true })).dataset.autoplayScroll).toBe("true");
  });

  it("CTA hover: darker for light colors, lighter for dark ones, empty without a color", async () => {
    expect((await trigger(makeReel(), { ctaColor: "#ffffff" })).dataset.ctaHoverColor).toBe(shiftLightness("#ffffff", -10));
    expect((await trigger(makeReel(), { ctaColor: "#141414" })).dataset.ctaHoverColor).toBe(shiftLightness("#141414", 12));
    expect((await trigger(makeReel(), {})).dataset.ctaHoverColor).toBe("");
    expect(colorBrightness("#ffffff")).toBeGreaterThan(150);
  });

  it("link button attributes are present and escaped", async () => {
    const reel = makeReel({ ctaUrl: 'https://shop.test/a?x=1&y="2"', ctaLabel: `Shop <the> "look"` });
    const { html, $ } = await renderDom("reel-trigger", { reel, style: {}, inner: INNER, muted_default: true });
    const t = $("[data-reelup-trigger]")!;
    expect(t.dataset.linkUrl).toBe('https://shop.test/a?x=1&y="2"');
    expect(t.dataset.linkLabel).toBe(`Shop <the> "look"`);
    expect(html).not.toContain("<the>");
  });

  it("reel title and URLs are escaped into attributes", async () => {
    const reel = makeReel({ title: `"><script>alert(1)</script>`, poster: 'https://cdn.test/p.jpg?"x' });
    const { html, $ } = await renderDom("reel-trigger", { reel, style: {}, inner: INNER, muted_default: true });
    expect($("[data-reelup-trigger]")!.dataset.title).toBe(`"><script>alert(1)</script>`);
    expect($("script")).toBeNull();
    expect(html).not.toContain("<script>");
  });
});

describe("reel-duration", () => {
  it.each([
    [42, "0:42"],
    [65, "1:05"],
    [125.4, "2:05"],
    [600, "10:00"],
  ])("%s seconds → %s", async (seconds, text) => {
    const { $ } = await renderDom("reel-duration", { reel: makeReel({ duration: seconds }) });
    expect($(".reelup-chip")!.textContent).toBe(`Length${text}`);
  });

  it("renders nothing without a duration", async () => {
    const { html } = await renderDom("reel-duration", { reel: makeReel({ duration: null }) });
    expect(html.trim()).toBe("");
  });

  it("optional play glyph", async () => {
    const { $ } = await renderDom("reel-duration", { reel: makeReel(), icon: true });
    expect($(".reelup-chip svg")).not.toBeNull();
  });
});

describe("reel-video-schema", () => {
  it("emits valid VideoObject JSON-LD and a preconnect to the Stream origin", async () => {
    const { $ } = await renderDom("reel-video-schema", { reel: makeReel({ id: 5, title: "Fit check" }) });
    expect($("link[rel=preconnect]")!.getAttribute("href")).toBe("https://customer-test.cloudflarestream.com");
    const data = JSON.parse($("script[type='application/ld+json']")!.textContent!);
    expect(data).toMatchObject({
      "@type": "VideoObject",
      name: "Fit check",
      description: "Fit check",
      contentUrl: "https://customer-test.cloudflarestream.com/5/manifest/video.m3u8",
      thumbnailUrl: ["https://cdn.test/posters/5.jpg"],
      duration: "PT42S",
      uploadDate: "2026-10-01T10:00:00Z",
    });
  });

  it("JSON stays parseable with quotes in the title; optional fields drop out", async () => {
    const { $ } = await renderDom("reel-video-schema", { reel: makeReel({ title: 'Say "hi"', poster: null, duration: null }) });
    const data = JSON.parse($("script[type='application/ld+json']")!.textContent!);
    expect(data.name).toBe('Say "hi"');
    expect(data).not.toHaveProperty("thumbnailUrl");
    expect(data).not.toHaveProperty("duration");
  });
});
