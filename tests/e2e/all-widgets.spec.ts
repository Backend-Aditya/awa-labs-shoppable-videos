// Every widget, rendered from the real Liquid on one page, opens its viewer
// and closes again, without console errors or a page that scrolls sideways.
// storefront.spec.ts covers the viewers in depth; this guards the set.
import { expect, test, type Page } from "@playwright/test";

// Plays the local WebM instead of HLS (headless Chromium has none).
async function playableVideo(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { ReelupHls: unknown }).ReelupHls = {
      attach: async (video: HTMLVideoElement) => {
        video.src = "/media/sample.webm";
      },
      teardown: (video: HTMLVideoElement) => {
        video.pause();
        video.removeAttribute("src");
        video.load();
      },
      stopLoading: () => {},
      prefetch: () => {},
      supportsNativeHls: () => true,
    };
  });
}

// Answers the app's endpoints; returns the analytics events posted.
async function mockShop(page: Page) {
  const events: { eventType: string; source?: string }[] = [];
  await page.route("**/apps/reels/analytics", (route) => {
    events.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/recommendations/**", (route) => route.fulfill({ json: { products: [] } }));
  // Fixture product images point at a host that doesn't exist.
  await page.route("https://cdn.test/**", (route) => route.fulfill({ status: 204, body: "" }));
  return events;
}

// What a shopper taps in each widget to watch, and the widget name its
// events carry (the per-widget analytics key).
const OPENERS = {
  "product page reels": ["[data-reelup-strip] .reelup-trigger__button", "product_page_reels"],
  stories: [".reelup-stories [data-reelup-trigger] .reelup-trigger__button, [data-reelup-story-trigger]", "stories"],
  "stacked carousel": [".reelup-deck__card.is-active .reelup-trigger__button", "carousel"],
  "featured video": [".reelup-feature .reelup-trigger__button", "featured_video"],
  "add-to-cart video": [".reelup-atc .reelup-trigger__button", "add_to_cart_video"],
  "floating video": [".reelup-pop__player", "floating_video"],
} as const;

const openDialog = (page: Page) => page.locator("dialog[open]");

for (const [device, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test.describe(`every widget on ${device}`, () => {
    test.use({ viewport });

    test("opens its viewer and closes it, reports its views as its own, with no errors or sideways scroll", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await playableVideo(page);
      const events = await mockShop(page);
      await page.goto("/pages/all-widgets");

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      for (const [widget, [selector, source]] of Object.entries(OPENERS)) {
        await test.step(widget, async () => {
          const opener = page.locator(selector).first();
          await opener.scrollIntoViewIfNeeded();
          await opener.click();
          await expect(openDialog(page), `${widget} opens the viewer`).toHaveCount(1);
          await expect
            .poll(() => events.some((e) => e.eventType === "view" && e.source === source), { message: `${widget} reports a view as ${source}` })
            .toBe(true);
          await page.keyboard.press("Escape");
          await expect(openDialog(page), `${widget}'s viewer closes`).toHaveCount(0);
        });
      }
      expect(errors).toEqual([]);
    });
  });
}
