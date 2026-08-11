(function () {
  // No global "already initialized" guard: Shopify's theme editor live
  // preview re-injects this script on every Liquid/JS hot-reload without a
  // full page navigation. A global once-guard would silently no-op every
  // reload after the first, leaving fresh DOM with zero listeners attached
  // (confirmed live: play button stopped responding after any hot-reload).
  // Idempotency instead lives per-element, in activateReel below, which is
  // correct for both the hot-reload case and the "script tag appears twice"
  // case.
  var currentScriptSrc = document.currentScript ? document.currentScript.src : "";

  function supportsNativeHls(video) {
    return video.canPlayType("application/vnd.apple.mpegurl") !== "";
  }

  function attachSource(reelEl, video, hlsSrc) {
    if (supportsNativeHls(video)) {
      video.src = hlsSrc;
      return Promise.resolve();
    }

    if (!window.Hls || !window.Hls.isSupported()) {
      return Promise.reject(new Error("HLS not supported"));
    }

    if (reelEl._reelupHlsInstance) {
      reelEl._reelupHlsInstance.destroy();
      reelEl._reelupHlsInstance = null;
    }

    return new Promise(function (resolve, reject) {
      var hls = new window.Hls();
      reelEl._reelupHlsInstance = hls;
      hls.loadSource(hlsSrc);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
        resolve();
      });
      hls.on(window.Hls.Events.ERROR, function (_event, data) {
        if (data.fatal) reject(new Error(data.type));
      });
    });
  }

  function loadHlsJsIfNeeded() {
    if (window.Hls || document.querySelector("script[data-reelup-hlsjs]")) {
      return Promise.resolve();
    }

    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = currentScriptSrc.replace(
        "product-page-reels.js",
        "hls.min.js",
      );
      script.dataset.reelupHlsjs = "true";
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        reject(new Error("Failed to load hls.js"));
      };
      document.head.appendChild(script);
    });
  }

  function activateReel(reelEl) {
    if (reelEl.dataset.reelupBound) return;
    reelEl.dataset.reelupBound = "true";

    var video = reelEl.querySelector(".reelup-reel__video");
    var playButton = reelEl.querySelector(".reelup-reel__play");
    var hlsSrc = reelEl.dataset.hlsSrc;

    if (!video || !playButton || !hlsSrc) return;

    video.addEventListener("play", function () {
      reelEl.setAttribute("data-playing", "true");
    });
    video.addEventListener("pause", function () {
      reelEl.setAttribute("data-playing", "false");
    });

    playButton.addEventListener("click", function () {
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

      var ready = supportsNativeHls(video)
        ? Promise.resolve()
        : loadHlsJsIfNeeded();

      ready
        .then(function () {
          return attachSource(reelEl, video, hlsSrc);
        })
        .then(function () {
          reelEl.setAttribute("data-activated", "true");
          return video.play();
        })
        .catch(function () {
          // Playback failed to initialize; leave the poster/play button visible.
        });
    });
  }

  function observeReels() {
    var reelEls = document.querySelectorAll("[data-reelup-reel]");
    if (reelEls.length === 0) return;

    if (!window.IntersectionObserver) {
      reelEls.forEach(function (el) {
        activateReel(el);
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            activateReel(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "200px" },
    );

    reelEls.forEach(function (el) {
      observer.observe(el);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeReels);
  } else {
    observeReels();
  }
})();
