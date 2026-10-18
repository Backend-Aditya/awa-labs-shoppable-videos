// Minifies the storefront extension's own JS and CSS into the files its Liquid
// blocks actually reference via `| asset_url`. Theme app extensions have
// no build/bundler hook in shopify.extension.toml (unlike UI extensions),
// so there's no way to wire this into `shopify app deploy` automatically —
// `npm run deploy` runs this first, but a bare `shopify app deploy` won't.
//
// scripts/extension-assets-src/*.{js,css} is the source of truth
// (commented, readable) — edit there, never edit
// extensions/shoppable-video-widgets/assets/*.{js,css} directly, since this
// script overwrites them on every run. It lives outside the extension's own
// directory because Shopify's theme-extension validator rejects any
// directory other than assets/blocks/locales/snippets inside an
// extension folder (confirmed via `shopify app deploy`, which refuses to
// bundle the extension if an assets-src/ sits alongside assets/).
//
// hls.min.js is vendored third-party and already minified; it isn't part
// of this pipeline.
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, "extension-assets-src");
const outDir = path.join(root, "..", "extensions", "shoppable-video-widgets", "assets");

const sources = readdirSync(srcDir);
const entryPoints = sources.filter((name) => name.endsWith(".js")).map((name) => path.join(srcDir, name));
const stylesheets = sources.filter((name) => name.endsWith(".css")).map((name) => path.join(srcDir, name));

if (entryPoints.length === 0 || stylesheets.length === 0) {
  console.error(`Expected .js and .css sources in ${srcDir}`);
  process.exit(1);
}

await build({
  entryPoints,
  outdir: outDir,
  minify: true,
  bundle: false,
  // Storefront shoppers run old in-app browsers and older Safari; lower
  // modern syntax (??=, optional catch binding is fine, numeric separators,
  // etc.) so one unsupported token can't kill the whole widget runtime.
  target: ["es2019"],
  logLevel: "info",
});

// Stylesheets ship to every page a block is on, so they're minified too
// (roughly a third smaller over the wire). Targets match the JS so modern
// syntax like nesting or :has() is passed through only where it's safe.
await build({
  entryPoints: stylesheets,
  outdir: outDir,
  minify: true,
  bundle: false,
  target: ["chrome87", "safari14", "firefox78", "edge88"],
  logLevel: "info",
});

console.log(`Minified ${entryPoints.length + stylesheets.length} file(s) into ${outDir}`);
