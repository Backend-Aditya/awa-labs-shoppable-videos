// The shared video viewer (reel-lightbox.js) opened from the filmstrip
// block, wired by reel-trigger.js.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { makeProduct, makeReel, makeWidget } from "../support/storefront-fixtures.mjs";
import { click, fetchBody, fetchCalls, fetchMock, flush, hls, json, media, mount, renderBlock, resetPage, viewer } from "./harness";

const products = [makeProduct({ id: 1 }), makeProduct({ id: 2 })];
const reels = [
  makeReel({ id: 11, title: "First", products }),
  makeReel({ id: 22, title: "Second", products: [makeProduct({ id: 3 })] }),
  makeReel({ id: 33, title: "Third", ctaUrl: "https://shop.test/lookbook", ctaLabel: "See the look" }),
];

async function mountStrip(style: object = {}, list = reels) {
  await mount(await renderBlock("product-page-reels", { reels: list, product: products[0], widget: makeWidget({ style }) }));
}
const triggerButton = (i: number) => document.querySelectorAll<HTMLButtonElement>("[data-reelup-trigger] .reelup-trigger__button")[i];
const q = <E extends Element = HTMLElement>(selector: string) => viewer()!.querySelector<E>(selector)!;
const views = () => fetchCalls("/apps/reels/analytics").map(fetchBody).filter((b) => b.eventType === "view");

beforeEach(() => {
  resetPage();
});

