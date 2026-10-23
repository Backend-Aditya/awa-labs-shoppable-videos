// Delegated product-card behaviour from reel-lightbox.js: variant picker,
// quantity stepper, add to cart, error surfacing and theme cart refresh.
// Markup is the real featured-video block (inline product list).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { makeProduct, makeReel, makeWidget, multiVariantProduct } from "../support/storefront-fixtures.mjs";
import { click, defaultRoutes as defaultRoutesFor, fetchBody, fetchCalls, fetchMock, flush, json, mount, renderBlock, resetPage, viewer } from "./harness";

const REEL_ID = "gid://shopify/Metaobject/55";

async function mountCards(style: object = {}, products = [multiVariantProduct(), makeProduct({ id: 2 })]) {
  const reel = makeReel({ id: 55, products });
  await mount(await renderBlock("single-video", { reel, widget: makeWidget({ style }) }), ["lightbox"]);
}

const card = (productId: number) => document.querySelector<HTMLElement>(`[data-reelup-product][data-product-id="${productId}"]`)!;
const addButton = (productId: number) => card(productId).querySelector<HTMLButtonElement>("[data-reelup-add-to-cart]")!;
const status = () => document.querySelector<HTMLElement>("[data-reelup-cart-status]")!;

beforeEach(() => {
  resetPage();
});

describe("variant picker", () => {
  it("updates price, compare-at, button variant and availability", async () => {
    await mountCards();
    const select = card(7).querySelector<HTMLSelectElement>("[data-reelup-variant]")!;
    const price = card(7).querySelector("[data-reelup-price]")!;
    const compare = card(7).querySelector<HTMLElement>("[data-reelup-compare]")!;

    select.value = "702";
    fireEvent.change(select);
    expect(price.textContent).toBe("$52.00");
    expect(compare.hidden).toBe(true);
    expect(addButton(7).dataset.variantId).toBe("702");
    expect(addButton(7).disabled).toBe(false);
    expect(addButton(7).textContent).toBe("Add to cart");

    select.value = "703";
    fireEvent.change(select);
    expect(addButton(7).disabled).toBe(true);
    expect(addButton(7).textContent).toBe("Sold out");

    select.value = "701";
    fireEvent.change(select);
    expect(compare.hidden).toBe(false);
    expect(compare.textContent).toBe("$60.00");
    expect(addButton(7).textContent).toBe("Add to cart");
  });
});

describe("quantity stepper", () => {
  it("steps within 1–99", async () => {
    await mountCards({ showQuantity: true });
    const input = card(2).querySelector<HTMLInputElement>("[data-reelup-qty-input]")!;
    const [minus, plus] = card(2).querySelectorAll("[data-reelup-qty-step]");
    click(minus);
    expect(input.value).toBe("1");
    click(plus);
    click(plus);
    expect(input.value).toBe("3");
    input.value = "99";
    click(plus);
    expect(input.value).toBe("99");
    input.value = "abc";
    click(plus);
    expect(input.value).toBe("2");
  });
});

