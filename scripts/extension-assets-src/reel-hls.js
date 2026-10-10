// HLS playback for every <video> the app drives: the viewers (full quality,
// one at a time) and the inline previews (lowest rendition, several at
// once). Safari/iOS play HLS natively; everywhere else hls.js is loaded
// lazily and given one instance per video element.
(() => {
  const currentScriptSrc = document.currentScript?.src ?? "";
  const instances = new WeakMap();

  const supportsNativeHls = (video) => video.canPlayType("application/vnd.apple.mpegurl") !== "";

  // Pick the highest rendition the measured link can sustain BEFORE any
  // segment is requested — forcing the top level made the first segment
  // the slowest download on poor connections. Network Information API is
  // Chromium-only; elsewhere fall back to the top level.
  const pickStartLevel = (levels) => {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const downlinkMbps = conn?.downlink;
    if (!downlinkMbps) return levels.length - 1;
    const budgetBps = downlinkMbps * 1_000_000 * 0.7;
    let chosen = 0;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].bitrate <= budgetBps) chosen = i;
    }
    return chosen;
  };

  let hlsJsPromise = null;
  const loadHlsJs = () => {
    if (window.Hls) return Promise.resolve();
    hlsJsPromise ??= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = currentScriptSrc.replace("reel-hls.js", "hls.min.js");
      script.dataset.reelupHlsjs = "true";
      script.onload = () => resolve();
      script.onerror = () => {
        hlsJsPromise = null;
        reject(new Error("Failed to load hls.js"));
      };
      document.head.appendChild(script);
    });
    return hlsJsPromise;
  };

  const destroy = (video) => {
    instances.get(video)?.destroy();
    instances.delete(video);
  };

  // `preview: true` = lowest rendition, small buffer, no audio concerns.
  const attach = async (video, hlsSrc, { preview = false } = {}) => {
    destroy(video);
    if (supportsNativeHls(video)) {
      video.src = hlsSrc;
      return;
    }

    await loadHlsJs();
    if (!window.Hls?.isSupported()) throw new Error("HLS not supported");

    await new Promise((resolve, reject) => {
      const hls = new window.Hls(
        preview
          ? { autoStartLoad: false, capLevelToPlayerSize: true, maxBufferLength: 6, maxMaxBufferLength: 10, startLevel: 0 }
          : // autoStartLoad:false holds the first fragment until currentLevel
            // is set below; otherwise hls.js fetches one at its own guess.
            { autoStartLoad: false, capLevelToPlayerSize: false },
      );
      instances.set(video, hls);
      hls.loadSource(hlsSrc);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, (_event, data) => {
        if (data.levels?.length) {
          // currentLevel (not startLevel) pins the choice so ABR never
          // steps the viewer down mid-play; previews just take the lowest.
          hls.currentLevel = preview ? 0 : pickStartLevel(data.levels);
        }
        hls.startLoad();
        resolve();
      });
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) reject(new Error(data.type));
      });
    });
  };

  // Stops decoding/buffering for a video whose viewer or preview went away.
  const teardown = (video) => {
    destroy(video);
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  window.ReelupHls = { attach, teardown, supportsNativeHls };

  // Warm the hls.js cache during idle time where it'll be needed, so the
  // first tap doesn't pay for the library and the manifest back to back.
  if (document.querySelector("[data-reelup-trigger], [data-reelup-pop]")) {
    if (!supportsNativeHls(document.createElement("video"))) {
      const schedule = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 2000));
      schedule(() => loadHlsJs().catch(() => {}));
    }
  }
})();
