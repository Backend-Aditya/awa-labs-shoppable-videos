// snippets/reel-product-card.liquid, the product row cloned into every
// viewer and rendered inline by the featured-video block.
import { describe, expect, it } from "vitest";
import { makeProduct, multiVariantProduct } from "../support/storefront-fixtures.mjs";
import { renderDom } from "./helpers";

const card = (product: object, style: object = {}) => renderDom("reel-product-card", { product, style });

describe("reel-product-card", () => {
  it("multi-variant product: <select> with every variant, first available selected, sold-out suffix", async () => {
    const { $, $$ } = await card(multiVariantProduct());
    const select = $<HTMLSelectElement>("select[data-reelup-variant]")!;
    expect(select.getAttribute("aria-label")).toBe("Options for Linen Shirt");
    const options = $$<HTMLOptionElement>("option");
    expect(options.map((o) => o.value)).toEqual(["701", "702", "703"]);
    expect(options[0].selected).toBe(true);
    expect(options.map((o) => o.dataset.price)).toEqual(["$48.00", "$52.00", "$52.00"]);
    expect(options.map((o) => o.dataset.compare)).toEqual(["$60.00", "", ""]);
    expect(options.map((o) => o.dataset.available)).toEqual(["true", "true", "false"]);
    expect(options[2].textContent).toBe("Large · Sold out");
  });

  it("selects the first AVAILABLE variant when the first is sold out", async () => {
    const product = makeProduct({
      id: 3,
      variants: [
        { id: 31, title: "S", available: false },
        { id: 32, title: "M", available: true },
      ],
    });
    const { $ } = await card(product);
    expect($<HTMLSelectElement>("select")!.value).toBe("32");
    expect($("[data-reelup-add-to-cart]")!.dataset.variantId).toBe("32");
  });

  it("single default variant: no variant picker", async () => {
    const { $ } = await card(makeProduct({ id: 2 }));
    expect($("select")).toBeNull();
    expect($("[data-reelup-add-to-cart]")!.dataset.variantId).toBe("200");
  });

  it("price and compare-at price; compare hidden unless higher", async () => {
    const onSale = await card(multiVariantProduct());
    expect(onSale.$("[data-reelup-price]")!.textContent).toBe("$48.00");
    expect(onSale.$("[data-reelup-compare]")!.hasAttribute("hidden")).toBe(false);
    const regular = await card(makeProduct({ id: 2, variants: [{ id: 1, price: 1000, compare_at_price: 900 }] }));
    expect(regular.$("[data-reelup-compare]")!.hasAttribute("hidden")).toBe(true);
  });

  it("sold-out product: disabled button labelled Sold out", async () => {
    const { $ } = await card(makeProduct({ id: 4, variants: [{ id: 41, available: false }] }));
    const button = $<HTMLButtonElement>("[data-reelup-add-to-cart]")!;
    expect(button.disabled).toBe(true);
    expect(button.textContent!.trim()).toBe("Sold out");
  });

  it("available product: enabled button with the add/added/sold-out labels for JS", async () => {
    const { $ } = await card(makeProduct({ id: 2 }));
    const button = $<HTMLButtonElement>("[data-reelup-add-to-cart]")!;
    expect(button.disabled).toBe(false);
    expect(button.textContent!.trim()).toBe("Add to cart");
    expect(button.dataset).toMatchObject({ addLabel: "Add to cart", addedLabel: "Added", soldOutLabel: "Sold out" });
  });

  it("custom CTA label is escaped in text and attribute", async () => {
    const { $, html } = await card(makeProduct({ id: 2 }), { ctaLabel: `Buy "now" <b>` });
    const button = $("[data-reelup-add-to-cart]")!;
    expect(button.textContent!.trim()).toBe(`Buy "now" <b>`);
    expect(button.dataset.addLabel).toBe(`Buy "now" <b>`);
    expect(html).not.toContain("<b>");
  });

  it("product title is escaped", async () => {
    const { $, html } = await card(makeProduct({ id: 2, title: `<img src=x onerror=alert(1)>` }));
    expect($(".reelup-product__title")!.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img src=x");
  });

  it("variant titles are escaped", async () => {
    const product = makeProduct({ id: 5, variants: [{ id: 1, title: `<i>S</i>` }, { id: 2, title: "M" }] });
    const { html, $$ } = await card(product);
    expect($$("option")[0].textContent).toBe("<i>S</i>");
    expect(html).not.toContain("<i>S</i>");
  });

  it("style toggles: price, image, quantity stepper", async () => {
    const plain = await card(multiVariantProduct(), { showPrice: false, showProductImage: false });
    expect(plain.$("[data-reelup-price]")).toBeNull();
    expect(plain.$(".reelup-product__media")).toBeNull();
    expect(plain.$("[data-reelup-qty]")).toBeNull();

    const full = await card(multiVariantProduct(), { showQuantity: true });
    expect(full.$(".reelup-product__media img")!.getAttribute("src")).toBe("https://cdn.test/products/7.jpg?width=192");
    expect(full.$<HTMLInputElement>("[data-reelup-qty-input]")!.value).toBe("1");
    expect(full.$$("[data-reelup-qty-step]").map((b) => b.dataset.reelupQtyStep)).toEqual(["-1", "1"]);
  });

  it("no image → no media link", async () => {
    const { $ } = await card(makeProduct({ id: 2, image: null }));
    expect($(".reelup-product__media")).toBeNull();
  });

  it("renders nothing for a product without variants", async () => {
    const { html } = await card({ ...makeProduct({ id: 2 }), selected_or_first_available_variant: null });
    expect(html.trim()).toBe("");
  });

  describe("sale badge", () => {
    const onSale = (price: number, compare: number) =>
      makeProduct({ id: 9, variants: [{ id: 91, title: "Default Title", price, compare_at_price: compare }] });

    it.each([
      [4800, 6000, "−20%"],
      [4001, 5000, "−20%"], // 19.98% rounds up
      [4026, 5000, "−19%"], // 19.48% rounds down
      [100, 300, "−67%"],
    ])("%i on %i shows %s", async (price, compare, text) => {
      const { $ } = await card(onSale(price, compare), { showSaleBadge: true });
      expect($("[data-reelup-badge]")!.textContent).toBe(text);
      expect($("[data-reelup-badge]")!.getAttribute("aria-hidden")).toBe("true");
    });

    it("is off unless the merchant turns it on, and never without prices", async () => {
      expect((await card(onSale(4800, 6000))).$("[data-reelup-badge]")).toBeNull();
      expect((await card(onSale(4800, 6000), { showSaleBadge: true, showPrice: false })).$("[data-reelup-badge]")).toBeNull();
    });

    it("stays in the markup, hidden, for a full-price variant the picker may switch away from", async () => {
      const { $, $$ } = await card(multiVariantProduct(), { showSaleBadge: true });
      expect($("[data-reelup-badge]")!.hidden).toBe(false);
      expect($$<HTMLOptionElement>("option").map((o) => o.dataset.discount ?? null)).toEqual(["20", null, null]);

      const fullPrice = await card(makeProduct({ id: 4 }), { showSaleBadge: true });
      expect(fullPrice.$("[data-reelup-badge]")!.hidden).toBe(true);
    });
  });
});
