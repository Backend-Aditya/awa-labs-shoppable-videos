// Makes every section block self-sufficient. Each block declares this file
// as its schema "javascript" asset (Shopify injects it once per page, no
// matter how many blocks use it). When the Shoppable Videos app embed is
// ON, the embed already loads the runtime with its own <script defer> tags
// and this file does nothing. When the embed is OFF, this loads the same
// runtime in the same order (hls → lightbox → story → trigger) plus the
// viewer stylesheet, so blocks are never dead buttons.
//
// Double-loading is safe either way: every runtime file returns early if
// its global (window.ReelupHls / ReelupLightbox / ReelupStory /
// ReelupTrigger / ReelupPop) already exists, so delegated listeners — the
// add-to-cart one in particular — are only ever attached once.
(() => {
  if (window.__reelupLoader) return;
  window.__reelupLoader = true;

  const base = document.currentScript?.src ?? "";
  const assetUrl = (name) => base.replace(/reel-loader\.js/, name);
  const RUNTIME = ["reel-hls.js", "reel-lightbox.js", "reel-story.js", "reel-trigger.js"];

  const run = () => {
    if (!base) return;
    // Nothing on this page to drive (e.g. every block is unpublished).
    if (!document.querySelector("[data-reelup-trigger]")) return;
    // The embed is on: its scripts are already in the parsed document (they
    // run deferred, possibly after this one) or have already run.
    if (window.ReelupLightbox || document.querySelector('script[src*="reel-lightbox.js"]:not([data-reelup-loader])')) return;

    if (!document.querySelector('link[href*="reel-lightbox.css"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = assetUrl("reel-lightbox.css");
      document.head.appendChild(link);
    }
    RUNTIME.forEach((name) => {
      const script = document.createElement("script");
      script.src = assetUrl(name);
      // Dynamically inserted scripts are async by default; async=false keeps
      // them executing in insertion order (lightbox needs hls, etc.).
      script.async = false;
      script.dataset.reelupLoader = "";
      document.head.appendChild(script);
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
})();
