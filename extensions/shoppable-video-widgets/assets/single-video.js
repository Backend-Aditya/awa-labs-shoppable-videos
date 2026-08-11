(() => {
  const currentScriptSrc = document.currentScript?.src ?? "";

  const supportsNativeHls = (video) =>
    video.canPlayType("application/vnd.apple.mpegurl") !== "";

  const attachSource = (frameEl, video, hlsSrc) => {
    if (supportsNativeHls(video)) {
      video.src = hlsSrc;
      return Promise.resolve();
    }

    if (!window.Hls?.isSupported()) {
      return Promise.reject(new Error("HLS not supported"));
    }

    frameEl._reelupHlsInstance?.destroy();
    frameEl._reelupHlsInstance = null;

    return new Promise((resolve, reject) => {
      const hls = new window.Hls();
      frameEl._reelupHlsInstance = hls;
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
      script.src = currentScriptSrc.replace("single-video.js", "hls.min.js");
      script.dataset.reelupHlsjs = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load hls.js"));
      document.head.appendChild(script);
    });
  };

  const activateFrame = (frameEl) => {
    if (frameEl.dataset.reelupBound) return;
    frameEl.dataset.reelupBound = "true";

    const video = frameEl.querySelector(".reelup-single-video__video");
    const playButton = frameEl.querySelector(".reelup-single-video__play");
    const hlsSrc = frameEl.dataset.hlsSrc;

    if (!video || !playButton || !hlsSrc) return;

    video.addEventListener("play", () => frameEl.setAttribute("data-playing", "true"));
    video.addEventListener("pause", () => frameEl.setAttribute("data-playing", "false"));

    playButton.addEventListener("click", async () => {
      if (frameEl.hasAttribute("data-activated")) {
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
        await attachSource(frameEl, video, hlsSrc);
        frameEl.setAttribute("data-activated", "true");
        await video.play();
      } catch {
        // Playback failed to initialize; leave the poster/play button visible.
      }
    });
  };

  document.querySelectorAll("[data-reelup-single-video]").forEach((el) => activateFrame(el));
})();
