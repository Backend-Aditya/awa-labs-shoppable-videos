// reel-tracking.js (Shopify customer events, connected page tags, consent,
// Microsoft Clarity) and the metrics the viewers report to the app's own
// analytics (add to cart, completion, watch time).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeProduct, makeReel, makeWidget } from "../support/storefront-fixtures.mjs";
import { click, defaultRoutes, fetchBody, fetchCalls, fetchMock, flush, mount, renderBlock, resetPage, viewer } from "./harness";

type Win = Window & Record<string, unknown>;
const win = window as unknown as Win;

const reels = [
  makeReel({ id: 11, title: "First", products: [makeProduct({ id: 1 })] }),
  makeReel({ id: 22, title: "Second", products: [makeProduct({ id: 2 })] }),
];

const publish = vi.fn();
function shopifyGlobal({ analytics = true, marketing = true, withApi = true } = {}) {
  const privacy = { analyticsProcessingAllowed: () => analytics, marketingAllowed: () => marketing };
  win.Shopify = {
    shop: "test.myshopify.com",
    analytics: { publish },
    ...(withApi
      ? {
          loadFeatures: (_features: unknown, callback: (error?: unknown) => void) => {
            (win.Shopify as Record<string, unknown>).customerPrivacy = privacy;
            callback();
          },
        }
      : {}),
  };
  return privacy;
}

async function mountStrip(tracking: object | null = {}) {
  const html = await renderBlock("product-page-reels", { reels, product: makeProduct({ id: 1 }), widget: makeWidget() });
  await mount(html, ["tracking", "lightbox", "story", "trigger", "pop"], { tracking });
}
const play = (i = 0) => click(document.querySelectorAll<HTMLButtonElement>("[data-reelup-trigger] .reelup-trigger__button")[i]);
const published = (name: string) => publish.mock.calls.filter(([n]) => n === name).map(([, data]) => data);
// Answers /cart/add.js with `response`; everything else as the harness does.
function cartAddResponds(response: () => Response) {
  fetchMock.mockImplementation(async (url) => (String(url).startsWith("/cart/add.js") ? response() : defaultRoutes(String(url))));
}
const appEvents = (type: string) =>
  fetchCalls("/apps/reels/analytics")
    .map(fetchBody)
    .filter((b) => b.eventType === type);

beforeEach(() => {
  resetPage();
  publish.mockReset();
  shopifyGlobal();
});
afterEach(() => {
  for (const key of ["Shopify", "gtag", "fbq", "ttq", "pintrk", "klaviyo", "dataLayer", "clarity"]) delete win[key];
});

