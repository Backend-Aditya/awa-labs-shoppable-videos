import { describe, expect, it } from "vitest";
import { resolveStyle, sanitizeStyle, WIDGET_KIND_META } from "./widget-kinds";

describe("sanitizeStyle", () => {
  it("product-tag options: sale badge is a boolean, after-add one of three", () => {
    expect(sanitizeStyle("CAROUSEL", { showSaleBadge: true, afterAdd: "checkout" })).toEqual({ showSaleBadge: true, afterAdd: "checkout" });
    expect(sanitizeStyle("CAROUSEL", { showSaleBadge: "yes", afterAdd: "/evil" })).toEqual({});
    // Existing widgets keep today's behaviour until the merchant chooses.
    expect(resolveStyle("CAROUSEL", {})).toMatchObject({ showSaleBadge: false, afterAdd: "stay" });
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