describe("add to cart", () => {
  it("posts an items array with quantity from the stepper and the hidden reel property", async () => {
    await mountCards({ showQuantity: true });
    const plus = card(2).querySelectorAll("[data-reelup-qty-step]")[1];
    click(plus);
    click(plus);
    click(addButton(2));
    await flush();

    const [call] = fetchCalls("/cart/add.js");
    expect(call[1]).toMatchObject({ method: "POST" });
    expect((call[1]!.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(fetchBody(call)).toEqual({
      items: [{ id: 200, quantity: 3, properties: { _reelup_reel_id: REEL_ID } }],
      sections: "cart-icon-bubble,cart-drawer,cart-notification-button,cart-live-region-text",
      sections_url: "/products/linen-shirt",
    });
  });

  it("clamps a typed quantity and defaults to 1 without a stepper", async () => {
    await mountCards({ showQuantity: true });
    card(2).querySelector<HTMLInputElement>("[data-reelup-qty-input]")!.value = "500";
    click(addButton(2));
    await flush();
    expect(fetchBody(fetchCalls("/cart/add.js")[0]).items[0].quantity).toBe(99);

    resetPage();
    await mountCards();
    click(addButton(2));
    await flush();
    expect(fetchBody(fetchCalls("/cart/add.js")[0]).items[0].quantity).toBe(1);
  });

  it("uses the variant chosen in the picker", async () => {
    await mountCards();
    const select = card(7).querySelector<HTMLSelectElement>("[data-reelup-variant]")!;
    select.value = "702";
    fireEvent.change(select);
    click(addButton(7));
    await flush();
    expect(fetchBody(fetchCalls("/cart/add.js")[0]).items[0].id).toBe(702);
  });

  it("on success: Added state, status message, analytics click, theme cart events, then resets", async () => {
    const events: string[] = [];
    document.addEventListener("cart:refresh", () => events.push("refresh"));
    document.addEventListener("cart:updated", (e) => events.push(`updated:${(e as CustomEvent).detail.cart.item_count}`));
    const publish = vi.fn();
    Object.assign(window, { publish, PUB_SUB_EVENTS: { cartUpdate: "cart-update" } });
    document.body.insertAdjacentHTML("beforeend", "");
    await mountCards();

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      click(addButton(2));
      expect(addButton(2).dataset.state).toBe("loading");
      expect(addButton(2).getAttribute("aria-busy")).toBe("true");
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      expect(addButton(2).dataset.state).toBe("added");
      expect(addButton(2).textContent).toBe("Added");
      expect(addButton(2).hasAttribute("aria-busy")).toBe(false);
      expect(status().hidden).toBe(false);
      expect(status().hasAttribute("data-failed")).toBe(false);
      expect(status().textContent).toContain("Added to your cart");
      expect(events).toEqual(["refresh", "updated:3"]);
      expect(publish).toHaveBeenCalledWith("cart-update", expect.objectContaining({ source: "reelup" }));
      const analytics = fetchCalls("/apps/reels/analytics").map(fetchBody);
      expect(analytics).toContainEqual(expect.objectContaining({ reelId: REEL_ID, eventType: "click_product" }));

      await vi.advanceTimersByTimeAsync(2200);
      expect(addButton(2).dataset.state).toBe("");
      expect(addButton(2).textContent).toBe("Add to cart");
    } finally {
      vi.useRealTimers();
      delete (window as unknown as Record<string, unknown>).publish;
      delete (window as unknown as Record<string, unknown>).PUB_SUB_EVENTS;
    }
  });

  it("surfaces Shopify's description on a failed add and restores the button", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).startsWith("/cart/add.js") ? json({ status: 422, description: "You can only add 2 of Linen Shirt" }, 422) : json({}),
    );
    await mountCards();
    click(addButton(2));
    await flush();
    expect(status().hidden).toBe(false);
    expect(status().hasAttribute("data-failed")).toBe(true);
    expect(status().textContent).toContain("You can only add 2 of Linen Shirt");
    expect(addButton(2).dataset.state).toBe("");
    expect(addButton(2).textContent).toBe("Add to cart");
    expect(addButton(2).hasAttribute("aria-busy")).toBe(false);
  });

  it("falls back to the generic message on a network error or non-JSON failure", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).startsWith("/cart/add.js")) return new Response("oops", { status: 500 });
      return json({});
    });
    await mountCards();
    click(addButton(2));
    await flush();
    expect(status().textContent).toContain("Couldn't add to cart. Try again.");

    fetchMock.mockImplementation(async (url) => {
      if (String(url).startsWith("/cart/add.js")) throw new TypeError("offline");
      return json({});
    });
    click(addButton(2));
    await flush();
    // Network errors never leak raw messages to shoppers.
    expect(status().textContent).toContain("Couldn't add to cart. Try again.");
    expect(status().textContent).not.toContain("offline");
  });

  it("a 5xx with a description still shows only the generic message", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).startsWith("/cart/add.js") ? json({ description: "Internal stack trace" }, 500) : json({}),
    );
    await mountCards();
    click(addButton(2));
    await flush();
    expect(status().textContent).toContain("Couldn't add to cart. Try again.");
    expect(status().textContent).not.toContain("stack trace");
  });

  it("asks for the theme's cart sections and hands them to a Dawn <cart-drawer>", async () => {
    const renderContents = vi.fn();
    const drawer = Object.assign(document.createElement("cart-drawer"), {
      renderContents,
      getSectionsToRender: () => [{ id: "cart-drawer" }, { id: "main-cart-footer" }],
    });
    drawer.classList.add("is-empty");
    fetchMock.mockImplementation(async (url) =>
      String(url).startsWith("/cart/add.js")
        ? json({ items: [{ id: 200, variant_id: 200 }], sections: { "cart-drawer": "<div>drawer</div>" } })
        : defaultRoutesFor(String(url)),
    );
    await mountCards();
    document.body.appendChild(drawer);
    click(addButton(2));
    await flush();
    expect(fetchBody(fetchCalls("/cart/add.js")[0]).sections).toBe(
      "cart-drawer,main-cart-footer,cart-icon-bubble,cart-notification-button,cart-live-region-text",
    );
    expect(renderContents).toHaveBeenCalledWith(expect.objectContaining({ id: 200, sections: { "cart-drawer": "<div>drawer</div>" } }));
    expect(drawer.classList.contains("is-empty")).toBe(false);
  });

  it("without a theme cart element, refreshes #cart-icon-bubble from the returned section", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).startsWith("/cart/add.js")
        ? json({ items: [{ id: 200 }], sections: { "cart-icon-bubble": '<div class="shopify-section"><span>5</span></div>' } })
        : defaultRoutesFor(String(url)),
    );
    await mountCards();
    document.body.insertAdjacentHTML("beforeend", '<a id="cart-icon-bubble"><span>0</span></a>');
    click(addButton(2));
    await flush();
    expect(document.getElementById("cart-icon-bubble")!.innerHTML).toBe("<span>5</span>");
  });

  it("ignores clicks on a disabled (sold-out) button and while loading", async () => {
    await mountCards({}, [makeProduct({ id: 4, variants: [{ id: 41, available: false }] }), makeProduct({ id: 2 })]);
    click(addButton(4));
    let release: (r: Response) => void = () => {};
    fetchMock.mockImplementation((url) =>
      String(url).startsWith("/cart/add.js") ? new Promise<Response>((r) => (release = r)) : Promise.resolve(json({})),
    );
    click(addButton(2));
    click(addButton(2));
    expect(fetchCalls("/cart/add.js")).toHaveLength(1);
    release(json({ items: [] }));
    await flush();
  });

  it("product links record a click_product event", async () => {
    await mountCards();
    card(2).querySelector<HTMLAnchorElement>(".reelup-product__title")!.addEventListener("click", (e) => e.preventDefault());
    click(card(2).querySelector(".reelup-product__title"));
    expect(fetchCalls("/apps/reels/analytics").map(fetchBody)).toEqual([
      { reelId: REEL_ID, eventType: "click_product" },
    ]);
  });
});

