// reel-loader.js: blocks are self-sufficient when the app embed is off.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeReel } from "../support/storefront-fixtures.mjs";
import { mount, renderBlock, resetPage } from "./harness";

const LOADER_SRC = "https://cdn.shopify.test/extensions/abc/assets/reel-loader.js";

beforeEach(() => {
  resetPage();
  Object.defineProperty(document, "currentScript", { configurable: true, get: () => ({ src: LOADER_SRC }) });
});
afterEach(() => {
  delete (document as unknown as Record<string, unknown>).currentScript;
});

const injected = () =>
  Array.from(document.head.querySelectorAll<HTMLScriptElement>("script[data-reelup-loader]")).map((s) => [s.src, s.async]);

describe("reel-loader", () => {
  it("embed OFF: injects the runtime in order (non-async) plus the viewer stylesheet", async () => {
    await mount(await renderBlock("product-page-reels", { reels: [makeReel()] }), ["loader"]);
    expect(injected()).toEqual(
      ["reel-hls.js", "reel-lightbox.js", "reel-story.js", "reel-trigger.js"].map((f) => [LOADER_SRC.replace("reel-loader.js", f), false]),
    );
    expect(document.head.querySelector<HTMLLinkElement>('link[href$="reel-lightbox.css"]')!.rel).toBe("stylesheet");
  });

  it("embed ON: does nothing when the embed's scripts are on the page", async () => {
    const html = await renderBlock("product-page-reels", { reels: [makeReel()] });
    await mount(`<script src="/assets/reel-lightbox.js" defer></script>${html}`, ["loader"]);
    expect(injected()).toEqual([]);
  });

  it("does nothing on a page with no triggers, and only once per page", async () => {
    await mount("<p>no reels</p>", ["loader"]);
    expect(injected()).toEqual([]);
    document.body.insertAdjacentHTML("beforeend", await renderBlock("product-page-reels", { reels: [makeReel()] }));
    await mount(document.body.innerHTML, ["loader"]);
    expect(injected()).toEqual([]);
  });
});
