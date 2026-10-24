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

async function mockShop(page: Page) {
  await page.route("**/apps/reels/analytics", (route) => route.fulfill({ status: 204, body: "" }));
  await page.route("**/recommendations/**", (route) => route.fulfill({ json: { products: [] } }));
  // Fixture product images point at a host that doesn't exist.
  await page.route("https://cdn.test/**", (route) => route.fulfill({ status: 204, body: "" }));
}

// What a shopper taps in each widget to watch.
const OPENERS = {
  "product page reels": "[data-reelup-strip] .reelup-trigger__button",
  stories: ".reelup-stories [data-reelup-trigger] .reelup-trigger__button, [data-reelup-story-trigger]",
  "stacked carousel": ".reelup-deck__card.is-active .reelup-trigger__button",
  "featured video": ".reelup-feature .reelup-trigger__button",
  "add-to-cart video": ".reelup-atc .reelup-trigger__button",
  "floating video": ".reelup-pop__player",
} as const;

const openDialog = (page: Page) => page.locator("dialog[open]");

for (const [device, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test.describe(`every widget on ${device}`, () => {
    test.use({ viewport });

    test("opens its viewer and closes it, with no errors or sideways scroll", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await playableVideo(page);
      await mockShop(page);
      await page.goto("/pages/all-widgets");

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      for (const [widget, selector] of Object.entries(OPENERS)) {
        await test.step(widget, async () => {
          const opener = page.locator(selector).first();
          await opener.scrollIntoViewIfNeeded();
          await opener.click();
          await expect(openDialog(page), `${widget} opens the viewer`).toHaveCount(1);
          await page.keyboard.press("Escape");
          await expect(openDialog(page), `${widget}'s viewer closes`).toHaveCount(0);
        });
      }
      expect(errors).toEqual([]);
    });
  });
}
