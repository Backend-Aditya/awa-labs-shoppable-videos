// reel-loader.js: the one script the app embed and every block put on the
// page; it loads the runtime only where there is a widget to drive.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeReel, makeWidget } from "../support/storefront-fixtures.mjs";
import { mount, renderBlock, resetPage } from "./harness";

const LOADER_SRC = "https://cdn.shopify.test/extensions/abc/assets/reel-loader.js";
const asset = (file: string) => LOADER_SRC.replace("reel-loader.js", file);
const RUNTIME = ["reel-tracking.js", "reel-hls.js", "reel-lightbox.js", "reel-story.js", "reel-trigger.js"];

beforeEach(() => {
  resetPage();
  Object.defineProperty(document, "currentScript", { configurable: true, get: () => ({ src: LOADER_SRC }) });
});
afterEach(() => {
  delete (document as unknown as Record<string, unknown>).currentScript;
});

const injectedScripts = () => Array.from(document.head.querySelectorAll<HTMLScriptElement>("script[data-reelup-loader]"));
const injected = () => injectedScripts().map((s) => [s.src, s.async]);
const strip = () => renderBlock("product-page-reels", { reels: [makeReel()] });

describe("reel-loader", () => {
  it("on a page with a widget, injects the runtime in order (non-async) plus the viewer stylesheet", async () => {
    await mount(await strip(), ["loader"]);
    expect(injected()).toEqual(RUNTIME.map((f) => [asset(f), false]));
    expect(document.head.querySelector<HTMLLinkElement>('link[href$="reel-lightbox.css"]')!.rel).toBe("stylesheet");
  });

  it("adds the floating-video script, last, when the embed renders one", async () => {
    const pop = await renderBlock("shoppable-videos", { reel: makeReel({ id: 4 }), widget: makeWidget() });
    await mount(pop, ["loader"]);
    expect(injected()).toEqual([...RUNTIME, "reel-pop.js"].map((f) => [asset(f), false]));
  });

  it("the embed alone on a page without widgets loads nothing else", async () => {
    const embed = await renderBlock("shoppable-videos", { widget: makeWidget({ published: false }) });
    expect(embed).toContain('<script src="/assets/reel-loader.js" defer></script>');
    expect(embed).not.toMatch(/reel-(hls|lightbox|story|trigger|pop)\.js|stylesheet/);
    await mount(embed, ["loader"]);
    expect(injected()).toEqual([]);
    expect(document.head.querySelector("link")).toBeNull();
  });

  it("stands down when the runtime is already on the page", async () => {
    (window as unknown as Record<string, unknown>).ReelupLightbox = {};
    (window as unknown as Record<string, unknown>).ReelupTracking = {};
    await mount(await strip(), ["loader"]);
    expect(injected()).toEqual([]);
  });

  it("with Microsoft Clarity connected, loads the tracking script on every page, the runtime only where needed", async () => {
    const embed = await renderBlock("shoppable-videos", { widget: makeWidget({ published: false }) });
    await mount(embed, ["loader"], { tracking: { clarityId: "abc123def" } });
    expect(injected()).toEqual([[asset("reel-tracking.js"), false]]);

    // A block added in the theme editor later brings the runtime, not a second tracking script.
    document.body.insertAdjacentHTML("beforeend", await strip());
    document.dispatchEvent(new CustomEvent("shopify:section:load"));
    expect(injected().map(([src]) => src)).toEqual(["reel-tracking.js", ...RUNTIME.slice(1)].map(asset));
  });

  it("runs once per page, and wakes up when the theme editor adds a block", async () => {
    await mount("<p>no reels</p>", ["loader"]);
    expect(injected()).toEqual([]);
    document.body.insertAdjacentHTML("beforeend", await strip());
    await mount(document.body.innerHTML, ["loader"]);
    expect(injected()).toEqual([]);

    document.dispatchEvent(new CustomEvent("shopify:section:load"));
    expect(injected()).toHaveLength(RUNTIME.length);
    document.dispatchEvent(new CustomEvent("shopify:section:load"));
    expect(injected()).toHaveLength(RUNTIME.length);
  });

  it("holds a tap made while the runtime downloads and replays it once it has run", async () => {
    await mount(await strip(), ["loader"]);
    const button = document.querySelector<HTMLButtonElement>(".reelup-trigger__button")!;
    const opened = vi.fn();
    button.addEventListener("click", opened);
    button.click();
    button.click();
    expect(opened).not.toHaveBeenCalled();

    injectedScripts().at(-1)!.dispatchEvent(new Event("load"));
    expect(opened).toHaveBeenCalledTimes(1);
    button.click();
    expect(opened).toHaveBeenCalledTimes(2);
  });

  it("releases taps even if the runtime fails to download", async () => {
    await mount(await strip(), ["loader"]);
    const button = document.querySelector<HTMLButtonElement>(".reelup-trigger__button")!;
    const opened = vi.fn();
    button.addEventListener("click", opened);
    injectedScripts().at(-1)!.dispatchEvent(new Event("error"));
    button.click();
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
