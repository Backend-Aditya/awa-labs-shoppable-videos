import { describe, expect, it } from "vitest";
import { BRAND_DEFAULTS, resolveBrand } from "./brand";

describe("resolveBrand", () => {
  it.each([undefined, null, "x", 42, []])("falls back to defaults for %j", (input) => {
    expect(resolveBrand(input)).toEqual(BRAND_DEFAULTS);
  });

  it("keeps valid hex colors (lower-cased) and known enum values", () => {
    expect(
      resolveBrand({
        accentColor: "#ABCDEF",
        buttonColor: "#000000",
        buttonTextColor: "#ffffff",
        salePriceColor: "#ff0000",
        viewerTheme: "light",
        fontFamily: "system",
      }),
    ).toEqual({
      accentColor: "#abcdef",
      buttonColor: "#000000",
      buttonTextColor: "#ffffff",
      salePriceColor: "#ff0000",
      viewerTheme: "light",
      fontFamily: "system",
    });
  });

  it("drops invalid values field by field", () => {
    const brand = resolveBrand({ accentColor: "red", buttonColor: "#12345", viewerTheme: "neon", fontFamily: 3, salePriceColor: "#00ff00" });
    expect(brand).toEqual({ ...BRAND_DEFAULTS, salePriceColor: "#00ff00" });
  });
});
