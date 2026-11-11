// The live preview's theme: styles from the storefront's head, and the real
// wrappers around an already-placed widget.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_THEME, themeContextFor } from "./theme-styles.server";
import { themePagesFor } from "./widget-preview.server";

const page = (body: string) => `<!doctype html>
<html class="js theme" style="--page-max: 1200px" lang="en" data-tracking="x">
<head>
  <link rel="stylesheet" href="//cdn.shopify.com/s/files/theme.css?v=1">
  <link rel="preload" href="/font.woff2" as="font">
  <link rel="icon" href="/favicon.png">
  <style>:root { --font-heading-family: "Marcellus"; }</style>
  <style>.evil{} </style>
  <script>window.theme = {}</script>
</head>
<body class="template-product" style="--x: 1" data-foo="bar">${body}</body>
</html>`;

afterEach(() => vi.unstubAllGlobals());

const serve = (pages: Record<string, string | null>) => {
  const fetchMock = vi.fn(async (url: string) => {
    const html = pages[url];
    if (html == null) return new Response("nope", { status: 404 });
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("themeContextFor", () => {
  it("copies the head's stylesheets and style blocks (absolute URLs), never scripts", async () => {
    serve({ "https://a.test/": page("<main><p>Hi</p></main>") });
    const theme = await themeContextFor(["https://a.test/"], "awa-sv-deck");
    expect(theme.head).toContain('<link rel="stylesheet" href="https://cdn.shopify.com/s/files/theme.css?v=1">');
    expect(theme.head).toContain('--font-heading-family: "Marcellus"');
    expect(theme.head).not.toContain("script");
    expect(theme.head).not.toContain("font.woff2");
    expect(theme.htmlAttrs).toBe(' class="js theme" style="--page-max: 1200px" lang="en"');
    expect(theme.bodyAttrs).toBe(' class="template-product" style="--x: 1"');
    expect(theme.placed).toBe(false);
  });

  it("reproduces the real wrappers around an already-placed widget, empty", async () => {
    serve({
      "https://b.test/products/chair": page(
        `<main id="MainContent"><div id="shopify-section-x" class="shopify-section"><div class="container wide" data-x="1"><section class="awa-sv awa-sv-strip">real</section></div></div></main>`,
      ),
    });
    const theme = await themeContextFor(["https://b.test/products/chair"], "awa-sv-strip");
    expect(theme.placed).toBe(true);
    expect(theme.wrapOpen).toBe('<main id="MainContent"><div id="shopify-section-x" class="shopify-section"><div class="container wide">');
    expect(theme.wrapClose).toBe("</div></div></main>");
  });

  it("tries the pages in order: the first one where the widget is placed wins, else the first page's styles", async () => {
    const fetchMock = serve({
      "https://c.test/products/a": page("<main>no widget</main>"),
      "https://c.test/": page(`<div class="home"><section class="awa-sv-deck"></section></div>`),
    });
    const placed = await themeContextFor(["https://c.test/products/a", "https://c.test/"], "awa-sv-deck");
    expect(placed.wrapOpen).toBe('<div class="home">');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const notPlaced = await themeContextFor(["https://c.test/products/a"], "awa-sv-stories");
    expect(notPlaced.placed).toBe(false);
    expect(notPlaced.head).toContain("theme.css");
  });

  it("caches pages, and an unreachable store gives the neutral defaults", async () => {
    const fetchMock = serve({ "https://d.test/": null });
    expect(await themeContextFor(["https://d.test/"], "awa-sv-deck")).toEqual(EMPTY_THEME);
    await themeContextFor(["https://d.test/"], "awa-sv-deck");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await themeContextFor(["https://e.test/"], "awa-sv-deck")).toEqual(EMPTY_THEME);
  });
});

describe("themePagesFor", () => {
  it("looks on product pages first for product page reels, the home page first otherwise", () => {
    expect(themePagesFor("PRODUCT_PAGE_REELS", "https://s.test", ["a", "b", "c", "d"])).toEqual([
      "https://s.test/products/a",
      "https://s.test/products/b",
      "https://s.test/products/c",
      "https://s.test/",
    ]);
    expect(themePagesFor("CAROUSEL", "https://s.test/", ["a"])).toEqual(["https://s.test/", "https://s.test/products/a"]);
    expect(themePagesFor("STORIES", "https://s.test")).toEqual(["https://s.test/"]);
  });
});
