// Static storefront harness for Playwright. Serves:
//   /                  tests/e2e/fixtures/storefront.html with real block
//                      markup rendered from the theme extension's Liquid
//   /assets/*          extensions/shoppable-video-widgets/assets (the BUILT
//                      files — run `npm run build:extension` first)
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

// Media URLs resolve to 404 on this server: hls.js fails fast and the
// viewer keeps the poster, which is all these flows need.
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
    .replace("<!--REELUP_EMBED-->", embed)
    .replace("<!--REELUP_STRIP-->", strip)
    .replace("<!--REELUP_STORIES-->", stories)
    .replace("<!--REELUP_ATC-->", atc);
}

const TYPES = { ".js": "text/javascript", ".css": "text/css" };

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  try {
    if (url.pathname === "/" || url.pathname.startsWith("/products/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await renderPage());
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
