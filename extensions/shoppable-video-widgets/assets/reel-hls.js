(() => {
  const currentScriptSrc = document.currentScript?.src ?? "";
  let hlsInstance = null;

  const supportsNativeHls = (video) =>
    video.canPlayType("application/vnd.apple.mpegurl") !== "";

  const loadHlsJsIfNeeded = () => {
    if (window.Hls || document.querySelector("script[data-reelup-hlsjs]")) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = currentScriptSrc.replace("reel-hls.js", "hls.min.js");
      script.dataset.reelupHlsjs = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load hls.js"));
      document.head.appendChild(script);
    });
  };

  const attach = async (video, hlsSrc) => {
    if (supportsNativeHls(video)) {
      video.src = hlsSrc;
      return;
    }

    await loadHlsJsIfNeeded();

    if (!window.Hls?.isSupported()) {
      throw new Error("HLS not supported");
    }

    hlsInstance?.destroy();
    hlsInstance = null;

    await new Promise((resolve, reject) => {
      const hls = new window.Hls({
        capLevelToPlayerSize: false,
        abrEwmaDefaultEstimate: 5000000, // Assume 5 Mbps to start at high quality
      });
      hlsInstance = hls;
      hls.loadSource(hlsSrc);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, (event, data) => {
        // Start at the highest available quality
        if (data.levels && data.levels.length > 0) {
          hls.startLevel = data.levels.length - 1;
        }
        resolve();
      });
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) reject(new Error(data.type));
      });
    });
  };

  // Runs whenever a consumer (the lightbox, the story viewer) tears down
  // its video element — destroys any active Hls.js instance and clears
  // the video's source so a stale video doesn't keep decoding/buffering
  // in the background after its dialog closes.
  const teardown = (video) => {
    hlsInstance?.destroy();
    hlsInstance = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  window.ReelupHls = { attach, teardown };
})();
