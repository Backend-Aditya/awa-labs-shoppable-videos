// Every block decides on its own whether to render: published widget,
// target rule (all products / product handles / collections), page-type
// gating via template.name, and at least one playable reel.
import { describe, expect, it } from "vitest";
import { blockContext, BLOCK_METAFIELDS, makeProduct, makeReel, makeWidget } from "../support/storefront-fixtures.mjs";
import { renderDom } from "./helpers";

type Block = keyof typeof BLOCK_METAFIELDS;
const BLOCKS = Object.keys(BLOCK_METAFIELDS) as Block[];

// The marker element each block renders when visible.
const ROOT: Record<Block, string> = {
  "product-page-reels": "section.reelup-strip",
  "stacked-carousel": "section.reelup-deck",
  "insta-stories": "section.reelup-stories",
  "single-video": "section.reelup-feature",
  "add-to-cart-video": "div.reelup-atc",
  "shoppable-videos": "[data-reelup-pop]",
};

const shirt = makeProduct({ id: 5, handle: "linen-shirt", collections: ["summer", "shirts"] });
const reels = [makeReel({ id: 1, products: [shirt] }), makeReel({ id: 2 }), makeReel({ id: 3 })];

async function visible(block: Block, overrides: Parameters<typeof blockContext>[1] = {}) {
  const { $ } = await renderDom(block, blockContext(block, { reels, product: shirt, ...overrides }));
  return $(ROOT[block]) !== null;
}

describe.each(BLOCKS)("%s visibility", (block) => {
  it("renders when published for all products", async () => {
    expect(await visible(block)).toBe(true);
  });

  it("renders nothing when the widget is unpublished", async () => {
    expect(await visible(block, { widget: makeWidget({ published: false }) })).toBe(false);
  });

  it("renders nothing when there is no widget metafield at all", async () => {
    expect(await visible(block, { widget: null as unknown as object })).toBe(false);
  });

  describe("pageTypes gating (template.name)", () => {
    const widget = makeWidget({ pageTypes: ["index", "collection"] });
    it("hides on a template not in the list", async () => {
      expect(await visible(block, { widget, template: "product" })).toBe(false);
    });
    it("shows on a listed template", async () => {
      expect(await visible(block, { widget, template: "index" })).toBe(true);
    });
    it("an empty list means everywhere", async () => {
      expect(await visible(block, { widget: makeWidget({ pageTypes: [] }), template: "cart" })).toBe(true);
    });
  });

  describe("targetRule: handles", () => {
    it("shows on a targeted product", async () => {
      const widget = makeWidget({ targetRule: { type: "handles", handles: ["other", "linen-shirt"] } });
      expect(await visible(block, { widget })).toBe(true);
    });
    it("hides on other products", async () => {
      const widget = makeWidget({ targetRule: { type: "handles", handles: ["other"] } });
      expect(await visible(block, { widget })).toBe(false);
    });
    it("hides where there is no product (e.g. the home page)", async () => {
      const widget = makeWidget({ targetRule: { type: "handles", handles: ["linen-shirt"] } });
      expect(await visible(block, { widget, product: null, template: "index" })).toBe(false);
    });
  });

  describe("targetRule: collections", () => {
    it("shows when the product is in a targeted collection", async () => {
      const widget = makeWidget({ targetRule: { type: "collections", handles: ["shirts"] } });
      expect(await visible(block, { widget })).toBe(true);
    });
    it("hides when it is not", async () => {
      const widget = makeWidget({ targetRule: { type: "collections", handles: ["winter"] } });
      expect(await visible(block, { widget })).toBe(false);
    });
  });

  it("an unknown target rule type renders nothing", async () => {
    expect(await visible(block, { widget: makeWidget({ targetRule: { type: "bogus" } }) })).toBe(false);
  });

  it("renders nothing when no reel is published and playable", async () => {
    const unplayable = [makeReel({ id: 1, published: false }), makeReel({ id: 2, hls: "" })];
    expect(await visible(block, { reels: unplayable, reel: unplayable[0] })).toBe(false);
    expect(await visible(block, { reels: unplayable, reel: unplayable[1] })).toBe(false);
  });
});

describe("list blocks skip unplayable reels", () => {
  it.each(["product-page-reels", "stacked-carousel", "insta-stories"] as const)("%s", async (block) => {
    const list = [makeReel({ id: 1 }), makeReel({ id: 2, published: false }), makeReel({ id: 3, hls: "" }), makeReel({ id: 4 })];
    const { $$ } = await renderDom(block, blockContext(block, { reels: list, product: shirt }));
    expect($$("[data-reelup-trigger]").map((t) => t.dataset.reelId)).toEqual([
      "gid://shopify/Metaobject/1",
      "gid://shopify/Metaobject/4",
    ]);
  });
});

describe("device visibility class", () => {
  it.each(BLOCKS)("%s carries reelup-device--<setting>", async (block) => {
    const { $ } = await renderDom(block, blockContext(block, { reels, product: shirt, widget: makeWidget({ deviceVisibility: "mobile" }) }));
    expect($(ROOT[block])!.className).toContain("reelup-device--mobile");
  });
});
