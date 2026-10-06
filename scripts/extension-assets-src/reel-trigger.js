(() => {
  const hoverCapable = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;

  const bindAll = () => {
    document.querySelectorAll("[data-reelup-trigger]").forEach((trigger) => {
      if (trigger.closest("[data-reelup-story-group]")) return;
      if (trigger.dataset.reelupTriggerBound) return;
      trigger.dataset.reelupTriggerBound = "true";

      const button = trigger.querySelector(".reelup-trigger__button");
      if (!button) return;
      const open = () => window.ReelupLightbox?.open(trigger);

      // "Play on hover" only makes sense on devices with a real hover
      // state — on touch, fall back to the default click-to-open so the
      // first tap isn't swallowed by a hover event that never fires.
      if (trigger.dataset.playTrigger === "hover" && hoverCapable) {
        button.addEventListener("mouseenter", open);
      } else {
        button.addEventListener("click", open);
      }
    });
  };

  bindAll();

  // Shopify's theme editor re-renders a section via AJAX whenever the
  // merchant tweaks a block setting, swapping in fresh (unbound) markup
  // without a full page reload — without this, triggers added that way
  // stay dead until the merchant manually refreshes the preview.
  document.addEventListener("shopify:section:load", bindAll);
  document.addEventListener("shopify:block:select", bindAll);
})();

// Autoplay-muted preview on scroll, opt-in via data-autoplay-scroll="true"
// (PRODUCT_PAGE_REELS/CAROUSEL grid+carousel items). Deliberately limited to
// browsers with native HLS playback (Safari/iOS via canPlayType) instead of
// routing through window.ReelupHls — that module holds a single shared
// hls.js instance meant for one active player (the lightbox) at a time, so
// wiring many concurrent grid previews through it would have each newly
// visible tile tear down every other tile's playback. Elsewhere this
// silently no-ops and the static poster image just stays put, which is an
// acceptable degrade for what's otherwise a "nice to have" preview effect.
(() => {
  const supportsNativeHls = (videoEl) => videoEl.canPlayType("application/vnd.apple.mpegurl") !== "";
  const bound = new WeakSet();

  const setUp = () => {
    document.querySelectorAll('[data-reelup-trigger][data-autoplay-scroll="true"]').forEach((trigger) => {
      if (bound.has(trigger)) return;
      bound.add(trigger);

      const button = trigger.querySelector(".reelup-trigger__button");
      const poster = trigger.querySelector(".reelup-trigger__poster");
      const src = trigger.dataset.hlsSrc;
      if (!button || !src) return;

      const probe = document.createElement("video");
      if (!supportsNativeHls(probe)) return;

      let previewVideo = null;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              if (previewVideo) continue;
              previewVideo = document.createElement("video");
              previewVideo.className = "reelup-trigger__preview";
              previewVideo.muted = true;
              previewVideo.loop = true;
              previewVideo.playsInline = true;
              previewVideo.setAttribute("aria-hidden", "true");
              previewVideo.src = src;
              button.insertBefore(previewVideo, poster ? poster.nextSibling : button.firstChild);
              previewVideo.play().catch(() => {});
            } else if (previewVideo) {
              previewVideo.pause();
              previewVideo.remove();
              previewVideo = null;
            }
          }
        },
        { threshold: 0.5 },
      );
      observer.observe(trigger);
    });
  };

  setUp();
  document.addEventListener("shopify:section:load", setUp);
  document.addEventListener("shopify:block:select", setUp);
})();
