// Per-block rendering details beyond visibility.
import { describe, expect, it } from "vitest";
import { blockContext, makeProduct, makeReel, makeWidget } from "../support/storefront-fixtures.mjs";
import { renderDom, visibleMarkup } from "./helpers";

const reels = (n: number, products: object[] = []) => Array.from({ length: n }, (_, i) => makeReel({ id: i + 1, products }));

describe("stacked-carousel", () => {
  it.each([1, 2])("a stack with %i reel(s) renders as a slider (no deck JS hooks)", async (n) => {
    const { $ } = await renderDom("stacked-carousel", blockContext("stacked-carousel", { reels: reels(n), widget: makeWidget({ style: { layoutMode: "stack" } }) }));
    const section = $("section.reelup-deck")!;
    expect(section.className).toContain("reelup-deck--carousel");
    expect(section.hasAttribute("data-reelup-deck")).toBe(false);
    expect($("[data-reelup-deck-dots]")).toBeNull();
  });

  it("3+ reels render the deck with one dot per card, arrows and a live status", async () => {
    const { $, $$ } = await renderDom("stacked-carousel", blockContext("stacked-carousel", { reels: reels(4) }));
    expect($("section")!.hasAttribute("data-reelup-deck")).toBe(true);
    expect($$("[data-reelup-deck-card]")).toHaveLength(4);
    expect($$("[data-reelup-deck-dots] span")).toHaveLength(4);
    expect($("[data-reelup-deck-prev]")!.getAttribute("aria-label")).toBe("Previous video");
    expect($("[data-reelup-deck-status]")!.getAttribute("aria-live")).toBe("polite");
  });

  it("pluralises the product count", async () => {
    const one = await renderDom("stacked-carousel", blockContext("stacked-carousel", { reels: reels(3, [makeProduct()]) }));
    expect(one.$(".reelup-deck__meta")!.textContent).toBe("1 product");
    const two = await renderDom("stacked-carousel", blockContext("stacked-carousel", { reels: reels(3, [makeProduct(), makeProduct({ id: 2 })]) }));
    expect(two.$(".reelup-deck__meta")!.textContent).toBe("2 products");
  });

  it("escapes reel titles in captions and aria-labels", async () => {
    const list = [makeReel({ id: 1, title: "<b>bold</b>" }), ...reels(2).map((r, i) => ({ ...r, system: { ...r.system, id: `x${i}` } }))];
    const { $, html } = await renderDom("stacked-carousel", blockContext("stacked-carousel", { reels: list }));
    expect($(".reelup-deck__title")!.textContent).toBe("<b>bold</b>");
    expect($(".reelup-trigger__button")!.getAttribute("aria-label")).toBe("Play video: <b>bold</b>");
    expect(visibleMarkup(html)).not.toContain("<b>bold</b>");
  });
});

describe("product-page-reels", () => {
  it("filmstrip: group + strip hooks, arrows only for 2+ reels in carousel layout", async () => {
    const two = await renderDom("product-page-reels", blockContext("product-page-reels", { reels: reels(2) }));
    expect(two.$("[data-reelup-group][data-reelup-strip]")).not.toBeNull();
    expect(two.$("[data-reelup-strip-prev]")).not.toBeNull();
    const one = await renderDom("product-page-reels", blockContext("product-page-reels", { reels: reels(1) }));
    expect(one.$("[data-reelup-strip-prev]")).toBeNull();
    const grid = await renderDom("product-page-reels", blockContext("product-page-reels", { reels: reels(2), widget: makeWidget({ style: { layoutMode: "grid" } }) }));
    expect(grid.$("section")!.className).toContain("reelup-strip--grid");
    expect(grid.$("[data-reelup-strip-prev]")).toBeNull();
  });

  it("heading, caption and lead product are escaped", async () => {
    const product = makeProduct({ id: 3, title: "<i>Tee</i>" });
    const { $, html } = await renderDom(
      "product-page-reels",
      blockContext("product-page-reels", { reels: [makeReel({ title: "<u>x</u>", products: [product] })], widget: makeWidget({ style: { heading: "<h1>Hi</h1>" } }) }),
    );
    expect($(".reelup-heading")!.textContent).toBe("<h1>Hi</h1>");
    expect($(".reelup-strip__caption")!.textContent).toBe("<u>x</u>");
    expect($(".reelup-strip__product-title")!.textContent).toBe("<i>Tee</i>");
    expect($(".reelup-strip__product-price")!.textContent).toBe("$25.00");
    expect(visibleMarkup(html)).not.toMatch(/<(h1|u|i)>/);
  });

  it("style variables reflect the widget style", async () => {
    const { $ } = await renderDom(
      "product-page-reels",
      blockContext("product-page-reels", { reels: reels(1), widget: makeWidget({ style: { cornerStyle: "sharp", triggerSize: 240, accentColor: "#ff0000" } }) }),
    );
    const style = $("section")!.getAttribute("style")!;
    expect(style).toContain("--ru-radius: 0px");
    expect(style).toContain("--ru-card-width: 240px");
    expect(style).toContain("--ru-accent: #ff0000");
  });
});