describe("Shopify customer events", () => {
  it("publishes a namespaced event with the reel, its title and the widget it came from", async () => {
    await mountStrip();
    play(0);
    expect(published("reelup_video_view")).toEqual([{ reel_id: "11", reel_title: "First", widget: "product_page_reels" }]);
  });

  it("can be switched off", async () => {
    await mountStrip({ shopifyEvents: false });
    play(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("still publishes when the visitor declined tracking (Shopify applies consent to pixels)", async () => {
    shopifyGlobal({ analytics: false, marketing: false });
    await mountStrip();
    play(0);
    expect(published("reelup_video_view")).toHaveLength(1);
  });
});

describe("connected page tags", () => {
  it("forward only to the tools the merchant switched on, in each tool's naming", async () => {
    win.gtag = vi.fn();
    win.fbq = vi.fn();
    win.ttq = { track: vi.fn() };
    win.pintrk = vi.fn();
    win.klaviyo = { push: vi.fn() };
    await mountStrip({ ga4: true, gtm: true, meta: true, tiktok: false, pinterest: true, klaviyo: true });
    play(0);
    const data = { reel_id: "11", reel_title: "First", widget: "product_page_reels" };
    expect(win.gtag).toHaveBeenCalledWith("event", "reelup_video_view", data);
    expect(win.dataLayer).toEqual([{ event: "reelup_video_view", reelup: data }]);
    expect(win.fbq).toHaveBeenCalledWith("trackCustom", "ReelupVideoView", data);
    expect((win.ttq as { track: ReturnType<typeof vi.fn> }).track).not.toHaveBeenCalled();
    expect(win.pintrk).toHaveBeenCalledWith("track", "custom", { ...data, event_name: "reelup_video_view" });
    expect((win.klaviyo as { push: ReturnType<typeof vi.fn> }).push).toHaveBeenCalledWith(["track", "Viewed Shoppable Video", data]);
  });

  it("respect consent: analytics tools need analytics consent, ad tools marketing consent", async () => {
    shopifyGlobal({ analytics: true, marketing: false });
    win.gtag = vi.fn();
    win.fbq = vi.fn();
    await mountStrip({ ga4: true, meta: true });
    play(0);
    expect(win.gtag).toHaveBeenCalled();
    expect(win.fbq).not.toHaveBeenCalled();
  });

  it("hold events until the Customer Privacy API answers, then send what consent allows", async () => {
    let answer: (error?: unknown) => void = () => {};
    win.Shopify = { analytics: { publish }, loadFeatures: (_f: unknown, cb: (error?: unknown) => void) => (answer = cb) };
    win.gtag = vi.fn();
    await mountStrip({ ga4: true });
    play(0);
    expect(win.gtag).not.toHaveBeenCalled();
    (win.Shopify as Record<string, unknown>).customerPrivacy = { analyticsProcessingAllowed: () => true, marketingAllowed: () => false };
    answer();
    expect(win.gtag).toHaveBeenCalledWith("event", "reelup_video_view", expect.objectContaining({ reel_id: "11" }));
  });

  it("send nothing to third parties when consent can't be read", async () => {
    win.Shopify = { analytics: { publish }, loadFeatures: (_f: unknown, cb: (error?: unknown) => void) => cb(new Error("blocked")) };
    win.gtag = vi.fn();
    await mountStrip({ ga4: true });
    play(0);
    expect(win.gtag).not.toHaveBeenCalled();
    expect(published("reelup_video_view")).toHaveLength(1);
  });

  it("a broken tag never breaks the widget", async () => {
    win.gtag = () => {
      throw new Error("tag crashed");
    };
    win.fbq = vi.fn();
    await mountStrip({ ga4: true, meta: true });
    play(0);
    expect(viewer()!.open).toBe(true);
    expect(win.fbq).toHaveBeenCalled();
  });
});

describe("Microsoft Clarity", () => {
  const claritySrc = () => document.head.querySelector<HTMLScriptElement>('script[src^="https://www.clarity.ms/tag/"]')?.src;

  it("is installed with analytics consent and a valid project id, and tags video sessions", async () => {
    await mountStrip({ clarityId: "abc123xyz" });
    expect(claritySrc()).toBe("https://www.clarity.ms/tag/abc123xyz");
    play(0);
    const queue = (win.clarity as unknown as { q: unknown[][] }).q.map((args) => Array.from(args as ArrayLike<unknown>));
    expect(queue).toContainEqual(["event", "reelup_video_view"]);
    expect(queue).toContainEqual(["set", "reelup_reel", "First"]);
  });

  it("is not installed without analytics consent, with a malformed id, or when the store already runs it", async () => {
    shopifyGlobal({ analytics: false });
    await mountStrip({ clarityId: "abc123xyz" });
    expect(claritySrc()).toBeUndefined();

    resetPage();
    shopifyGlobal();
    await mountStrip({ clarityId: 'x"><script>' });
    expect(claritySrc()).toBeUndefined();

    resetPage();
    shopifyGlobal();
    const existing = vi.fn();
    win.clarity = existing;
    await mountStrip({ clarityId: "abc123xyz" });
    expect(claritySrc()).toBeUndefined();
    play(0);
    expect(existing).toHaveBeenCalledWith("event", "reelup_video_view");
  });

  it("starts once the shopper accepts in the cookie banner, and is told when they withdraw", async () => {
    const privacy = shopifyGlobal({ analytics: false });
    await mountStrip({ clarityId: "abc123xyz" });
    expect(claritySrc()).toBeUndefined();
    privacy.analyticsProcessingAllowed = () => true;
    document.dispatchEvent(new CustomEvent("visitorConsentCollected"));
    expect(claritySrc()).toBe("https://www.clarity.ms/tag/abc123xyz");
    privacy.analyticsProcessingAllowed = () => false;
    document.dispatchEvent(new CustomEvent("visitorConsentCollected"));
    const queue = (win.clarity as unknown as { q: unknown[][] }).q.map((args) => Array.from(args as ArrayLike<unknown>));
    expect(queue).toContainEqual(["consent", false]);
  });
});

describe("shopper metrics", () => {
  it("a successful add to cart is counted and published with variant, quantity and value", async () => {
    await mountStrip();
    play(0);
    cartAddResponds(() => new Response(JSON.stringify({ items: [{ id: 100, product_id: 1, price: 2500, final_line_price: 2500 }] }), { status: 200 }));
    click(viewer()!.querySelector("[data-reelup-add-to-cart]"));
    await flush();
    expect(appEvents("add_to_cart")).toEqual([
      { shopDomain: "test.myshopify.com", reelId: "gid://shopify/Metaobject/11", eventType: "add_to_cart" },
    ]);
    expect(published("reelup_add_to_cart")).toEqual([
      { reel_id: "11", reel_title: "First", widget: "product_page_reels", product_id: "1", variant_id: "100", quantity: 1, value: 25, currency: "USD" },
    ]);
  });

  it("a failed add to cart is not counted", async () => {
    await mountStrip();
    play(0);
    cartAddResponds(() => new Response(JSON.stringify({ description: "Sold out" }), { status: 422 }));
    click(viewer()!.querySelector("[data-reelup-add-to-cart]"));
    await flush();
    expect(appEvents("add_to_cart")).toEqual([]);
    expect(published("reelup_add_to_cart")).toEqual([]);
  });

  function drive(video: HTMLVideoElement, duration: number) {
    let time = 0;
    Object.defineProperty(video, "duration", { configurable: true, value: duration });
    Object.defineProperty(video, "currentTime", { configurable: true, get: () => time, set: (v: number) => (time = v) });
    return (to: number, event = "timeupdate") => {
      time = to;
      video.dispatchEvent(new Event(event));
    };
  }

  it("watch time counts real playback only, and is reported when the shopper moves on", async () => {
    await mountStrip();
    play(0);
    const video = viewer()!.querySelector("video")!;
    const at = drive(video, 60);
    for (let t = 0; t <= 10; t += 0.5) at(t);
    at(40, "seeking"); // jump ahead: not watched
    at(40);
    for (let t = 40; t <= 44; t += 0.5) at(t);
    expect(appEvents("watch")).toEqual([]);
    click(viewer()!.querySelector("[data-reelup-next]"));
    expect(appEvents("watch")).toEqual([
      { shopDomain: "test.myshopify.com", reelId: "gid://shopify/Metaobject/11", eventType: "watch", seconds: 14 },
    ]);
    // Closing reports the next reel's time; nothing below a second.
    click(viewer()!.querySelector("[data-reelup-close]"));
    expect(appEvents("watch")).toHaveLength(1);
  });

  it("completion counts once at 95%, then not again within 30 minutes", async () => {
    await mountStrip();
    play(0);
    const video = viewer()!.querySelector("video")!;
    const at = drive(video, 20);
    at(18.9); // 94.5%
    expect(appEvents("complete")).toHaveLength(0);
    at(19);
    expect(appEvents("complete")).toHaveLength(1);
    expect(published("reelup_video_complete")).toEqual([{ reel_id: "11", reel_title: "First", widget: "product_page_reels" }]);
    at(19.5);
    video.dispatchEvent(new Event("ended"));
    click(viewer()!.querySelector("[data-reelup-close]"));
    play(0);
    const again = drive(viewer()!.querySelector("video")!, 20);
    again(19.9);
    expect(appEvents("complete")).toHaveLength(1);
  });

  it("the story viewer reports completion and watch time too", async () => {
    const html = await renderBlock("insta-stories", { reels, widget: makeWidget({ style: { storyDuration: 60 } }) });
    await mount(html, ["tracking", "lightbox", "story", "trigger", "pop"], { tracking: {} });
    click(document.querySelector("[data-reelup-story-group] .reelup-trigger__button"));
    const dialog = document.getElementById("reelup-story-viewer")!;
    const at = drive(dialog.querySelector("video")!, 10);
    for (let i = 0; i <= 24; i++) at(i * 0.4); // to 9.6 s of 10
    expect(appEvents("complete")).toHaveLength(1);
    expect(published("reelup_video_complete")[0]).toMatchObject({ reel_id: "11", widget: "stories" });
    click(dialog.querySelector("[data-reelup-story-close]"));
    expect(appEvents("watch")).toEqual([
      { shopDomain: "test.myshopify.com", reelId: "gid://shopify/Metaobject/11", eventType: "watch", seconds: 10 },
    ]);
  });
});
