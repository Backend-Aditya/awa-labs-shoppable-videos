// A liquidjs engine that renders the theme app extension's blocks and
// snippets the way Shopify would, closely enough to test their logic.
// Used by the `liquid` Vitest project, the storefront jsdom tests (which
// render real snippet markup instead of hand-copied HTML) and the
// Playwright harness (tests/e2e/server.mjs).
//
// Shopify-Liquid features that liquidjs lacks, and how they are shimmed
// (keep TESTING.md › "Liquid shims" in sync):
//   {% doc %} / {% schema %}   block tags that render nothing
//   | t                         reads locales/en.default.json, `{{ var }}`
//                               interpolation, `count` pluralisation
//                               (one/other); missing keys render Shopify's
//                               "translation missing: en.<key>". Not escaped
//                               (blocks escape explicitly).
//   | money                     cents → "$1,234.50" (default shop format)
//   | image_url: width: N       "<src>?width=N" (src = string or image.src)
//   | asset_url                 "<assetBase>/<file>" (default /assets)
//   | stylesheet_tag            Shopify's <link rel="stylesheet"> markup
//   | color_brightness / color_lighten / color_darken   HSL maths
//   | divided_by                integer division when both operands are
//                               integers (Shopify); liquidjs returns floats
// Everything else (json, escape, default, round, modulo, times, split,
// append, replace, strip_newlines, render … for … as, {% liquid %}, `#`
// comments, echo, contains, blank) is liquidjs built-in.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Liquid, Tag, TypeGuards } from "liquidjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSION_DIR = path.resolve(here, "../../extensions/shoppable-video-widgets");
export const LOCALE = JSON.parse(readFileSync(path.join(EXTENSION_DIR, "locales/en.default.json"), "utf8"));

/** Matches the literal in every block/snippet (checked by scripts/check-reel-namespace.mjs). */
export const REEL_NAMESPACE =
  readFileSync(path.join(EXTENSION_DIR, "blocks/product-page-reels.liquid"), "utf8").match(
    /assign\s+reel_namespace\s*=\s*'([^']+)'/,
  )?.[1] ?? "app--404281098241";

// A block tag whose body is skipped entirely (not even parsed), the way
// Shopify treats {% doc %} and {% schema %}.
function silentBlock(name) {
  return class extends Tag {
    constructor(token, remainTokens, liquid, parser) {
      super(token, remainTokens, liquid, parser);
      while (remainTokens.length) {
        const next = remainTokens.shift();
        if (TypeGuards.isTagToken(next) && next.name === `end${name}`) return;
      }
      throw new Error(`tag {% ${name} %} not closed`);
    }
    *render() {}
  };
}

// liquidjs passes keyword filter arguments as [name, value] tuples.
function keywordArgs(args) {
  const named = {};
  for (const arg of args) if (Array.isArray(arg) && arg.length === 2 && typeof arg[0] === "string") named[arg[0]] = arg[1];
  return named;
}

export function translate(key, vars = {}, locale = LOCALE) {
  let value = String(key)
    .split(".")
    .reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), locale);
  if (value && typeof value === "object") {
    const count = Number(vars.count);
    value = count === 1 && "one" in value ? value.one : value.other;
  }
  if (typeof value !== "string") return `translation missing: en.${key}`;
  return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => (vars[name] == null ? "" : String(vars[name])));
}

export function formatMoney(cents) {
  const amount = Number(cents ?? 0) / 100;
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseHex(hex) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// Shopify: (r*299 + g*587 + b*114) / 1000.
export function colorBrightness(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return Math.round(((rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000) * 10) / 10;
}

function toHsl([r, g, b]) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h *= 60;
  return [h, s * 100, l * 100];
}

function fromHsl([h, s, l]) {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function shiftLightness(hex, delta) {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [h, s, l] = toHsl(rgb);
  return fromHsl([h, s, Math.min(100, Math.max(0, l + delta))]);
}

/**
 * @param {{ assetBase?: string, locale?: object }} [options]
 */
export function createLiquidEngine({ assetBase = "/assets", locale = LOCALE } = {}) {
  const engine = new Liquid({
    root: [path.join(EXTENSION_DIR, "blocks"), path.join(EXTENSION_DIR, "snippets")],
    partials: [path.join(EXTENSION_DIR, "snippets")],
    extname: ".liquid",
    cache: true,
  });

  engine.registerTag("doc", silentBlock("doc"));
  engine.registerTag("schema", silentBlock("schema"));

  engine.registerFilter("t", (key, ...args) => translate(key, keywordArgs(args), locale));
  engine.registerFilter("money", (cents) => formatMoney(cents));
  engine.registerFilter("image_url", (image, ...args) => {
    const src = typeof image === "string" ? image : image?.src;
    if (!src) return "";
    const { width, height } = keywordArgs(args);
    const params = [width && `width=${width}`, height && `height=${height}`].filter(Boolean).join("&");
    return params ? `${src}${src.includes("?") ? "&" : "?"}${params}` : src;
  });
  engine.registerFilter("asset_url", (file) => `${assetBase}/${file}`);
  engine.registerFilter("stylesheet_tag", (url) => `<link href="${url}" rel="stylesheet" type="text/css" media="all" />`);
  engine.registerFilter("color_brightness", (hex) => colorBrightness(hex));
  engine.registerFilter("color_lighten", (hex, amount) => shiftLightness(hex, Number(amount) || 0));
  engine.registerFilter("color_darken", (hex, amount) => shiftLightness(hex, -(Number(amount) || 0)));
  engine.registerFilter("divided_by", (value, divisor) => {
    const a = Number(value);
    const b = Number(divisor);
    return Number.isInteger(a) && Number.isInteger(b) ? Math.floor(a / b) : a / b;
  });

  return engine;
}

/** Collapse whitespace so assertions don't depend on Liquid formatting. */
export const squash = (html) => String(html).replace(/\s+/g, " ").trim();
