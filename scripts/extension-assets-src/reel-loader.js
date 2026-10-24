// The one script every page gets. The app embed renders it and each
// section block declares it as its schema "javascript" asset (Shopify
// injects it once per page, however many blocks use it). It loads the
// viewer runtime (tracking → hls → lightbox → story → trigger, plus pop for
// the floating video) and the viewer stylesheet ONLY on pages that have a
// widget, so the embed costs a storefront's other pages (cart, blog,
// collections without videos…) this file and nothing else, unless the
// merchant connected Microsoft Clarity, which records every page and so
// brings reel-tracking.js everywhere.
//
// Double-loading is safe: this file runs once per page, and every runtime
// file returns early if its global (window.ReelupTracking / ReelupHls /
// ReelupLightbox / ReelupStory / ReelupTrigger / ReelupPop) already exists,
// so delegated listeners, the add-to-cart one in particular, are only
// attached once.
(() => {
  if (window.__reelupLoader) return;
  window.__reelupLoader = true;

  const base = document.currentScript?.src ?? "";
  const assetUrl = (name) => base.replace(/reel-loader\.js/, name);
  const RUNTIME = ["reel-hls.js", "reel-lightbox.js", "reel-story.js", "reel-trigger.js"];

  const clarityConnected = () => {
    try {
      return Boolean(JSON.parse(document.querySelector("script[data-reelup-config]")?.textContent ?? "{}").tracking?.clarityId);
    } catch {
      return false;
    }
  };

  // Trigger buttons are bound by the runtime. A tap that lands while it's
  // still downloading would otherwise do nothing, so the latest one is held
  // and replayed once the runtime has run.
  let heldTap = null;
  const holdEarlyTap = (event) => {
    const button = event.target.closest?.("[data-reelup-trigger] .reelup-trigger__button, [data-reelup-pop-open]");
    if (!button) return;
    event.stopImmediatePropagation();
    heldTap = button;
  };
  const replayHeldTap = () => {
    document.removeEventListener("click", holdEarlyTap, true);
    const button = heldTap;
    heldTap = null;
    if (button?.isConnected) button.click();
  };

  const inject = (files, onSettled) =>
    files.forEach((name, i) => {
      const script = document.createElement("script");
      script.src = assetUrl(name);
      // Dynamically inserted scripts are async by default; async=false keeps
      // them executing in insertion order (lightbox needs hls, etc.), so the
      // last one settling means they all have.
      script.async = false;
      script.dataset.reelupLoader = "";
      if (onSettled && i === files.length - 1) {
        script.addEventListener("load", onSettled, { once: true });
        script.addEventListener("error", onSettled, { once: true });
      }
      document.head.appendChild(script);
    });

  let trackingRequested = false;
  let runtimeRequested = false;
  const run = () => {
    if (!base) return;
    const hasPop = Boolean(document.querySelector("[data-reelup-pop]"));
    // No widget means no blocks, every widget unpublished or targeted
    // elsewhere. A theme-editor section load may add one later.
    const hasWidget = hasPop || Boolean(document.querySelector("[data-reelup-trigger]"));
    const files = [];
    if (!trackingRequested && !window.ReelupTracking && (hasWidget || clarityConnected())) {
      trackingRequested = true;
      files.push("reel-tracking.js");
    }
    const loadRuntime = hasWidget && !runtimeRequested && !window.ReelupLightbox;
    if (loadRuntime) {
      runtimeRequested = true;
      document.addEventListener("click", holdEarlyTap, true);
      if (!document.querySelector('link[href*="reel-lightbox.css"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = assetUrl("reel-lightbox.css");
        document.head.appendChild(link);
      }
      files.push(...RUNTIME, ...(hasPop ? ["reel-pop.js"] : []));
    }
    inject(files, loadRuntime ? replayHeldTap : null);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
  // The theme editor adds blocks to a page without reloading it.
  document.addEventListener("shopify:section:load", run);
})();
