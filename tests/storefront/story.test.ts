// Story viewer (reel-story.js) opened from the Stories block.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { makeProduct, makeReel, makeWidget } from "../support/storefront-fixtures.mjs";
import { click, fetchBody, fetchCalls, hls, mount, renderBlock, resetPage, storyViewer } from "./harness";

const reels = [
  makeReel({ id: 1, title: "One", products: [makeProduct({ id: 1 }), makeProduct({ id: 2 })] }),
  makeReel({ id: 2, title: "Two", ctaUrl: "/pages/look", ctaLabel: "See look" }),
  makeReel({ id: 3, title: "Three" }),
];

async function mountStories(style: object = { storyDuration: 5 }) {
  await mount(await renderBlock("insta-stories", { reels, widget: makeWidget({ style }) }));
}
const avatar = (i: number) => document.querySelectorAll<HTMLButtonElement>("[data-reelup-story-group] .reelup-trigger__button")[i];
const q = <E extends Element = HTMLElement>(sel: string) => storyViewer()!.querySelector<E>(sel)!;
const title = () => q("#reelup-story-title").textContent;

beforeEach(() => {
  resetPage();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("story viewer", () => {
  it("opens at the tapped story with one progress segment per story", async () => {
    await mountStories();
    click(avatar(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(storyViewer()!.open).toBe(true);
    expect(title()).toBe("Two");
    expect(storyViewer()!.querySelectorAll(".reelup-story__segment")).toHaveLength(3);
    expect(hls.attach).toHaveBeenCalledWith(q("video"), expect.stringContaining("/2/manifest"));
  });

  it("auto-advances after the story duration and closes after the last", async () => {
    await mountStories();
    click(avatar(0));
    await vi.advanceTimersByTimeAsync(0);
    expect(title()).toBe("One");
    await vi.advanceTimersByTimeAsync(5000);
    expect(title()).toBe("Two");
    await vi.advanceTimersByTimeAsync(5000);
    expect(title()).toBe("Three");
    await vi.advanceTimersByTimeAsync(5000);
    expect(storyViewer()!.open).toBe(false);
    expect(document.activeElement).toBe(avatar(2));
  });

  it("tap zones and arrow keys move between stories", async () => {
    await mountStories();
    click(avatar(0));
    click(q("[data-reelup-story-next]"));
    expect(title()).toBe("Two");
    fireEvent.keyDown(storyViewer()!, { key: "ArrowRight" });
    expect(title()).toBe("Three");
    click(q("[data-reelup-story-prev]"));
    expect(title()).toBe("Two");
    fireEvent.keyDown(storyViewer()!, { key: "ArrowLeft" });
    click(q("[data-reelup-story-prev]"));
    expect(title()).toBe("One");
  });

  it("close button closes and tears down", async () => {
    await mountStories();
    click(avatar(0));
    click(q("[data-reelup-story-close]"));
    expect(storyViewer()!.open).toBe(false);
    expect(hls.teardown).toHaveBeenCalled();
    expect(document.documentElement.classList.contains("reelup-locked")).toBe(false);
  });

  it("the sticker opens the product drawer, which pauses the story; Escape closes it", async () => {
    await mountStories();
    click(avatar(0));
    await vi.advanceTimersByTimeAsync(0);
    const sticker = q("[data-reelup-story-shop]");
    expect(sticker.hidden).toBe(false);
    expect(sticker.querySelector(".reelup-story__sticker-count")!.textContent).toBe("2");
    click(sticker);
    expect(q("[data-reelup-story-drawer]").hidden).toBe(false);
    expect(storyViewer()!.querySelectorAll("[data-reelup-story-list] [data-reelup-product]")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(20000);
    expect(title()).toBe("One");
    fireEvent.keyDown(storyViewer()!, { key: "Escape" });
    expect(q("[data-reelup-story-drawer]").hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(title()).toBe("Two");
  });

  it("a link-only story's sticker shows the link label", async () => {
    await mountStories();
    click(avatar(1));
    const sticker = q("[data-reelup-story-shop]");
    expect(sticker.hidden).toBe(false);
    expect(sticker.dataset.link).toBe("/pages/look");
    expect(sticker.querySelector(".reelup-story__sticker-label")!.textContent).toBe("See look");
  });

  it("a story with no products or link hides the sticker", async () => {
    await mountStories();
    click(avatar(2));
    expect(q("[data-reelup-story-shop]").hidden).toBe(true);
  });

  it("press-and-hold pauses, release resumes", async () => {
    await mountStories();
    click(avatar(0));
    await vi.advanceTimersByTimeAsync(0);
    const frame = q(".reelup-story__frame");
    const video = q<HTMLVideoElement>("video");
    fireEvent.pointerDown(frame);
    await vi.advanceTimersByTimeAsync(200);
    expect(video.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(title()).toBe("One");
    fireEvent.pointerUp(frame);
    await vi.advanceTimersByTimeAsync(1);
    expect(video.paused).toBe(false);
  });
});

describe("seen state", () => {
  it("marks watched stories in localStorage and greys their rings on the next page view", async () => {
    await mountStories();
    click(avatar(0));
    click(q("[data-reelup-story-next]"));
    click(q("[data-reelup-story-next]"));
    expect(JSON.parse(localStorage.getItem("reelup-seen-stories")!)).toEqual([
      "gid://shopify/Metaobject/1",
      "gid://shopify/Metaobject/2",
    ]);
    const triggers = document.querySelectorAll("[data-reelup-story-group] [data-reelup-trigger]");
    expect(Array.from(triggers).map((t) => t.classList.contains("is-seen"))).toEqual([true, true, false]);

    const seen = localStorage.getItem("reelup-seen-stories");
    resetPage();
    localStorage.setItem("reelup-seen-stories", seen!);
    await mountStories();
    const again = document.querySelectorAll("[data-reelup-story-group] [data-reelup-trigger]");
    expect(Array.from(again).map((t) => t.classList.contains("is-seen"))).toEqual([true, true, false]);
  });

  it("survives corrupt storage", async () => {
    localStorage.setItem("reelup-seen-stories", "{not json");
    await mountStories();
    click(avatar(0));
    expect(storyViewer()!.open).toBe(true);
  });

  it("records one view per story", async () => {
    await mountStories();
    click(avatar(0));
    await vi.advanceTimersByTimeAsync(0);
    const views = fetchCalls("/apps/reels/analytics").map(fetchBody).filter((b) => b.eventType === "view");
    expect(views).toEqual([{ reelId: "gid://shopify/Metaobject/1", eventType: "view" }]);
  });
});
