(function () {
  var currentScriptSrc = document.currentScript ? document.currentScript.src : "";

  function supportsNativeHls(video) {
    return video.canPlayType("application/vnd.apple.mpegurl") !== "";
  }

  function attachSource(video, hlsSrc) {
    if (supportsNativeHls(video)) {
      video.src = hlsSrc;
      return Promise.resolve();
    }

    if (!window.Hls || !window.Hls.isSupported()) {
      return Promise.reject(new Error("HLS not supported"));
    }

    return new Promise(function (resolve, reject) {
      var hls = new window.Hls();
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
    if (reelEl.dataset.reelupActivated) return;
    reelEl.dataset.reelupActivated = "true";

    var video = reelEl.querySelector(".reelup-reel__video");
    var playButton = reelEl.querySelector(".reelup-reel__play");
    var hlsSrc = reelEl.dataset.hlsSrc;

    if (!video || !hlsSrc) return;

    playButton.addEventListener("click", function () {
      var ready = supportsNativeHls(video)
        ? Promise.resolve()
        : loadHlsJsIfNeeded();

      ready
        .then(function () {
          return attachSource(video, hlsSrc);
        })
        .then(function () {
          reelEl.setAttribute("data-playing", "true");
          video.play();
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
