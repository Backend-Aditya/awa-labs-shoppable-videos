// Per-block rendering details beyond visibility.
import { describe, expect, it } from "vitest";
import { blockContext, makeProduct, makeReel, makeWidget } from "../support/storefront-fixtures.mjs";
import { REEL_NAMESPACE } from "../support/liquid-engine.mjs";
import { renderDom, visibleMarkup } from "./helpers";

const reels = (n: number, products: object[] = []) => Array.from({ length: n }, (_, i) => makeReel({ id: i + 1, products }));

describe("stacked-carousel", () => {
  it.each([1, 2])("a stack with %i reel(s) renders as a slider (no deck JS hooks)", async (n) => {
    const { $ } = await renderDom("stacked-carousel", blockContext("stacked-carousel", { reels: reels(n), widget: makeWidget({ style: { layoutMode: "stack" } }) }));
    const section = $("section.awa-sv-deck")!;
    expect(section.className).toContain("awa-sv-deck--carousel");
    expect(section.hasAttribute("data-awa-sv-deck")).toBe(false);
    expect($("[data-awa-sv-deck-dots]")).toBeNull();
  });

  it("3+ reels render the deck with one dot per card, arrows and a live status", async () => {
    const { $, $$ } = await renderDom("stacked-carousel", blockContext("stacked-carousel", { reels: reels(4) }));
    expect($("section")!.hasAttribute("data-awa-sv-deck")).toBe(true);
    expect($$("[data-awa-sv-deck-card]")).toHaveLength(4);
    expect($$("[data-awa-sv-deck-dots] span")).toHaveLength(4);
    expect($("[data-awa-sv-deck-prev]")!.getAttribute("aria-label")).toBe("Previous video");
    expect($("[data-awa-sv-deck-status]")!.getAttribute("aria-live")).toBe("polite");
  });

  it("pluralises the product count", async () => {
    const one = await renderDom("stacked-carousel", blockContext("stacked-carousel", { reels: reels(3, [makeProduct()]) }));
    expect(one.$(".awa-sv-deck__meta")!.textContent).toBe("1 product");
    const two = await renderDom("stacked-carousel", blockContext("stacked-carousel", { reels: reels(3, [makeProduct(), makeProduct({ id: 2 })]) }));
    expect(two.$(".awa-sv-deck__meta")!.textContent).toBe("2 products");
  });

  it("escapes reel titles in captions and aria-labels", async () => {
    const list = [makeReel({ id: 1, title: "<b>bold</b>" }), ...reels(2).map((r, i) => ({ ...r, system: { ...r.system, id: `x${i}` } }))];
    const { $, html } = await renderDom("stacked-carousel", blockContext("stacked-carousel", { reels: list }));
    expect($(".awa-sv-deck__title")!.textContent).toBe("<b>bold</b>");
    expect($(".awa-sv-trigger__button")!.getAttribute("aria-label")).toBe("Play video: <b>bold</b>");
    expect(visibleMarkup(html)).not.toContain("<b>bold</b>");
  });
});

