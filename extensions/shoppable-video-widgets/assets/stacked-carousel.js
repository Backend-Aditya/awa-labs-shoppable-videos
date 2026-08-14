(() => {
  const currentScriptSrc = document.currentScript?.src ?? "";

  const supportsNativeHls = (video) =>
    video.canPlayType("application/vnd.apple.mpegurl") !== "";

  const attachSource = (cardEl, video, hlsSrc) => {
    if (supportsNativeHls(video)) {
      video.src = hlsSrc;
      return Promise.resolve();
    }

    if (!window.Hls?.isSupported()) {
      return Promise.reject(new Error("HLS not supported"));
    }

    cardEl._reelupHlsInstance?.destroy();
    cardEl._reelupHlsInstance = null;

    return new Promise((resolve, reject) => {
      const hls = new window.Hls();
      cardEl._reelupHlsInstance = hls;
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
      script.src = currentScriptSrc.replace("stacked-carousel.js", "hls.min.js");
      script.dataset.reelupHlsjs = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load hls.js"));
      document.head.appendChild(script);
    });
  };

  const activateCard = (cardEl) => {
    if (cardEl.dataset.reelupBound) return;
    cardEl.dataset.reelupBound = "true";

    const video = cardEl.querySelector(".reelup-carousel__video");
    const playButton = cardEl.querySelector(".reelup-carousel__play");
    const hlsSrc = cardEl.dataset.hlsSrc;

    if (!video || !playButton || !hlsSrc) return;

    video.addEventListener("play", () => cardEl.setAttribute("data-playing", "true"));
    video.addEventListener("pause", () => cardEl.setAttribute("data-playing", "false"));

    playButton.addEventListener("click", async () => {
      if (cardEl.hasAttribute("data-activated")) {
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
        await attachSource(cardEl, video, hlsSrc);
        cardEl.setAttribute("data-activated", "true");
        await video.play();
      } catch {
        // Playback failed to initialize; leave the poster/play button visible.
      }
    });
  };

  const observeCards = () => {
    const cards = document.querySelectorAll("[data-reelup-carousel-card]");
    if (cards.length === 0) return;

    if (!window.IntersectionObserver) {
      cards.forEach((el) => activateCard(el));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            activateCard(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "200px" },
    );

    cards.forEach((el) => observer.observe(el));
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeCards);
  } else {
    observeCards();
  }
})();