describe("opening the viewer", () => {
  it("opens the tapped reel modally with its title, products, count and HLS source", async () => {
    await mountStrip();
    click(triggerButton(0));
    await flush();
    const dialog = viewer()!;
    expect(dialog.open).toBe(true);
    expect(document.documentElement.classList.contains("reelup-locked")).toBe(true);
    expect(dialog.dataset.reelupReelId).toBe("gid://shopify/Metaobject/11");
    expect(q("#reelup-viewer-title").textContent).toBe("First");
    expect(dialog.querySelectorAll("[data-reelup-list] [data-reelup-product]")).toHaveLength(2);
    expect(q("[data-reelup-panel-count]").textContent).toBe("2");
    expect(q("[data-reelup-count]").textContent).toBe("1 of 3");
    expect(q<HTMLVideoElement>("video").getAttribute("poster")).toBe("https://cdn.test/posters/11.jpg");
    expect(hls.attach).toHaveBeenCalledWith(q("video"), "https://customer-test.cloudflarestream.com/11/manifest/video.m3u8");
  });

  it("next/prev move through the strip, with the ends disabled", async () => {
    await mountStrip();
    click(triggerButton(0));
    expect(q<HTMLButtonElement>("[data-reelup-prev]").disabled).toBe(true);
    click(q("[data-reelup-next]"));
    expect(q("#reelup-viewer-title").textContent).toBe("Second");
    expect(q("[data-reelup-count]").textContent).toBe("2 of 3");
    fireEvent.keyDown(viewer()!, { key: "ArrowDown" });
    expect(q("#reelup-viewer-title").textContent).toBe("Third");
    expect(q<HTMLButtonElement>("[data-reelup-next]").disabled).toBe(true);
    click(q("[data-reelup-next]"));
    expect(q("#reelup-viewer-title").textContent).toBe("Third");
    fireEvent.keyDown(viewer()!, { key: "ArrowLeft" });
    click(q("[data-reelup-prev]"));
    expect(q("#reelup-viewer-title").textContent).toBe("First");
  });

  it("arrow keys inside a variant select do not change reels", async () => {
    await mountStrip();
    click(triggerButton(0));
    const input = document.createElement("input");
    q("[data-reelup-list]").appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(q("#reelup-viewer-title").textContent).toBe("First");
  });

  it("a single reel hides the navigation and count", async () => {
    await mountStrip({}, [reels[0]]);
    click(triggerButton(0));
    expect(q("[data-reelup-nav]").hidden).toBe(true);
    expect(q("[data-reelup-count]").hidden).toBe(true);
  });

  it("closing tears down playback, unlocks the page, returns focus to the trigger, then empties the list", async () => {
    await mountStrip();
    click(triggerButton(1));
    click(q("[data-reelup-close]"));
    expect(viewer()!.open).toBe(false);
    expect(hls.teardown).toHaveBeenCalled();
    expect(document.documentElement.classList.contains("reelup-locked")).toBe(false);
    expect(document.activeElement).toBe(triggerButton(1));
    // The product list stays through the closing fade, then is emptied.
    expect(q("[data-reelup-list]").children.length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(q("[data-reelup-list]").children).toHaveLength(0);
  });

  it("backdrop click closes", async () => {
    await mountStrip();
    click(triggerButton(0));
    fireEvent.click(viewer()!);
    expect(viewer()!.open).toBe(false);
  });

  it("reuses one viewer and resets per-trigger settings", async () => {
    await mountStrip({ ctaColor: "#ff0000", ctaStyle: "square", loop: true, showShare: false });
    click(triggerButton(0));
    const dialog = viewer()!;
    expect(dialog.style.getPropertyValue("--ru-cta")).toBe("#ff0000");
    expect(dialog.classList.contains("reelup-cta--square")).toBe(true);
    expect(q<HTMLVideoElement>("video").loop).toBe(true);
    expect(q("[data-reelup-share]").hidden).toBe(true);
    click(q("[data-reelup-close]"));

    resetPage();
    await mountStrip();
    click(triggerButton(0));
    expect(document.querySelectorAll("#reelup-lightbox")).toHaveLength(1);
    expect(viewer()!.style.getPropertyValue("--ru-cta")).toBe("");
    expect(viewer()!.classList.contains("reelup-cta--pill")).toBe(true);
  });

  it("the play/pause and mute buttons drive the video", async () => {
    await mountStrip({ mutedDefault: true });
    click(triggerButton(0));
    await flush();
    const video = q<HTMLVideoElement>("video");
    expect(video.muted).toBe(true);
    expect(q("[data-reelup-mute]").getAttribute("aria-label")).toBe("Unmute");
    click(q("[data-reelup-mute]"));
    expect(video.muted).toBe(false);
    expect(q("[data-reelup-mute]").getAttribute("aria-label")).toBe("Mute");
    click(q("[data-reelup-play-pause]"));
    expect(video.paused).toBe(true);
    expect(q("[data-reelup-play-pause]").getAttribute("aria-label")).toBe("Play video");
  });

  it("the progress strip is a seek slider: pointer, keyboard and live values", async () => {
    await mountStrip();
    click(triggerButton(0));
    await flush();
    const video = q<HTMLVideoElement>("video");
    let time = 0;
    Object.defineProperty(video, "duration", { configurable: true, value: 80 });
    Object.defineProperty(video, "currentTime", { configurable: true, get: () => time, set: (v: number) => (time = v) });
    video.dispatchEvent(new Event("loadedmetadata"));
    const seek = q("[data-reelup-seek]");
    expect(seek.getAttribute("role")).toBe("slider");
    expect(seek.getAttribute("aria-valuemax")).toBe("80");

    seek.getBoundingClientRect = () => ({ left: 100, width: 400, top: 0, height: 3, right: 500, bottom: 3, x: 100, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(seek, { pointerId: 1, clientX: 300 });
    expect(time).toBe(40);
    expect(q("[data-reelup-player]").classList.contains("is-seeking")).toBe(true);
    fireEvent.pointerMove(seek, { pointerId: 1, clientX: 400 });
    expect(time).toBe(60);
    fireEvent.pointerUp(seek, { pointerId: 1 });
    expect(q("[data-reelup-player]").classList.contains("is-seeking")).toBe(false);
    expect(seek.getAttribute("aria-valuetext")).toBe("1:00 / 1:20");

    // Arrow keys seek instead of changing reels.
    fireEvent.keyDown(seek, { key: "ArrowRight" });
    expect(time).toBe(65);
    fireEvent.keyDown(seek, { key: "ArrowLeft" });
    fireEvent.keyDown(seek, { key: "ArrowLeft" });
    expect(time).toBe(55);
    fireEvent.keyDown(seek, { key: "Home" });
    expect(time).toBe(0);
    expect(q("#reelup-viewer-title").textContent).toBe("First");
  });

  it("K or Space toggles playback and M toggles sound", async () => {
    await mountStrip({ mutedDefault: true });
    click(triggerButton(0));
    await flush();
    const video = q<HTMLVideoElement>("video");
    expect(video.paused).toBe(false);
    fireEvent.keyDown(q("#reelup-viewer-title"), { key: "k" });
    expect(video.paused).toBe(true);
    fireEvent.keyDown(q("#reelup-viewer-title"), { key: " " });
    expect(video.paused).toBe(false);
    // Space on a focused button presses that button instead.
    fireEvent.keyDown(q("[data-reelup-close]"), { key: " " });
    expect(video.paused).toBe(false);
    fireEvent.keyDown(viewer()!, { key: "m" });
    expect(video.muted).toBe(false);
    fireEvent.keyDown(viewer()!, { key: "M" });
    expect(video.muted).toBe(true);
    // Browser shortcuts pass through untouched.
    fireEvent.keyDown(viewer()!, { key: "k", ctrlKey: true });
    expect(video.paused).toBe(false);
  });

  it("one trackpad or wheel gesture over the video moves one reel", async () => {
    await mountStrip();
    click(triggerButton(0));
    const player = q("[data-reelup-player]");
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000);
    fireEvent.wheel(player, { deltaY: 15 });
    fireEvent.wheel(player, { deltaY: 15 });
    expect(q("#reelup-viewer-title").textContent).toBe("First");
    fireEvent.wheel(player, { deltaY: 15 });
    expect(q("#reelup-viewer-title").textContent).toBe("Second");
    // Momentum events right after are swallowed...
    now.mockReturnValue(1_200);
    fireEvent.wheel(player, { deltaY: 80 });
    expect(q("#reelup-viewer-title").textContent).toBe("Second");
    // ...and a fresh gesture later moves again; sideways scrolling never does.
    now.mockReturnValue(3_000);
    fireEvent.wheel(player, { deltaX: 120, deltaY: 5 });
    expect(q("#reelup-viewer-title").textContent).toBe("Second");
    fireEvent.wheel(player, { deltaY: -60 });
    expect(q("#reelup-viewer-title").textContent).toBe("First");
    now.mockRestore();
  });

  it("preloads the next reel's poster", async () => {
    const created: string[] = [];
    vi.stubGlobal(
      "Image",
      class {
        decoding = "";
        set src(value: string) {
          created.push(value);
        }
      },
    );
    await mountStrip();
    click(triggerButton(0));
    expect(created).toContain("https://cdn.test/posters/22.jpg");
    vi.unstubAllGlobals();
  });

  it("keeps the viewer usable when playback fails", async () => {
    hls.attach.mockRejectedValueOnce(new Error("HLS not supported"));
    await mountStrip();
    click(triggerButton(0));
    await flush();
    expect(viewer()!.open).toBe(true);
    expect(q("[data-reelup-list]").children.length).toBeGreaterThan(0);
  });

  it("auto-advances when a non-looping video ends", async () => {
    await mountStrip();
    click(triggerButton(0));
    q("video").dispatchEvent(new Event("ended"));
    expect(q("#reelup-viewer-title").textContent).toBe("Second");
  });
});

describe("buffering and transitions", () => {
  const setReadyState = (video: HTMLVideoElement, value: number) =>
    Object.defineProperty(video, "readyState", { configurable: true, get: () => value });

  it("shows a spinner only when a playing video stalls past a grace period, and hides it when frames move", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await mountStrip();
      click(triggerButton(0));
      await vi.advanceTimersByTimeAsync(0);
      const player = q("[data-reelup-player]");
      const video = q<HTMLVideoElement>("video");
      setReadyState(video, 0);
      video.dispatchEvent(new Event("waiting"));
      await vi.advanceTimersByTimeAsync(300);
      expect(player.classList.contains("is-buffering")).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(player.classList.contains("is-buffering")).toBe(true);

      setReadyState(video, 4);
      video.dispatchEvent(new Event("playing"));
      expect(player.classList.contains("is-buffering")).toBe(false);

      // Paused by the shopper: never a spinner, whatever the buffer.
      setReadyState(video, 0);
      click(q("[data-reelup-play-pause]"));
      await vi.advanceTimersByTimeAsync(1000);
      expect(player.classList.contains("is-buffering")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no spinner over a reel that failed to play", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      hls.attach.mockRejectedValueOnce(new Error("HLS not supported"));
      await mountStrip();
      click(triggerButton(0));
      await vi.advanceTimersByTimeAsync(1000);
      expect(q("[data-reelup-error]").hidden).toBe(false);
      expect(q("[data-reelup-player]").classList.contains("is-buffering")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks which way the reel changed so it can slide in from that side", async () => {
    await mountStrip();
    click(triggerButton(0));
    expect(viewer()!.hasAttribute("data-enter")).toBe(false);
    click(q("[data-reelup-next]"));
    expect(viewer()!.dataset.enter).toBe("next");
    click(q("[data-reelup-prev]"));
    expect(viewer()!.dataset.enter).toBe("prev");
  });
});

describe("product panel", () => {
  it("peeks on desktop; tap reveal starts closed and the head toggles it", async () => {
    await mountStrip({ tagRevealMode: "tap" });
    click(triggerButton(0));
    const panel = q("[data-reelup-panel]");
    const head = q("[data-reelup-panel-toggle]");
    expect(panel.dataset.state).toBe("closed");
    expect(head.getAttribute("aria-expanded")).toBe("false");
    click(head);
    expect(panel.dataset.state).toBe("open");
    click(head);
    expect(panel.dataset.state).toBe("closed");
  });

  it("desktop peek: the chevron collapses the list and expands it again", async () => {
    await mountStrip();
    click(triggerButton(0));
    const panel = q("[data-reelup-panel]");
    const head = q("[data-reelup-panel-toggle]");
    expect(panel.dataset.state).toBe("peek");
    expect(head.getAttribute("aria-expanded")).toBe("true");
    click(head);
    expect(panel.dataset.state).toBe("closed");
    expect(head.getAttribute("aria-expanded")).toBe("false");
    click(head);
    expect(panel.dataset.state).toBe("open");
    expect(head.getAttribute("aria-expanded")).toBe("true");
  });

  it("mobile bottom sheet: peek → open → back to peek", async () => {
    media.mobile = true;
    await mountStrip();
    click(triggerButton(0));
    const panel = q("[data-reelup-panel]");
    const head = q("[data-reelup-panel-toggle]");
    expect(panel.dataset.state).toBe("peek");
    expect(head.getAttribute("aria-expanded")).toBe("false");
    click(head);
    expect(panel.dataset.state).toBe("open");
    expect(head.getAttribute("aria-expanded")).toBe("true");
    click(head);
    expect(panel.dataset.state).toBe("peek");
  });

  it("a reel with only a link button shows the link, not the product toggle", async () => {
    await mountStrip();
    click(triggerButton(2));
    const link = q<HTMLAnchorElement>("[data-reelup-link]");
    expect(q("[data-reelup-panel]").hidden).toBe(false);
    expect(link.hidden).toBe(false);
    expect(link.getAttribute("href")).toBe("https://shop.test/lookbook");
    expect(link.textContent).toBe("See the look");
    expect(q("[data-reelup-panel-toggle]").hidden).toBe(true);
  });
});

describe("safeLink", () => {
  it.each([
    ["javascript:alert(1)", ""],
    ["  JavaScript:alert(1)", ""],
    ["data:text/html,hi", ""],
    ["mailto:a@b.c", ""],
    ["https://shop.test/a", "https://shop.test/a"],
    ["http://shop.test/a", "http://shop.test/a"],
    ["/pages/lookbook", "/pages/lookbook"],
    [undefined, ""],
  ])("%j → %j", async (input, expected) => {
    await mount("", ["lightbox"]);
    const { safeLink } = (window as unknown as { ReelupViewer: { safeLink: (v: unknown) => string } }).ReelupViewer;
    expect(safeLink(input)).toBe(expected);
  });

  // KNOWN BUG: the safeLink regex /^(https?:\/\/|\/)/ accepts any string
  // starting with "/", so a protocol-relative "//evil.test" URL passes and
  // becomes an off-site link in the viewer. Remove `.fails` once
  // safeLink rejects "//".
  it("rejects protocol-relative //host URLs", async () => {
    await mount("", ["lightbox"]);
    const { safeLink } = (window as unknown as { ReelupViewer: { safeLink: (v: unknown) => string } }).ReelupViewer;
    expect(safeLink("//evil.test/x")).toBe("");
  });

  it("a reel link to //host is not rendered", async () => {
    await mountStrip({}, [makeReel({ id: 1, ctaUrl: "//evil.test/phish", ctaLabel: "Go" })]);
    click(triggerButton(0));
    expect(q("[data-reelup-link]").hidden).toBe(true);
  });

  it("a javascript: reel link is never rendered", async () => {
    await mountStrip({}, [makeReel({ id: 1, ctaUrl: "javascript:alert(1)", ctaLabel: "Go" })]);
    click(triggerButton(0));
    expect(q("[data-reelup-link]").hidden).toBe(true);
    expect(q("[data-reelup-link]").hasAttribute("href")).toBe(false);
  });
});

describe("view analytics de-dupe", () => {
  it("counts a reel once per 30 minutes per tab", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-12T10:00:00Z") });
    try {
      await mountStrip();
      click(triggerButton(0));
      click(q("[data-reelup-next]"));
      click(q("[data-reelup-prev]"));
      expect(views().map((v) => v.reelId)).toEqual(["gid://shopify/Metaobject/11", "gid://shopify/Metaobject/22"]);
      expect(sessionStorage.getItem("reelup-viewed-gid://shopify/Metaobject/11")).toBe(String(Date.now()));

      vi.setSystemTime(new Date("2026-10-12T10:29:59Z"));
      click(q("[data-reelup-next]"));
      click(q("[data-reelup-prev]"));
      expect(views()).toHaveLength(2);

      vi.setSystemTime(new Date("2026-10-12T10:30:01Z"));
      click(q("[data-reelup-next]"));
      expect(views()).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still counts when sessionStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    await mountStrip();
    click(triggerButton(0));
    click(q("[data-reelup-close]"));
    click(triggerButton(0));
    expect(views()).toHaveLength(2);
    vi.restoreAllMocks();
  });
});

describe("deep links and sharing", () => {
  it("?reelup=<numeric id> opens that reel in its group on load", async () => {
    window.history.replaceState(null, "", "/products/x?reelup=22");
    await mountStrip();
    expect(viewer()!.open).toBe(true);
    expect(q("#reelup-viewer-title").textContent).toBe("Second");
    expect(q("[data-reelup-count]").textContent).toBe("2 of 3");
  });

  it.each(["abc", "22abc", "99"])("ignores ?reelup=%s", async (id) => {
    window.history.replaceState(null, "", `/?reelup=${id}`);
    await mountStrip();
    expect(viewer()).toBeNull();
  });

  it("share uses navigator.share with a clean ?reelup= URL", async () => {
    window.history.replaceState(null, "", "/products/x?variant=1&reelup=9#reviews");
    const shareFn = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { configurable: true, value: shareFn });
    try {
      await mountStrip();
      click(triggerButton(1));
      click(q("[data-reelup-share]"));
      await flush();
      expect(shareFn).toHaveBeenCalledWith({ title: "Second", url: "http://localhost:3000/products/x?variant=1&reelup=22" });
    } finally {
      delete (navigator as unknown as Record<string, unknown>).share;
    }
  });

  it("falls back to the clipboard with a 'Link copied' toast", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await mountStrip();
    click(triggerButton(0));
    click(q("[data-reelup-share]"));
    await flush();
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\?reelup=11$/));
    expect(q(".reelup-toast").textContent).toBe("Link copied");
    expect(q(".reelup-toast").getAttribute("aria-hidden")).toBe("true");
    // Announced through the viewer's live region instead.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(q("[data-reelup-live]").textContent).toBe("Link copied");
  });

  it("an aborted native share does nothing else", async () => {
    const abort = Object.assign(new Error("cancel"), { name: "AbortError" });
    Object.defineProperty(navigator, "share", { configurable: true, value: vi.fn(async () => Promise.reject(abort)) });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      await mountStrip();
      click(triggerButton(0));
      click(q("[data-reelup-share]"));
      await flush();
      expect(writeText).not.toHaveBeenCalled();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).share;
    }
  });
});