describe("stacked-carousel card templates", () => {
  const sale = () => makeProduct({ id: 7, title: "<i>Chair</i>", variants: [{ id: 700, price: 1500, compare_at_price: 3600 }] });
  const render = (style: object, products: object[] = [sale()]) =>
    renderDom("stacked-carousel", blockContext("stacked-carousel", { reels: reels(3, products), widget: makeWidget({ style }) }));

  it("defaults to the original title caption, play button and no badge", async () => {
    const { $ } = await render({});
    expect($("section")!.className).toContain("awa-sv-deck--card-title");
    expect($(".awa-sv-deck__caption")).not.toBeNull();
    expect($(".awa-sv-deck__play")).not.toBeNull();
    expect($(".awa-sv-deck__badge")).toBeNull();
    expect($(".awa-sv-deck__info")).toBeNull();
  });

  it("overlay puts the escaped lead product, price and compare-at on the poster", async () => {
    const { $, html } = await render({ cardTemplate: "overlay", showPlayIcon: false });
    const overlay = $(".awa-sv-deck__poster .awa-sv-deck__overlay")!;
    expect(overlay.querySelector(".awa-sv-deck__product-title")!.textContent).toBe("<i>Chair</i>");
    expect(overlay.querySelector(".awa-sv-deck__product-price s")!.textContent).toBe("$36.00");
    expect($(".awa-sv-deck__caption")).toBeNull();
    expect($(".awa-sv-deck__play")).toBeNull();
    expect(visibleMarkup(html)).not.toContain("<i>Chair</i>");
  });

  it.each([
    ["classic", false],
    ["modern", true],
    ["vibrant", true],
  ])("%s puts the product under the video (shop button: %s)", async (cardTemplate, button) => {
    const { $ } = await render({ cardTemplate });
    const info = $(".awa-sv-deck__info[data-awa-sv-open]")!;
    expect(info.closest("[data-awa-sv-trigger]")).not.toBeNull();
    expect(info.querySelector(".awa-sv-deck__product-title")!.textContent).toBe("<i>Chair</i>");
    expect(Boolean(info.querySelector(".awa-sv-deck__shop"))).toBe(button);
    expect(Boolean(info.querySelector(".awa-sv-deck__thumb"))).toBe(cardTemplate !== "modern");
  });

  it("discount ribbon shows the rounded saving, only when on and on sale", async () => {
    const on = await render({ showCardBadge: true, badgeColor: "#123456" });
    expect(on.$(".awa-sv-deck__badge")!.textContent).toBe("58% OFF");
    expect(on.$("section")!.getAttribute("style")).toContain("--awa-sv-card-badge: #123456");
    const full = await render({ showCardBadge: true }, [makeProduct()]);
    expect(full.$(".awa-sv-deck__badge")).toBeNull();
  });

  it("eyebrow, heading and subheading render escaped in a header", async () => {
    const { $ } = await render({ eyebrow: "Shoppable <b>reels</b>", heading: "See it", subheading: "Tap any reel" });
    expect($(".awa-sv-deck__header .awa-sv-deck__eyebrow")!.textContent).toBe("Shoppable <b>reels</b>");
    expect($(".awa-sv-deck__header .awa-sv-heading")!.textContent).toBe("See it");
    expect($(".awa-sv-deck__header .awa-sv-deck__subheading")!.textContent).toBe("Tap any reel");
  });

  it("viewer settings: details and big images on by default, off when chosen", async () => {
    const on = await render({});
    const trigger = on.$("[data-awa-sv-trigger]")!;
    expect(trigger.getAttribute("data-product-details")).toBe("true");
    expect(trigger.getAttribute("data-product-image-size")).toBe("large");
    expect(trigger.getAttribute("data-show-description")).toBe("true");
    const off = await render({ productDetails: false, productImageSize: "compact", showDescription: false });
    const t2 = off.$("[data-awa-sv-trigger]")!;
    expect(t2.getAttribute("data-product-details")).toBe("false");
    expect(t2.getAttribute("data-product-image-size")).toBe("compact");
    expect(t2.getAttribute("data-show-description")).toBe("false");
  });

  it("product rows carry their locale-aware URL for the details view", async () => {
    const { $ } = await render({});
    const tpl = $("template[data-awa-sv-products]") as HTMLTemplateElement;
    const card = tpl.content.querySelector("[data-awa-sv-product]")!;
    expect(card.getAttribute("data-product-url")).toBe("/products/product-7");
    expect(card.querySelector("img")!.getAttribute("width")).toBe("200");
  });

  it("large images make each product a tile: no variant picker or add button, a Shop now link", async () => {
    const multi = makeProduct({ id: 9, variants: [{ id: 901, title: "Black" }, { id: 902, title: "Teak" }] });
    const { $ } = await render({ productImageSize: "large", ctaLabel: "Buy it" }, [multi]);
    const card = ($("template[data-awa-sv-products]") as HTMLTemplateElement).content.querySelector("[data-awa-sv-product]")!;
    expect(card.classList.contains("awa-sv-product--tile")).toBe(true);
    expect(card.querySelector("select")).toBeNull();
    expect(card.querySelector("[data-awa-sv-add-to-cart]")).toBeNull();
    const shop = card.querySelector("[data-awa-sv-shop]")!;
    expect(shop.textContent!.trim()).toBe("Shop now");
    expect(shop.getAttribute("href")).toBe("/products/product-9");
    expect(shop.getAttribute("data-add-label")).toBe("Buy it");
    const compact = await render({ productImageSize: "compact" }, [multi]);
    const row = (compact.$("template[data-awa-sv-products]") as HTMLTemplateElement).content.querySelector("[data-awa-sv-product]")!;
    expect(row.querySelector("select")).not.toBeNull();
    expect(row.querySelector("[data-awa-sv-add-to-cart]")).not.toBeNull();
  });
});

