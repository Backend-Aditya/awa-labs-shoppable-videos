import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

// No real network: Shopify endpoints are mocked per test, media 404s.
async function mockShop(page: Page) {
  const adds: unknown[] = [];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/cart/add.js", async (route) => {
    adds.push(route.request().postDataJSON());
    await json(route, { items: [{ id: 701, quantity: 1 }] });
  });
  await page.route("**/cart.js", (route) => json(route, { item_count: 1, items: [] }));
  await page.route("**/recommendations/products.json**", (route) => json(route, { products: [] }));
  await page.route("**/apps/reels/analytics", (route) => json(route, { ok: true }));
  return { adds };
}

const viewer = (page: Page) => page.locator("dialog#reelup-lightbox");
const stripTrigger = (page: Page, title: string) => page.getByRole("button", { name: `Play video: ${title}` }).first();

// Headless Chromium has no native HLS and the harness has no real Stream
// manifests, so the HLS bridge is replaced with one that plays a local
// WebM. reel-hls.js returns early when window.ReelupHls already exists, so
// the rest of the runtime is exercised unchanged. (hls.js integration is
// covered by tests/storefront/hls.test.ts.) Tests tagged @real-hls keep
// the real bridge, i.e. the playback-error path.
async function playableVideo(page: Page) {
  await page.addInitScript(() => {
    const teardown = (video: HTMLVideoElement) => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
    (window as unknown as { ReelupHls: unknown }).ReelupHls = {
      attach: async (video: HTMLVideoElement) => {
        video.src = "/media/sample.webm";
      },
      teardown,
      stopLoading: () => {},
      prefetch: () => {},
      supportsNativeHls: () => true,
    };
  });
}

test.beforeEach(async ({ page }, info) => {
  if (!info.title.includes("@real-hls")) await playableVideo(page);
  await page.goto("/");
});

test("open the viewer from the filmstrip and move next / previous", async ({ page }) => {
  await mockShop(page);
  await stripTrigger(page, "Morning routine").click();
  const dialog = viewer(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#reelup-viewer-title")).toHaveText("Morning routine");
  await expect(dialog.locator("[data-reelup-count]")).toHaveText("1 of 3");

  await dialog.locator("[data-reelup-next]").click();
  await expect(dialog.locator("#reelup-viewer-title")).toHaveText("Styling tips");
  await page.keyboard.press("ArrowDown");
  await expect(dialog.locator("#reelup-viewer-title")).toHaveText("Unboxing");
  await expect(dialog.locator("[data-reelup-next]")).toBeDisabled();
  await dialog.locator("[data-reelup-prev]").click();
  await expect(dialog.locator("[data-reelup-count]")).toHaveText("2 of 3");
});

test("drag along the progress strip to seek; scroll over the video to change reels", async ({ page }) => {
  await mockShop(page);
  await stripTrigger(page, "Morning routine").click();
  const dialog = viewer(page);
  const video = dialog.locator("video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(0);
  await video.evaluate((v: HTMLVideoElement) => v.pause());

  const seek = dialog.getByRole("slider", { name: "Video progress" });
  const box = (await seek.boundingBox())!;
  // Start inside the visible strip: its ends sit under the player's rounded corners.
  await page.mouse.move(box.x + box.width * 0.25, box.y + 1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + 1, { steps: 4 });
  await page.mouse.up();
  const ratio = await video.evaluate((v: HTMLVideoElement) => v.currentTime / v.duration);
  expect(ratio).toBeGreaterThan(0.6);
  expect(ratio).toBeLessThan(0.9);
  // Seeking didn't toggle playback or close anything.
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#reelup-viewer-title")).toHaveText("Morning routine");

  const player = (await dialog.locator("[data-reelup-player]").boundingBox())!;
  await page.mouse.move(player.x + player.width / 2, player.y + player.height / 2);
  await page.mouse.wheel(0, 120);
  await expect(dialog.locator("#reelup-viewer-title")).toHaveText("Styling tips");
});

test("add to cart from the viewer posts the reel attribution", async ({ page }) => {
  const { adds } = await mockShop(page);
  await stripTrigger(page, "Morning routine").click();
  const product = viewer(page).locator('[data-reelup-list] [data-reelup-product][data-product-id="7"]');
  await product.locator("[data-reelup-variant]").selectOption("702");
  await expect(product.locator("[data-reelup-price]")).toHaveText("$52.00");
  await product.locator('[data-reelup-qty-step="1"]').click();
  await product.locator("[data-reelup-add-to-cart]").click();

  await expect(viewer(page).locator("[data-reelup-cart-status]")).toBeVisible();
  await expect(viewer(page).locator(".reelup-cart-message")).toHaveText("Added to your cart");
  expect(adds).toHaveLength(1);
  expect(adds[0]).toMatchObject({ items: [{ id: 702, quantity: 2, properties: { _reelup_reel_id: "gid://shopify/Metaobject/1" } }] });
});

test("a sold-out variant disables the add button", async ({ page }) => {
  await mockShop(page);
  await stripTrigger(page, "Morning routine").click();
  const product = viewer(page).locator('[data-reelup-list] [data-reelup-product][data-product-id="7"]');
  await product.locator("[data-reelup-variant]").selectOption("703");
  await expect(product.locator("[data-reelup-add-to-cart]")).toBeDisabled();
  await expect(product.locator("[data-reelup-add-to-cart]")).toHaveText("Sold out");
});

test("Escape closes the viewer and focus returns to the trigger", async ({ page }) => {
  await mockShop(page);
  const trigger = stripTrigger(page, "Styling tips");
  await trigger.click();
  await expect(viewer(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer(page)).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator("html")).not.toHaveClass(/reelup-locked/);
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the product panel is a bottom sheet: peek → open → peek", async ({ page }) => {
    await mockShop(page);
    await stripTrigger(page, "Morning routine").click();
    const panel = viewer(page).locator("[data-reelup-panel]");
    const head = viewer(page).locator("[data-reelup-panel-toggle]");
    await expect(panel).toHaveAttribute("data-state", "peek");
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await head.click();
    await expect(panel).toHaveAttribute("data-state", "open");
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await expect(panel.locator("[data-reelup-add-to-cart]").first()).toBeInViewport();
    await head.click();
    await expect(panel).toHaveAttribute("data-state", "peek");
  });
});