describe("recommendations", () => {
  const recs = [
    { id: 1, title: "Already tagged", url: "/products/p1", price: 100, featured_image: null },
    { id: 900, title: '<img src=x onerror="alert(1)">', url: 'javascript:alert(1)"><b>', price: 1999, featured_image: "https://cdn.test/r.jpg?v=1" },
  ];

  it("renders related products, skipping tagged ones, with every field escaped", async () => {
    fetchMock.mockImplementation(async (url) => (String(url).startsWith("/recommendations") ? json({ products: recs }) : json({})));
    await mountStrip();
    click(triggerButton(0));
    await flush();
    const section = q("[data-reelup-recs]");
    expect(section.hidden).toBe(false);
    expect(fetchCalls("/recommendations")[0][0]).toBe("/recommendations/products.json?product_id=1&limit=8&intent=related");
    const cards = section.querySelectorAll<HTMLAnchorElement>(".reelup-rec");
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector(".reelup-rec__title")!.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(section.querySelector("img[onerror]")).toBeNull();
    expect(section.querySelector("b")).toBeNull();
    expect(cards[0].querySelector("img")!.getAttribute("src")).toBe("https://cdn.test/r.jpg?v=1&width=240");
    expect(cards[0].querySelector(".reelup-rec__price")!.textContent).toBe("$19.99");
  });

  it("ignores a slow response that lands after the shopper moved on", async () => {
    let resolveFirst: (r: Response) => void = () => {};
    fetchMock.mockImplementation((url) => {
      if (String(url).includes("product_id=1&")) return new Promise<Response>((r) => (resolveFirst = r));
      if (String(url).startsWith("/recommendations")) return Promise.resolve(json({ products: [] }));
      return Promise.resolve(json({}));
    });
    await mountStrip();
    click(triggerButton(0));
    click(q("[data-reelup-next]"));
    resolveFirst(json({ products: [{ id: 500, title: "Stale", url: "/p", price: 1, featured_image: null }] }));
    await flush();
    expect(q("[data-reelup-recs]").hidden).toBe(true);
    expect(q("[data-reelup-recs-row]").textContent).not.toContain("Stale");
  });

  it("is skipped when turned off, and fetched once per product", async () => {
    await mountStrip({ showRecommendations: false });
    click(triggerButton(0));
    await flush();
    expect(fetchCalls("/recommendations")).toHaveLength(0);

    resetPage();
    await mountStrip();
    click(triggerButton(0));
    click(q("[data-reelup-close]"));
    click(triggerButton(0));
    await flush();
    expect(fetchCalls("/recommendations")).toHaveLength(1);
  });

  it("a failed request leaves the section hidden", async () => {
    fetchMock.mockImplementation(async (url) => (String(url).startsWith("/recommendations") ? new Response("", { status: 500 }) : json({})));
    await mountStrip();
    click(triggerButton(0));
    await flush();
    expect(q("[data-reelup-recs]").hidden).toBe(true);
  });
});