describe("product-page-reels", () => {
  it("filmstrip: group + strip hooks, arrows only for 2+ reels in carousel layout", async () => {
    const two = await renderDom("product-page-reels", blockContext("product-page-reels", { reels: reels(2) }));
    expect(two.$("[data-awa-sv-group][data-awa-sv-strip]")).not.toBeNull();
    expect(two.$("[data-awa-sv-strip-prev]")).not.toBeNull();
    const one = await renderDom("product-page-reels", blockContext("product-page-reels", { reels: reels(1) }));
    expect(one.$("[data-awa-sv-strip-prev]")).toBeNull();
    const grid = await renderDom("product-page-reels", blockContext("product-page-reels", { reels: reels(2), widget: makeWidget({ style: { layoutMode: "grid" } }) }));
    expect(grid.$("section")!.className).toContain("awa-sv-strip--grid");
    expect(grid.$("[data-awa-sv-strip-prev]")).toBeNull();
  });

  it("heading, caption and lead product are escaped", async () => {
    const product = makeProduct({ id: 3, title: "<i>Tee</i>" });
    const { $, html } = await renderDom(
      "product-page-reels",
      blockContext("product-page-reels", { reels: [makeReel({ title: "<u>x</u>", products: [product] })], widget: makeWidget({ style: { heading: "<h1>Hi</h1>" } }) }),
    );
    expect($(".awa-sv-heading")!.textContent).toBe("<h1>Hi</h1>");
    expect($(".awa-sv-strip__caption")!.textContent).toBe("<u>x</u>");
    expect($(".awa-sv-strip__product-title")!.textContent).toBe("<i>Tee</i>");
    expect($(".awa-sv-strip__product-price")!.textContent).toBe("$25.00");
    expect(visibleMarkup(html)).not.toMatch(/<(h1|u|i)>/);
  });

  it("style variables reflect the widget style", async () => {
    const { $ } = await renderDom(
      "product-page-reels",
      blockContext("product-page-reels", { reels: reels(1), widget: makeWidget({ style: { cornerStyle: "sharp", triggerSize: 240, accentColor: "#ff0000" } }) }),
    );
    const style = $("section")!.getAttribute("style")!;
    expect(style).toContain("--awa-sv-radius: 0px");
    expect(style).toContain("--awa-sv-card-width: 240px");
    expect(style).toContain("--awa-sv-accent: #ff0000");
  });
});

describe("insta-stories", () => {
  it("story group hook; gradient ring by default, solid when asked", async () => {
    const gradient = await renderDom("insta-stories", blockContext("insta-stories", { reels: reels(2), widget: makeWidget({ style: { accentColor: "#111111", accentSecondaryColor: "#222222" } }) }));
    expect(gradient.$("[data-awa-sv-story-group]")).not.toBeNull();
    expect(gradient.$("section")!.getAttribute("style")).toContain("--awa-sv-ring-end: #222222");
    const solid = await renderDom("insta-stories", blockContext("insta-stories", { reels: reels(2), widget: makeWidget({ style: { accentColor: "#111111", ringStyle: "solid" } }) }));
    expect(solid.$("section")!.getAttribute("style")).toContain("--awa-sv-ring-end: #111111");
  });
});

describe("single-video", () => {
  it("split layout lists products inline with a cart status scoped to the reel", async () => {
    const reel = makeReel({ id: 8, products: [makeProduct(), makeProduct({ id: 2 })] });
    const { $, $$ } = await renderDom("single-video", blockContext("single-video", { reel }));
    expect($("section")!.className).toContain("awa-sv-feature--split");
    const body = $(".awa-sv-feature__body")!;
    expect(body.dataset.awaSvReelId).toBe("gid://shopify/Metaobject/8");
    expect($$(".awa-sv-feature__products [data-awa-sv-product]")).toHaveLength(2);
    expect(body.querySelector("[data-awa-sv-cart-status]")).not.toBeNull();
  });

  it("falls back to the poster layout when the reel has no products", async () => {
    const { $ } = await renderDom("single-video", blockContext("single-video", { reel: makeReel(), widget: makeWidget({ style: { singleLayout: "split" } }) }));
    expect($("section")!.className).toContain("awa-sv-feature--poster");
    expect($(".awa-sv-feature__body")).toBeNull();
  });
});

