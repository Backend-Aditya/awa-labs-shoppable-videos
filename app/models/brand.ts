// Shop-wide brand kit: the colours and viewer look every widget inherits
// unless a widget sets its own. Client-safe (no Prisma) so the Settings
// page, the widget editor and its preview share one set of defaults.

export interface BrandConfig {
  accentColor: string;
  buttonColor: string;
  buttonTextColor: string;
  salePriceColor: string;
  viewerTheme: "dark" | "light";
  fontFamily: "theme" | "system";
}

export const BRAND_DEFAULTS: BrandConfig = {
  accentColor: "#141414",
  buttonColor: "#141414",
  buttonTextColor: "#ffffff",
  salePriceColor: "#b42318",
  viewerTheme: "dark",
  fontFamily: "theme",
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function resolveBrand(input: unknown): BrandConfig {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const color = (key: keyof BrandConfig) => {
    const value = raw[key];
    return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : (BRAND_DEFAULTS[key] as string);
  };
  return {
    accentColor: color("accentColor"),
    buttonColor: color("buttonColor"),
    buttonTextColor: color("buttonTextColor"),
    salePriceColor: color("salePriceColor"),
    viewerTheme: raw.viewerTheme === "light" ? "light" : "dark",
    fontFamily: raw.fontFamily === "system" ? "system" : "theme",
  };
}
