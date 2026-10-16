// Section blocks work without the app embed: each renders the shared config
// and posters are sized for Cloudflare Stream.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { blockContext, makeReel, makeWidget } from "../support/storefront-fixtures.mjs";
import { EXTENSION_DIR } from "../support/liquid-engine.mjs";
import { renderDom } from "./helpers";

const SECTION_BLOCKS = ["product-page-reels", "stacked-carousel", "insta-stories", "single-video", "add-to-cart-video"] as const;
const reels = [makeReel({ id: 1 }), makeReel({ id: 2 }), makeReel({ id: 3 })];

describe.each(SECTION_BLOCKS)("%s without the app embed", (block) => {
  it("renders the shared [data-reelup-config] when visible", async () => {
    const { $ } = await renderDom(block, blockContext(block, { reels }));
    const config = JSON.parse($("[data-reelup-config]")!.textContent!);
    expect(config).toMatchObject({ cartAddUrl: "/cart/add.js", moneyFormat: "${{amount}}" });
    expect(Object.values(config.labels).join()).not.toContain("translation missing");
  });

  it("declares reel-loader.js as its schema javascript", () => {
    const source = readFileSync(path.join(EXTENSION_DIR, "blocks", `${block}.liquid`), "utf8");
    const schema = JSON.parse(source.match(/{% schema %}([\s\S]*?){% endschema %}/)![1]);
    expect(schema.javascript).toBe("reel-loader.js");
  });
});

describe("collection-page targeting", () => {
  it.each(SECTION_BLOCKS.filter((b) => b !== "add-to-cart-video" && b !== "single-video"))(
    "%s shows on a targeted collection page",
    async (block) => {
      const widget = makeWidget({ targetRule: { type: "collections", handles: ["summer"] } });
      const ctx = { ...blockContext(block, { reels, widget, product: null, template: "collection" }), collection: { handle: "summer" } };
      const { $ } = await renderDom(block, ctx);
      expect($("[data-reelup-trigger]")).not.toBeNull();
    },
  );
});

describe("reel-poster", () => {
  const poster = (url: string, extra: object = {}) =>
    renderDom("reel-poster", { url, height: 800, width_attr: 360, height_attr: 640, ...extra }).then(({ $ }) => $("img")!);

  it("asks Cloudflare Stream for a sized thumbnail with a srcset", async () => {
    const img = await poster("https://customer-x.cloudflarestream.com/abc/thumbnails/thumbnail.jpg?time=1s", {
      srcset_heights: "480,960",
      sizes: "50vw",
      eager: true,
      priority: true,
    });
    expect(img.getAttribute("src")).toBe("https://customer-x.cloudflarestream.com/abc/thumbnails/thumbnail.jpg?time=1s&height=800");
    expect(img.getAttribute("srcset")).toContain("height=480 270w");
    expect(img.getAttribute("srcset")).toContain("height=960 540w");
    expect(img.getAttribute("sizes")).toBe("50vw");
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("fetchpriority")).toBe("high");
  });

  it("leaves other URLs untouched and lazy", async () => {
    const img = await poster("https://cdn.test/p.jpg", { srcset_heights: "480" });
    expect(img.getAttribute("src")).toBe("https://cdn.test/p.jpg");
    expect(img.hasAttribute("srcset")).toBe(false);
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("escapes the URL", async () => {
    const img = await poster('https://cdn.test/p.jpg?"><script>');
    expect(img.getAttribute("src")).toBe('https://cdn.test/p.jpg?"><script>');
    expect(img.ownerDocument.querySelector("script")).toBeNull();
  });
});
