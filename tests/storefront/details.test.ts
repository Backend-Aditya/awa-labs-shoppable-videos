// The in-viewer product page (reel-lightbox.js "product details"): opened
// from the stacked carousel's viewer, fed by Shopify's /products/<handle>.js.
import { beforeEach, describe, expect, it } from "vitest";
import { makeProduct, makeReel, makeWidget } from "../support/storefront-fixtures.mjs";
import { click, defaultRoutes, fetchBody, fetchCalls, fetchMock, flush, json, mount, renderBlock, resetPage, viewer } from "./harness";

const chair = makeProduct({
  id: 1,
  title: "Antilia Chair",
  handle: "antilia-chair",
  variants: [
    { id: 101, title: "Black", price: 1699900, compare_at_price: 4249800, available: true },
    { id: 102, title: "Teak", price: 1799900, compare_at_price: null, available: false },
  ],
});

// What Shopify's Ajax endpoint returns for it (prices in cents).
const ajaxChair = {
  id: 1,
  title: "Antilia Chair",
  description: '<p>Solid wood.</p><table><tr><td>Brand</td><td>Furniselan</td></tr></table><script>window.pwned = 1</script><img src="x" onerror="window.pwned = 2"><a href="javascript:alert(1)">bad</a>',
  options: [{ name: "Color", position: 1, values: ["Black", "Teak"] }],
  images: ["//cdn.test/chair-1.jpg?v=1", "//cdn.test/chair-2.jpg?v=1"],
  media: [{ src: "//cdn.test/chair-1.jpg?v=1", alt: "Chair front" }],
  variants: [
    { id: 101, title: "Black", options: ["Black"], price: 1699900, compare_at_price: 4249800, available: true, featured_image: null },
    { id: 102, title: "Teak", options: ["Teak"], price: 1799900, compare_at_price: null, available: false, featured_image: { src: "//cdn.test/chair-2.jpg?v=1" } },
  ],
};

const reels = [0, 1, 2].map((i) => makeReel({ id: 11 + i, title: `Reel ${i}`, products: [chair] }));

async function mountCarousel(style: object = {}) {
  await mount(await renderBlock("stacked-carousel", { reels, widget: makeWidget({ style }) }));
}
const q = <E extends Element = HTMLElement>(selector: string) => viewer()!.querySelector<E>(selector)!;

// The deck's front card (a side card would only come forward).
const openReel = () => click(document.querySelector(".is-active .awa-sv-trigger__button") ?? document.querySelector(".awa-sv-trigger__button"));

async function openFirstProduct() {
  openReel();
  await flush();
  click(q("[data-awa-sv-list] .awa-sv-product__title"));
  await flush();
}

beforeEach(() => {
  resetPage();
  fetchMock.mockImplementation(async (url) =>
    String(url) === "/products/antilia-chair.js" ? json(ajaxChair) : defaultRoutes(String(url)),
  );
});

describe("product details inside the viewer", () => {
  it("tapping a product shows its gallery, price, options and description instead of leaving", async () => {
    await mountCarousel();
    await openFirstProduct();
    const panel = q("[data-awa-sv-panel]");
    const pdp = q("[data-awa-sv-pdp]");
    expect(panel.classList.contains("is-detail")).toBe(true);
    expect(pdp.hidden).toBe(false);
    expect(fetchCalls("/products/antilia-chair.js")).toHaveLength(1);
    expect(pdp.querySelector(".awa-sv-pdp__title")!.textContent).toBe("Antilia Chair");
    expect(pdp.querySelectorAll(".awa-sv-pdp__gallery img")).toHaveLength(2);
    expect(pdp.querySelector(".awa-sv-pdp__gallery img")!.getAttribute("alt")).toBe("Chair front");
    expect(pdp.querySelector("[data-awa-sv-pdp-price]")!.textContent).toBe("$16,999.00");
    expect(pdp.querySelector("[data-awa-sv-pdp-compare]")!.textContent).toBe("$42,498.00");
    const values = Array.from(pdp.querySelectorAll<HTMLButtonElement>(".awa-sv-pdp__value"));
    expect(values.map((b) => b.textContent)).toEqual(["Black", "Teak"]);
    expect(values[0].getAttribute("aria-pressed")).toBe("true");
    expect(values[1].classList.contains("is-unavailable")).toBe(true);
    expect(pdp.querySelector(".awa-sv-pdp__rte table")).not.toBeNull();
    expect(pdp.querySelector(".awa-sv-pdp__full")!.getAttribute("href")).toBe("/products/antilia-chair");
    expect(viewer()!.classList.contains("awa-sv-products--large")).toBe(true);
  });

  it("drops scripts, event handlers and javascript: links from the description", async () => {
    await mountCarousel();
    await openFirstProduct();
    const rte = q(".awa-sv-pdp__rte");
    expect(rte.querySelector("script")).toBeNull();
    expect(rte.querySelector("[onerror]")).toBeNull();
    expect(rte.querySelector("a")!.hasAttribute("href")).toBe(false);
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it("choosing an option updates price and stock; adding sends the chosen variant", async () => {
    await mountCarousel();
    await openFirstProduct();
    const add = q<HTMLButtonElement>(".awa-sv-pdp__add");
    expect(add.disabled).toBe(false);
    expect(add.dataset.variantId).toBe("101");
    click(q('.awa-sv-pdp__value[data-value="Teak"]'));
    expect(q("[data-awa-sv-pdp-price]").textContent).toBe("$17,999.00");
    expect(q<HTMLElement>("[data-awa-sv-pdp-compare]").hidden).toBe(true);
    expect(add.disabled).toBe(true);
    expect(add.textContent).toBe("Sold out");
    click(q('.awa-sv-pdp__value[data-value="Black"]'));
    click(add);
    await flush();
    const body = fetchBody(fetchCalls("/cart/add.js")[0] as [string, RequestInit]);
    expect(body.items[0]).toMatchObject({ id: 101, quantity: 1 });
    expect(body.items[0].properties._awa_sv_reel_id).toBe(viewer()!.dataset.awaSvReelId);
  });

  it("back returns to the product list; moving to another reel closes it too", async () => {
    await mountCarousel();
    await openFirstProduct();
    click(q("[data-awa-sv-pdp-back]"));
    expect(q("[data-awa-sv-panel]").classList.contains("is-detail")).toBe(false);
    expect(q("[data-awa-sv-pdp]").hidden).toBe(true);

    click(q("[data-awa-sv-list] .awa-sv-product__title"));
    await flush();
    click(q("[data-awa-sv-next]"));
    expect(q("[data-awa-sv-panel]").classList.contains("is-detail")).toBe(false);
  });

  it("is off when the merchant turns it off: product links leave as before", async () => {
    await mountCarousel({ productDetails: false, productImageSize: "compact" });
    openReel();
    await flush();
    const link = q<HTMLAnchorElement>("[data-awa-sv-list] .awa-sv-product__title");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(fetchCalls("/products/antilia-chair.js")).toHaveLength(0);
    expect(viewer()!.classList.contains("awa-sv-products--large")).toBe(false);
  });

  it("description can be hidden", async () => {
    await mountCarousel({ showDescription: false });
    await openFirstProduct();
    expect(q("[data-awa-sv-pdp]").querySelector(".awa-sv-pdp__desc")).toBeNull();
  });
});
