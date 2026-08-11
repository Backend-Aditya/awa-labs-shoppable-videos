(() => {
  // No global "already initialized" guard: Shopify's theme editor live
  // preview re-injects this script on every Liquid/JS hot-reload without a
  // full page navigation. A global once-guard would silently no-op every
  // reload after the first, leaving fresh DOM with zero listeners attached
  // (confirmed live: play button stopped responding after any hot-reload).
  // Idempotency instead lives per-element, in activateReel below, which is
  // correct for both the hot-reload case and the "script tag appears twice"
  // case.
  const currentScriptSrc = document.currentScript?.src ?? "";

  const supportsNativeHls = (video) =>
    video.canPlayType("application/vnd.apple.mpegurl") !== "";

  const attachSource = (reelEl, video, hlsSrc) => {
    if (supportsNativeHls(video)) {
      video.src = hlsSrc;
      return Promise.resolve();
    }

    if (!window.Hls?.isSupported()) {
      return Promise.reject(new Error("HLS not supported"));
    }

    reelEl._reelupHlsInstance?.destroy();
    reelEl._reelupHlsInstance = null;

    return new Promise((resolve, reject) => {
      const hls = new window.Hls();
      reelEl._reelupHlsInstance = hls;
      hls.loadSource(hlsSrc);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => resolve());
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) reject(new Error(data.type));
      });
    });
  };

  const loadHlsJsIfNeeded = () => {
    if (window.Hls || document.querySelector("script[data-reelup-hlsjs]")) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = currentScriptSrc.replace(
        "product-page-reels.js",
        "hls.min.js",
      );
      script.dataset.reelupHlsjs = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load hls.js"));
      document.head.appendChild(script);
    });
  };

  const activateReel = (reelEl) => {
    if (reelEl.dataset.reelupBound) return;
    reelEl.dataset.reelupBound = "true";

    const video = reelEl.querySelector(".reelup-reel__video");
    const playButton = reelEl.querySelector(".reelup-reel__play");
    const hlsSrc = reelEl.dataset.hlsSrc;

    if (!video || !playButton || !hlsSrc) return;

    video.addEventListener("play", () => {
      reelEl.setAttribute("data-playing", "true");
    });
    video.addEventListener("pause", () => {
      reelEl.setAttribute("data-playing", "false");
    });

    playButton.addEventListener("click", async () => {
      // Already loaded and just paused — toggle play/pause directly, no
      // need to re-run the HLS attach dance.
      if (reelEl.hasAttribute("data-activated")) {
        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
        return;
      }

      try {
        if (!supportsNativeHls(video)) {
          await loadHlsJsIfNeeded();
        }
        await attachSource(reelEl, video, hlsSrc);
        reelEl.setAttribute("data-activated", "true");
        await video.play();
      } catch {
        // Playback failed to initialize; leave the poster/play button visible.
      }
    });

    bindProductsCarousel(reelEl);
    bindAddToCartButtons(reelEl);
  };

  const bindProductsCarousel = (reelEl) => {
    const track = reelEl.querySelector("[data-reelup-products]");
    const prevButton = reelEl.querySelector("[data-reelup-products-prev]");
    const nextButton = reelEl.querySelector("[data-reelup-products-next]");
    if (!track) return;

    const slide = (direction) => {
      track.scrollBy({ left: direction * track.clientWidth, behavior: "smooth" });
    };

    prevButton?.addEventListener("click", () => slide(-1));
    nextButton?.addEventListener("click", () => slide(1));
  };

  const bindAddToCartButtons = (reelEl) => {
    reelEl.querySelectorAll("[data-reelup-add-to-cart]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (button.dataset.state === "loading") return;

        const variantId = button.dataset.variantId;
        const addLabel = button.dataset.addLabel ?? button.textContent;
        const addedLabel = button.dataset.addedLabel ?? addLabel;

        button.dataset.state = "loading";

        try {
          const response = await fetch("/cart/add.js", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: variantId, quantity: 1 }),
          });
          if (!response.ok) throw new Error("Add to cart failed");

          document.dispatchEvent(new CustomEvent("cart:refresh"));
          button.dataset.state = "added";
          button.textContent = addedLabel;
        } catch {
          button.dataset.state = "";
          button.textContent = addLabel;
          return;
        }

        setTimeout(() => {
          button.dataset.state = "";
          button.textContent = addLabel;
        }, 2000);
      });
    });
  };

  const observeReels = () => {
    const reelEls = document.querySelectorAll("[data-reelup-reel]");
    if (reelEls.length === 0) return;

    if (!window.IntersectionObserver) {
      reelEls.forEach((el) => activateReel(el));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            activateReel(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "200px" },
    );

    reelEls.forEach((el) => observer.observe(el));
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeReels);
  } else {
    observeReels();
  }
})();