test("the story viewer advances on its own and closes after the last story", async ({ page }) => {
  await mockShop(page);
  await page.getByRole("button", { name: "Play video: Story one" }).click();
  const story = page.locator("dialog#reelup-story-viewer");
  await expect(story).toBeVisible();
  await expect(story.locator("#reelup-story-title")).toHaveText("Story one");
  await expect(story.locator(".reelup-story__segment")).toHaveCount(2);
  // storyDuration is 2s in the harness.
  await expect(story.locator("#reelup-story-title")).toHaveText("Story two", { timeout: 6_000 });
  await expect(story).toBeHidden({ timeout: 6_000 });
  await expect(page.locator('[data-reelup-story-group] [data-reelup-trigger].is-seen')).toHaveCount(2);
});

test("the story close button closes immediately", async ({ page }) => {
  await mockShop(page);
  await page.getByRole("button", { name: "Play video: Story one" }).click();
  const story = page.locator("dialog#reelup-story-viewer");
  await story.locator("[data-reelup-story-close]").click();
  await expect(story).toBeHidden();
});

test("?reelup= deep link opens that reel on load", async ({ page }) => {
  await mockShop(page);
  await page.goto("/products/linen-shirt?reelup=3");
  await expect(viewer(page)).toBeVisible();
  await expect(viewer(page).locator("#reelup-viewer-title")).toHaveText("Unboxing");
});

test("@real-hls a video that cannot play shows the error with a retry", async ({ page }) => {
  await mockShop(page);
  await stripTrigger(page, "Morning routine").click();
  const error = viewer(page).locator("[data-reelup-error]");
  await expect(error).toBeVisible();
  await expect(error.getByRole("button")).toBeVisible();
});

test.describe("mobile, video fails to play", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  // KNOWN BUG: when playback fails, the viewer's error overlay
  // (.reelup-viewer__error inside the player) sits over the mobile bottom
  // sheet's head and intercepts taps, so shoppers can't open the product
  // list of a reel that won't play. Remove test.fail once the overlay no
  // longer covers the sheet.
  test("@real-hls products stay reachable", async ({ page }) => {
    await mockShop(page);
    await stripTrigger(page, "Morning routine").click();
    await expect(viewer(page).locator("[data-reelup-error]")).toBeVisible();
    await viewer(page).locator("[data-reelup-panel-toggle]").click({ timeout: 3_000 });
    await expect(viewer(page).locator("[data-reelup-panel]")).toHaveAttribute("data-state", "open");
  });
});