describe("product moments", () => {
  const timedReels = [
    makeReel({ id: 11, title: "First", products: [makeProduct({ id: 1, title: "Linen shirt" }), makeProduct({ id: 2, title: "Tote" })], productTimes: { "1": 2, "2": 10 } }),
    makeReel({ id: 22, title: "Second", products: [makeProduct({ id: 3 })] }),
  ];
  const play = (time: number) => {
    const video = q<HTMLVideoElement>("video");
    Object.defineProperty(video, "currentTime", { configurable: true, value: time });
    video.dispatchEvent(new Event("timeupdate"));
  };
  const chip = () => q("[data-reelup-moment]");
  const rows = () => Array.from(viewer()!.querySelectorAll<HTMLElement>("[data-reelup-list] [data-reelup-product]"));

  it("pops each product up for five seconds at its time, in the caption's place, and lights up its row", async () => {
    await mountStrip({}, timedReels);
    click(triggerButton(0));
    play(1);
    expect(chip().hidden).toBe(true);
    play(2.2);
    expect(chip().hidden).toBe(false);
    expect(chip().querySelector(".reelup-moment__title")!.textContent).toBe("Linen shirt");
    expect(chip().querySelector(".reelup-moment__price")!.textContent).toBe("$25.00");
    expect(q("[data-reelup-player]").classList.contains("has-moment")).toBe(true);
    expect(rows().map((r) => r.classList.contains("is-moment"))).toEqual([true, false]);
    play(7.5);
    expect(chip().hidden).toBe(true);
    expect(q("[data-reelup-player]").classList.contains("has-moment")).toBe(false);
    play(11);
    expect(chip().querySelector(".reelup-moment__title")!.textContent).toBe("Tote");
    expect(rows().map((r) => r.classList.contains("is-moment"))).toEqual([false, true]);
  });

  it("a tap opens that product in the mobile sheet, focuses its add button and counts a product click", async () => {
    media.mobile = true;
    await mountStrip({}, timedReels);
    click(triggerButton(0));
    play(10.5);
    click(chip());
    expect(q("[data-reelup-panel]").dataset.state).toBe("open");
    expect(document.activeElement).toBe(rows()[1].querySelector("[data-reelup-add-to-cart]"));
    const clicks = fetchCalls("/apps/reels/analytics").map(fetchBody).filter((b) => b.eventType === "click_product");
    expect(clicks).toEqual([expect.objectContaining({ reelId: "gid://shopify/Metaobject/11" })]);
  });

  it("a reel without moments never shows one, and moving on clears the last reel's", async () => {
    await mountStrip({}, timedReels);
    click(triggerButton(0));
    play(2.5);
    click(q("[data-reelup-next]"));
    expect(chip().hidden).toBe(true);
    play(2.5);
    expect(chip().hidden).toBe(true);
    expect(q("[data-reelup-player]").classList.contains("has-moment")).toBe(false);
  });

  it("malformed times are ignored", async () => {
    await mountStrip({}, timedReels);
    triggerButton(0).closest<HTMLElement>("[data-reelup-trigger]")!.dataset.productTimes = "{oops";
    click(triggerButton(0));
    play(2.5);
    expect(chip().hidden).toBe(true);
  });
});