describe("sale badge and after-add actions", () => {
  async function mountStrip(style: object) {
    const reel = makeReel({ id: 11, title: "First", products: [multiVariantProduct(7)] });
    await mount(await renderBlock("product-page-reels", { reels: [reel], widget: makeWidget({ style }) }));
    click(document.querySelector("[data-reelup-trigger] .reelup-trigger__button"));
    return viewer()!;
  }
  const navigate = () => {
    const spy = vi.fn();
    (window as unknown as { ReelupViewer: { navigate: (url: string) => void } }).ReelupViewer.navigate = spy;
    return spy;
  };

  it("the sale badge follows the chosen variant", async () => {
    const dialog = await mountStrip({ showSaleBadge: true });
    const badge = dialog.querySelector<HTMLElement>("[data-reelup-badge]")!;
    expect(badge.textContent).toBe("−20%");
    const select = dialog.querySelector<HTMLSelectElement>("[data-reelup-variant]")!;
    select.value = "702";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(badge.hidden).toBe(true);
    select.value = "701";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("−20%");
  });

  it("no badge unless the merchant turned it on", async () => {
    const dialog = await mountStrip({});
    expect(dialog.querySelector("[data-reelup-badge]")).toBeNull();
  });

  it("'Keep watching' (default) stays in the viewer", async () => {
    const dialog = await mountStrip({});
    const go = navigate();
    click(dialog.querySelector("[data-reelup-add-to-cart]"));
    await flush();
    expect(go).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });

  it("'Checkout' goes to checkout once the add succeeds, not when it fails", async () => {
    const dialog = await mountStrip({ afterAdd: "checkout" });
    const go = navigate();
    fetchMock.mockImplementation(async (url) =>
      String(url).startsWith("/cart/add.js") ? json({ description: "Sold out" }, 422) : defaultRoutesFor(String(url)),
    );
    click(dialog.querySelector("[data-reelup-add-to-cart]"));
    await flush();
    expect(go).not.toHaveBeenCalled();
    fetchMock.mockImplementation(async (url) => defaultRoutesFor(String(url)));
    click(dialog.querySelector("[data-reelup-add-to-cart]"));
    await flush();
    expect(go).toHaveBeenCalledWith("/checkout");
  });

  it("'Show cart' reveals a Dawn-style cart drawer by closing the viewer", async () => {
    const dialog = await mountStrip({ afterAdd: "cart" });
    const renderContents = vi.fn();
    const drawer = document.createElement("cart-drawer") as HTMLElement & { renderContents: typeof renderContents };
    drawer.renderContents = renderContents;
    document.body.appendChild(drawer);
    fetchMock.mockImplementation(async (url) =>
      String(url).startsWith("/cart/add.js") ? json({ items: [{ id: 701 }], sections: { "cart-drawer": "<div></div>" } }) : defaultRoutesFor(String(url)),
    );
    const go = navigate();
    click(dialog.querySelector("[data-reelup-add-to-cart]"));
    await flush();
    expect(renderContents).toHaveBeenCalled();
    expect(dialog.open).toBe(false);
    expect(go).not.toHaveBeenCalled();
  });

  it("'Show cart' goes to the cart page on themes without a drawer", async () => {
    const dialog = await mountStrip({ afterAdd: "cart" });
    const go = navigate();
    click(dialog.querySelector("[data-reelup-add-to-cart]"));
    await flush();
    expect(go).toHaveBeenCalledWith("/cart");
  });
});
