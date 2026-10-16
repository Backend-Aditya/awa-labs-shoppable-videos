// Inline widget behaviour from reel-trigger.js (deck, filmstrip arrows,
// scroll previews) and reel-pop.js (floating video).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { makeReel, makeWidget } from "../support/storefront-fixtures.mjs";
import { click, FakeIntersectionObserver, flush, hls, media, mount, renderBlock, resetPage, viewer } from "./harness";

const reels = (n: number) => Array.from({ length: n }, (_, i) => makeReel({ id: i + 1, title: `Reel ${i + 1}` }));

beforeEach(() => {
  resetPage();
});

describe("stacked deck", () => {
  async function mountDeck(n = 4) {
    await mount(await renderBlock("stacked-carousel", { reels: reels(n), widget: makeWidget({ style: { layoutMode: "stack" } }) }));
    const deck = document.querySelector<HTMLElement>("[data-reelup-deck]")!;
    const cards = Array.from(deck.querySelectorAll<HTMLElement>("[data-reelup-deck-card]"));
    const dots = Array.from(deck.querySelectorAll<HTMLElement>("[data-reelup-deck-dots] span"));
    const active = () => cards.findIndex((c) => c.classList.contains("is-active"));
    const activeDot = () => dots.findIndex((d) => d.classList.contains("is-active"));
    return { deck, cards, active, activeDot, status: deck.querySelector("[data-reelup-deck-status]")! };
  }

  it("starts on the second card with only the front card focusable", async () => {
    const { deck, cards, active, activeDot, status } = await mountDeck();
    expect(deck.classList.contains("is-ready")).toBe(true);
    expect(active()).toBe(1);
    expect(activeDot()).toBe(1);
    expect(status.textContent).toBe("2 / 4 — Reel 2");
    expect(cards.map((c) => c.querySelector<HTMLElement>(".reelup-trigger__button")!.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(cards.map((c) => c.getAttribute("aria-hidden"))).toEqual(["true", "false", "true", "true"]);
    expect(cards[3].style.getPropertyValue("--ru-offset")).toBe("2");
  });

  it("arrows and dots follow, wrapping at both ends", async () => {
    const { deck, active, activeDot } = await mountDeck();
    click(deck.querySelector("[data-reelup-deck-next]"));
    expect(active()).toBe(2);
    expect(activeDot()).toBe(2);
    click(deck.querySelector("[data-reelup-deck-next]"));
    click(deck.querySelector("[data-reelup-deck-next]"));
    expect(active()).toBe(0);
    click(deck.querySelector("[data-reelup-deck-prev]"));
    expect(active()).toBe(3);
    fireEvent.keyDown(deck, { key: "ArrowRight" });
    expect(active()).toBe(0);
    fireEvent.keyDown(deck, { key: "ArrowLeft" });
    expect(activeDot()).toBe(3);
  });

  it("tapping a side card brings it forward instead of opening it", async () => {
    const { cards, active } = await mountDeck();
    click(cards[2].querySelector(".reelup-trigger__button"));
    expect(active()).toBe(2);
    expect(viewer()).toBeNull();
    click(cards[2].querySelector(".reelup-trigger__button"));
    expect(viewer()!.open).toBe(true);
    expect(viewer()!.querySelector("[data-reelup-count]")!.textContent).toBe("3 of 4");
  });

  it("a horizontal swipe moves the deck and does not open the card", async () => {
    const { deck, cards, active } = await mountDeck();
    const stage = deck.querySelector(".reelup-deck__stage")!;
    fireEvent.pointerDown(stage, { clientX: 200 });
    fireEvent.pointerUp(stage, { clientX: 100 });
    expect(active()).toBe(2);
    click(cards[2].querySelector(".reelup-trigger__button"));
    expect(viewer()).toBeNull();
  });
});

describe("filmstrip arrows", () => {
  it("scroll the track and hide at the ends", async () => {
    await mount(await renderBlock("product-page-reels", { reels: reels(5) }));
    const track = document.querySelector<HTMLElement>("[data-reelup-strip]")!;
    const prev = document.querySelector<HTMLButtonElement>("[data-reelup-strip-prev]")!;
    const next = document.querySelector<HTMLButtonElement>("[data-reelup-strip-next]")!;
    Object.defineProperty(track, "scrollWidth", { configurable: true, value: 1000 });
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 400 });
    track.scrollLeft = 0;
    fireEvent.scroll(track);
    expect(prev.hidden).toBe(true);
    expect(next.hidden).toBe(false);
    click(next);
    expect(track.scrollBy).toHaveBeenCalledWith({ left: 320, behavior: "smooth" });
    track.scrollLeft = 600;
    fireEvent.scroll(track);
    expect(prev.hidden).toBe(false);
    expect(next.hidden).toBe(true);
    media.reducedMotion = true;
    click(prev);
    expect(track.scrollBy).toHaveBeenLastCalledWith({ left: -320, behavior: "auto" });
  });
});

