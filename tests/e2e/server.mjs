// Static storefront harness for Playwright. Serves:
//   /                  tests/e2e/fixtures/storefront.html with real block
//                      markup rendered from the theme extension's Liquid,
//                      and each block's schema stylesheet/javascript in
//                      <head> the way Shopify injects them
//   /pages/plain       the same layout with the app embed only, a store
//                      page without any widget
//   /assets/*          extensions/shoppable-video-widgets/assets (the BUILT
//                      files, run `npm run build:extension` first)
//   anything else      404 (cart, recommendations and analytics endpoints
//                      are mocked per test with page.route)
//
//   node tests/e2e/server.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLiquidEngine, EXTENSION_DIR } from "../support/liquid-engine.mjs";
import { blockContext, makeProduct, makeReel, makeWidget, multiVariantProduct } from "../support/storefront-fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? process.env.E2E_PORT ?? 4173);
const engine = createLiquidEngine({ assetBase: "/assets" });

// HLS manifest URLs 404 on this server (real hls.js → playback error path).
// Specs that need real playback swap window.ReelupHls for a stub that plays
// /media/sample.webm (see playableVideo() in storefront.spec.ts).
const hls = (id) => `/media/${id}/manifest/video.m3u8`;
const poster = (id) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="9" height="16"><rect width="9" height="16" fill="hsl(${id * 47} 40% 60%)"/></svg>`)}`;

const shirt = multiVariantProduct(7);
const tote = makeProduct({ id: 8, title: "Canvas Tote", image: null });
const stripReels = [
  makeReel({ id: 1, title: "Morning routine", hls: hls(1), poster: poster(1), products: [shirt, tote] }),
  makeReel({ id: 2, title: "Styling tips", hls: hls(2), poster: poster(2), products: [tote] }),
  makeReel({ id: 3, title: "Unboxing", hls: hls(3), poster: poster(3), products: [shirt] }),
];
const storyReels = [
  makeReel({ id: 11, title: "Story one", hls: hls(11), poster: poster(11), products: [tote] }),
  makeReel({ id: 12, title: "Story two", hls: hls(12), poster: poster(12) }),
];

// Shopify adds every app block's schema "stylesheet" and "javascript" to the
// page once, however many of those blocks it has; liquidjs skips {% schema %}.
async function schemaAssets(blocks) {
  const tags = new Set();
  for (const block of blocks) {
    const source = await readFile(path.join(EXTENSION_DIR, "blocks", `${block}.liquid`), "utf8");
    const schema = JSON.parse(source.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
    if (schema.stylesheet) tags.add(`<link rel="stylesheet" href="/assets/${schema.stylesheet}">`);
    if (schema.javascript) tags.add(`<script src="/assets/${schema.javascript}" defer></script>`);
  }
  return [...tags].join("\n");
}

// The embed on a page with no widget (cart, blog, …): no blocks, so no
// schema assets either.
async function renderPlainPage() {
  const embed = await engine.renderFile("shoppable-videos", blockContext("shoppable-videos", { widget: makeWidget({ published: false }) }));
  const layout = await readFile(path.join(here, "fixtures/storefront.html"), "utf8");
  return layout.replace("<!--REELUP_EMBED-->", embed).replace(/<!--REELUP_[A-Z]+-->/g, "");
}

async function renderPage() {
  const render = (block, input) => engine.renderFile(block, blockContext(block, { product: shirt, ...input }));
  const [embed, strip, stories, atc] = await Promise.all([
    render("shoppable-videos", { widget: makeWidget({ published: false }) }),
    render("product-page-reels", { reels: stripReels, widget: makeWidget({ style: { heading: "See it in action", showQuantity: true } }) }),
    render("insta-stories", { reels: storyReels, widget: makeWidget({ style: { heading: "Stories", storyDuration: 2 } }) }),
    render("add-to-cart-video", { reel: stripReels[1], widget: makeWidget() }),
  ]);
  const layout = await readFile(path.join(here, "fixtures/storefront.html"), "utf8");
  return layout
    .replace("<!--REELUP_HEAD-->", await schemaAssets(["product-page-reels", "insta-stories", "add-to-cart-video"]))
    .replace("<!--REELUP_EMBED-->", embed)
    .replace("<!--REELUP_STRIP-->", strip)
    .replace("<!--REELUP_STORIES-->", stories)
    .replace("<!--REELUP_ATC-->", atc);
}

const TYPES = { ".js": "text/javascript", ".css": "text/css" };

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  try {
    if (url.pathname === "/pages/plain") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await renderPlainPage());
      return;
    }
    if (url.pathname === "/" || url.pathname.startsWith("/products/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await renderPage());
      return;
    }
    if (url.pathname === "/media/sample.webm") {
      // Byte ranges, like a real CDN: without them Chromium treats the video
      // as unseekable and seeking specs can't run.
      const body = await readFile(path.join(here, "fixtures/sample.webm"));
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        res.writeHead(206, {
          "Content-Type": "video/webm",
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${body.length}`,
          "Content-Length": end - start + 1,
        });
        res.end(body.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { "Content-Type": "video/webm", "Accept-Ranges": "bytes", "Content-Length": body.length });
      res.end(body);
      return;
    }
    if (url.pathname.startsWith("/assets/")) {
      const file = path.basename(url.pathname);
      const body = await readFile(path.join(EXTENSION_DIR, "assets", file));
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(String(error?.stack ?? error));
  }
}).listen(port, () => {
  console.log(`storefront harness on http://localhost:${port}`);
});
