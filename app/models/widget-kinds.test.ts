import { describe, expect, it } from "vitest";
import { resolveStyle, sanitizeStyle, WIDGET_KIND_META } from "./widget-kinds";

describe("sanitizeStyle", () => {
  it("product-tag options: sale badge is a boolean, after-add one of three", () => {
    expect(sanitizeStyle("CAROUSEL", { showSaleBadge: true, afterAdd: "checkout" })).toEqual({ showSaleBadge: true, afterAdd: "checkout" });
    expect(sanitizeStyle("CAROUSEL", { showSaleBadge: "yes", afterAdd: "/evil" })).toEqual({});
    // Existing widgets keep today's behaviour until the merchant chooses.
    expect(resolveStyle("CAROUSEL", {})).toMatchObject({ showSaleBadge: false, afterAdd: "stay" });
  });

  it("carousel card templates, header text and popup options", () => {
    expect(
      sanitizeStyle("CAROUSEL", {
        cardTemplate: "overlay",
        eyebrow: "  Shoppable reels ",
        subheading: "x".repeat(200),
        showCardBadge: true,
        badgeColor: "#C8102E",
        productImageSize: "large",
        productDetails: false,
      }),
    ).toEqual({
      cardTemplate: "overlay",
      eyebrow: "Shoppable reels",
      subheading: "x".repeat(160),
      showCardBadge: true,
      badgeColor: "#c8102e",
      productImageSize: "large",
      productDetails: false,
    });
    expect(sanitizeStyle("CAROUSEL", { cardTemplate: "fancy", productImageSize: "huge", badgeColor: "red" })).toEqual({});
    // Product page reels share them; other kinds don't.
    expect(sanitizeStyle("PRODUCT_PAGE_REELS", { cardTemplate: "overlay", productDetails: true })).toEqual({ cardTemplate: "overlay", productDetails: true });
    expect(sanitizeStyle("STORIES", { cardTemplate: "overlay", productDetails: true })).toEqual({});
    // Existing carousels keep their card look; the popup gets the new defaults.
    expect(resolveStyle("CAROUSEL", {})).toMatchObject({ cardTemplate: "title", productDetails: true, productImageSize: "large" });
  });

  it("carousel sizing and spacing clamp to their ranges; corners are square or rounded", () => {
    expect(
      sanitizeStyle("CAROUSEL", {
        headingSize: 200,
        subheadingSize: 2,
        cardGap: 0,
        sectionPaddingY: 40.4,
        sectionPaddingX: "x",
        triggerSize: 9999,
        popupCorners: "square",
      }),
    ).toEqual({ headingSize: 64, subheadingSize: 11, cardGap: 0, sectionPaddingY: 40, triggerSize: 340, popupCorners: "square" });
    expect(sanitizeStyle("CAROUSEL", { popupCorners: "oval" })).toEqual({});
    // Unset sizes stay unset (the storefront's responsive defaults).
    expect(resolveStyle("CAROUSEL", {}).headingSize).toBeUndefined();
    expect(resolveStyle("CAROUSEL", {}).popupCorners).toBe("square");
  });

  it("phone sizes are separate, clamped fields; header alignment is start or center", () => {
    expect(
      sanitizeStyle("PRODUCT_PAGE_REELS", {
        headingSizeMobile: 90,
        cardGapMobile: -4,
        columnsMobile: 5,
        triggerSizeMobile: 10,
        headerAlign: "center",
      }),
    ).toEqual({ headingSizeMobile: 64, cardGapMobile: 0, columnsMobile: 3, triggerSizeMobile: 140, headerAlign: "center" });
    expect(sanitizeStyle("CAROUSEL", { headerAlign: "right" })).toEqual({});
    // Cards per row on phones: whole or half cards, 1 to 3.
    expect(sanitizeStyle("CAROUSEL", { columnsMobile: 1.4 })).toEqual({ columnsMobile: 1.5 });
    expect(sanitizeStyle("CAROUSEL", { columnsMobile: 0 })).toEqual({ columnsMobile: 1 });
    expect(sanitizeStyle("CAROUSEL", { columnsMobile: "x" })).toEqual({});
    expect(resolveStyle("PRODUCT_PAGE_REELS", {})).toMatchObject({ headerAlign: "start", cardTemplate: "title", productImageSize: "large" });
    expect(resolveStyle("CAROUSEL", {})).toMatchObject({ headerAlign: "center" });
  });

  it("keeps only fields the kind uses", () => {
    const style = sanitizeStyle("REEL_POPS", { popShape: "circle", layoutMode: "grid", heading: "Hi" });
    expect(style).toEqual({ popShape: "circle" });
  });

  it("drops invalid enum values and malformed colors", () => {
    const style = sanitizeStyle("PRODUCT_PAGE_REELS", {
      layoutMode: "stack",
      cornerStyle: "wobbly",
      accentColor: "red",
      ctaColor: "#AABBCC",
    });
    expect(style).toEqual({ ctaColor: "#aabbcc" });
  });

  it("keeps an explicitly cleared theme color", () => {
    expect(sanitizeStyle("SINGLE_VIDEO", { backgroundColor: "" })).toEqual({ backgroundColor: "" });
  });

  it("clamps sizes to the kind's range and columns to 2–6", () => {
    const meta = WIDGET_KIND_META.STORIES;
    expect(sanitizeStyle("STORIES", { triggerSize: 9999 }).triggerSize).toBe(meta.sizeMax);
    expect(sanitizeStyle("CAROUSEL", { columns: 1 }).columns).toBe(2);
  });

  it("requires real booleans and trims text", () => {
    const style = sanitizeStyle("PRODUCT_PAGE_REELS", { showPrice: "false", heading: "  Watch  " });
    expect(style).toEqual({ heading: "Watch" });
  });

  it("returns an empty object for unknown kinds or non-object input", () => {
    expect(sanitizeStyle("GRID", { heading: "x" })).toEqual({});
    expect(sanitizeStyle("STORIES", "nope")).toEqual({});
  });
});

describe("resolveStyle", () => {
  it("layers stored values over the kind defaults", () => {
    const style = resolveStyle("CAROUSEL", { heading: "Looks" });
    expect(style.layoutMode).toBe("stack");
    expect(style.heading).toBe("Looks");
  });

  it("keeps stored false booleans", () => {
    expect(resolveStyle("PRODUCT_PAGE_REELS", { showPrice: false }).showPrice).toBe(false);
  });
});