describe("scroll previews", () => {
  it("start muted lowest-rendition previews for visible triggers, at most three, and stop when a viewer opens", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    await mount(await renderBlock("product-page-reels", { reels: reels(5), widget: makeWidget({ style: { autoplayOnScroll: true } }) }));
    const observer = FakeIntersectionObserver.instances[0];
    const triggers = Array.from(document.querySelectorAll<HTMLElement>("[data-reelup-trigger]"));
    expect(observer.observed.size).toBe(5);
    observer.trigger(triggers.map((target) => ({ target, isIntersecting: true })));
    await flush();
    const previews = document.querySelectorAll<HTMLVideoElement>("video.reelup-trigger__preview");
    expect(previews).toHaveLength(3);
    expect(previews[0].muted).toBe(true);
    expect(hls.attach).toHaveBeenCalledWith(expect.any(HTMLVideoElement), expect.stringContaining("manifest"), { preview: true });

    click(triggers[0].querySelector(".reelup-trigger__button"));
    await flush();
    expect(document.querySelectorAll("video.reelup-trigger__preview")).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("are off with reduced motion", async () => {
    media.reducedMotion = true;
    await mount(await renderBlock("product-page-reels", { reels: reels(2), widget: makeWidget({ style: { autoplayOnScroll: true } }) }));
    expect(FakeIntersectionObserver.instances[0].observed.size).toBe(0);
  });
});

describe("floating video (reel-pop.js)", () => {
  async function mountPop(style: object = { popDelay: 3, bubbleLabel: "Watch" }) {
    const html = await renderBlock("shoppable-videos", { reel: makeReel({ id: 4 }), blockId: "embed-1", widget: makeWidget({ style }) });
    await mount(html.replace(/<script type="application\/json" id="reelup-config">[\s\S]*?<\/script>/, ""));
    return document.querySelector<HTMLElement>("[data-reelup-pop]")!;
  }
  const KEY = "reelup-pop-dismissed-embed-1-gid://shopify/Metaobject/4";

  it("appears after the configured delay", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const pop = await mountPop();
      expect(pop.hidden).toBe(true);
      vi.advanceTimersByTime(2999);
      expect(pop.hidden).toBe(true);
      vi.advanceTimersByTime(1);
      expect(pop.hidden).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismiss hides it and persists for the session", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const pop = await mountPop({ popDelay: 0 });
      vi.advanceTimersByTime(0);
      click(pop.querySelector("[data-reelup-pop-dismiss]"));
      expect(pop.hidden).toBe(true);
      expect(sessionStorage.getItem(KEY)).toBe("true");
      expect(viewer()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays hidden on later page views in the same session", async () => {
    sessionStorage.setItem(KEY, "true");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const pop = await mountPop({ popDelay: 0 });
      vi.advanceTimersByTime(100);
      expect(pop.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the label bubble opens the viewer", async () => {
    const pop = await mountPop();
    click(pop.querySelector("[data-reelup-pop-open]"));
    expect(viewer()!.open).toBe(true);
  });
});