describe("add-to-cart-video", () => {
  it("label falls back to the locale and length is m:ss", async () => {
    const { $ } = await renderDom("add-to-cart-video", blockContext("add-to-cart-video", { reel: makeReel({ title: "How it fits", duration: 95 }) }));
    expect($(".awa-sv-atc__label")!.textContent).toBe("Watch video");
    expect($(".awa-sv-atc__meta")!.textContent).toMatch(/^How it fits.*1:35$/);
  });

  it("custom label is escaped", async () => {
    const { $ } = await renderDom("add-to-cart-video", blockContext("add-to-cart-video", { reel: makeReel(), widget: makeWidget({ style: { watchLabel: "<b>See</b>" } }) }));
    expect($(".awa-sv-atc__label")!.textContent).toBe("<b>See</b>");
  });
});

describe("shoppable-videos app embed", () => {
  it("adds only the loader (no runtime, no stylesheets) and publishes a parseable [data-awa-sv-config]", async () => {
    const { $, $$ } = await renderDom("shoppable-videos", blockContext("shoppable-videos", { widget: makeWidget({ published: false }) }));
    expect($$("script[src]").map((s) => s.getAttribute("src"))).toEqual(["/assets/reel-loader.js"]);
    expect($$("link[rel=stylesheet]")).toHaveLength(0);
    const config = JSON.parse($("[data-awa-sv-config]")!.textContent!);
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

  it("publishes the merchant's tracking integrations (null until connected)", async () => {
    const off = await renderDom("shoppable-videos", blockContext("shoppable-videos", { widget: makeWidget({ published: false }) }));
    expect(JSON.parse(off.$("[data-awa-sv-config]")!.textContent!).tracking).toBeNull();

    const ctx = blockContext("shoppable-videos", { widget: makeWidget({ published: false }) });
    const tracking = { shopifyEvents: true, ga4: true, clarityId: "abc123xyz" };
    (ctx.shop.metafields[REEL_NAMESPACE] as Record<string, unknown>).tracking = { value: tracking };
    const on = await renderDom("shoppable-videos", ctx);
    expect(JSON.parse(on.$("[data-awa-sv-config]")!.textContent!).tracking).toEqual(tracking);
  });

  it("brand kit becomes CSS variables and viewer theme", async () => {
    const brand = { accentColor: "#123456", buttonColor: "#abcdef", viewerTheme: "light", fontFamily: "system" };
    const { $, $$ } = await renderDom("shoppable-videos", blockContext("shoppable-videos", { widget: makeWidget({ published: false }), brand }));
    const css = $$("style").map((s) => s.textContent).join();
    expect(css).toContain("--awa-sv-brand-accent: #123456");
    expect(css).toContain("--awa-sv-brand-cta: #abcdef");
    expect(css).toContain("font-family");
    expect(JSON.parse($("[data-awa-sv-config]")!.textContent!).viewerTheme).toBe("light");
  });

  it("floating video: hidden until JS reveals it, carries delay, block id and position, brings its stylesheet", async () => {
    const { $, $$ } = await renderDom(
      "shoppable-videos",
      blockContext("shoppable-videos", {
        reel: makeReel({ id: 4 }),
        blockId: "embed-9",
        widget: makeWidget({ style: { popDelay: 3, position: "top_left", popShape: "circle", bubbleLabel: "Watch <me>" } }),
      }),
    );
    const pop = $("[data-awa-sv-pop]")!;
    expect(pop.hidden).toBe(true);
    expect(pop.dataset).toMatchObject({ reelId: "gid://shopify/Metaobject/4", blockId: "embed-9", delay: "3" });
    expect(pop.className).toContain("awa-sv-pop--top-left");
    expect(pop.className).toContain("awa-sv-pop--circle");
    expect($("[data-awa-sv-pop-dismiss]")).not.toBeNull();
    expect($("[data-awa-sv-pop-open]")!.textContent).toBe("Watch <me>");
    expect($$("link[rel=stylesheet]").map((l) => l.getAttribute("href"))).toEqual(["/assets/reel-widgets.css"]);
  });
});