describe("insta-stories", () => {
  it("story group hook; gradient ring by default, solid when asked", async () => {
    const gradient = await renderDom("insta-stories", blockContext("insta-stories", { reels: reels(2), widget: makeWidget({ style: { accentColor: "#111111", accentSecondaryColor: "#222222" } }) }));
    expect(gradient.$("[data-reelup-story-group]")).not.toBeNull();
    expect(gradient.$("section")!.getAttribute("style")).toContain("--ru-ring-end: #222222");
    const solid = await renderDom("insta-stories", blockContext("insta-stories", { reels: reels(2), widget: makeWidget({ style: { accentColor: "#111111", ringStyle: "solid" } }) }));
    expect(solid.$("section")!.getAttribute("style")).toContain("--ru-ring-end: #111111");
  });
});

describe("single-video", () => {
  it("split layout lists products inline with a cart status scoped to the reel", async () => {
    const reel = makeReel({ id: 8, products: [makeProduct(), makeProduct({ id: 2 })] });
    const { $, $$ } = await renderDom("single-video", blockContext("single-video", { reel }));
    expect($("section")!.className).toContain("reelup-feature--split");
    const body = $(".reelup-feature__body")!;
    expect(body.dataset.reelupReelId).toBe("gid://shopify/Metaobject/8");
    expect($$(".reelup-feature__products [data-reelup-product]")).toHaveLength(2);
    expect(body.querySelector("[data-reelup-cart-status]")).not.toBeNull();
  });

  it("falls back to the poster layout when the reel has no products", async () => {
    const { $ } = await renderDom("single-video", blockContext("single-video", { reel: makeReel(), widget: makeWidget({ style: { singleLayout: "split" } }) }));
    expect($("section")!.className).toContain("reelup-feature--poster");
    expect($(".reelup-feature__body")).toBeNull();
  });
});

describe("add-to-cart-video", () => {
  it("label falls back to the locale and length is m:ss", async () => {
    const { $ } = await renderDom("add-to-cart-video", blockContext("add-to-cart-video", { reel: makeReel({ title: "How it fits", duration: 95 }) }));
    expect($(".reelup-atc__label")!.textContent).toBe("Watch video");
    expect($(".reelup-atc__meta")!.textContent).toMatch(/^How it fits.*1:35$/);
  });

  it("custom label is escaped", async () => {
    const { $ } = await renderDom("add-to-cart-video", blockContext("add-to-cart-video", { reel: makeReel(), widget: makeWidget({ style: { watchLabel: "<b>See</b>" } }) }));
    expect($(".reelup-atc__label")!.textContent).toBe("<b>See</b>");
  });
});

describe("shoppable-videos app embed", () => {
  it("loads every storefront script and publishes a parseable [data-reelup-config]", async () => {
    const { $, $$ } = await renderDom("shoppable-videos", blockContext("shoppable-videos", { widget: makeWidget({ published: false }) }));
    expect($$("script[src]").map((s) => s.getAttribute("src"))).toEqual([
      "/assets/reel-hls.js",
      "/assets/reel-lightbox.js",
      "/assets/reel-story.js",
      "/assets/reel-trigger.js",
      "/assets/reel-pop.js",
    ]);
    const config = JSON.parse($("[data-reelup-config]")!.textContent!);
    expect(config).toMatchObject({
      cartUrl: "/cart",
      cartAddUrl: "/cart/add.js",
      cartJsUrl: "/cart.js",
      recommendationsUrl: "/recommendations/products.json",
      currency: "USD",
      locale: "en",
      viewerTheme: "dark",
    });
    expect(config.labels).toMatchObject({ shop: "Shop this video", of: "__CURRENT__ of __TOTAL__", addFailed: "Couldn't add to cart. Try again." });
    expect(Object.values(config.labels).join()).not.toContain("translation missing");
  });

  it("brand kit becomes CSS variables and viewer theme", async () => {
    const brand = { accentColor: "#123456", buttonColor: "#abcdef", viewerTheme: "light", fontFamily: "system" };
    const { $, $$ } = await renderDom("shoppable-videos", blockContext("shoppable-videos", { widget: makeWidget({ published: false }), brand }));
    const css = $$("style").map((s) => s.textContent).join();
    expect(css).toContain("--ru-brand-accent: #123456");
    expect(css).toContain("--ru-brand-cta: #abcdef");
    expect(css).toContain("font-family");
    expect(JSON.parse($("[data-reelup-config]")!.textContent!).viewerTheme).toBe("light");
  });

  it("floating video: hidden until JS reveals it, carries delay, block id and position", async () => {
    const { $ } = await renderDom(
      "shoppable-videos",
      blockContext("shoppable-videos", {
        reel: makeReel({ id: 4 }),
        blockId: "embed-9",
        widget: makeWidget({ style: { popDelay: 3, position: "top_left", popShape: "circle", bubbleLabel: "Watch <me>" } }),
      }),
    );
    const pop = $("[data-reelup-pop]")!;
    expect(pop.hidden).toBe(true);
    expect(pop.dataset).toMatchObject({ reelId: "gid://shopify/Metaobject/4", blockId: "embed-9", delay: "3" });
    expect(pop.className).toContain("reelup-pop--top-left");
    expect(pop.className).toContain("reelup-pop--circle");
    expect($("[data-reelup-pop-dismiss]")).not.toBeNull();
    expect($("[data-reelup-pop-open]")!.textContent).toBe("Watch <me>");
  });
});
