(() => {
  const currentScriptSrc = document.currentScript?.src ?? "";
  let hlsInstance = null;

  const supportsNativeHls = (video) =>
    video.canPlayType("application/vnd.apple.mpegurl") !== "";

  // Forcing the top rendition unconditionally means the very first segment
  // fetched can be the biggest file in the manifest — on a slow connection
  // that download itself is the "5 seconds before it plays" delay, no
  // adaptive-switching involved. The Network Information API (Chrome/Edge/
  // Android; not Safari or Firefox) gives an instant, zero-request estimate
  // of the link speed, so we can pick the highest rendition that actually
  // fits it BEFORE requesting anything. Where the API is unavailable we
  // fall back to the top level (this is the same as before this change).
  const pickStartLevel = (levels) => {
    const conn =
      navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const downlinkMbps = conn?.downlink;
    if (!downlinkMbps) return levels.length - 1;

    // Budget in bits/sec, with headroom so the chosen rendition still has
    // room to buffer ahead rather than running right at the estimated cap.
    const budgetBps = downlinkMbps * 1_000_000 * 0.7;

    let chosen = 0;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].bitrate <= budgetBps) chosen = i;
    }
    return chosen;
  };

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
        // hls.js's own internal MANIFEST_PARSED listener (registered before
        // ours, since it's wired up inside the Hls constructor) kicks off
        // the first fragment fetch at its own default-guess level as soon
        // as the manifest parses. Setting currentLevel in OUR listener below
        // runs too late to stop that first request — the video would still
        // play a few seconds of the wrong-level fragment before the next
        // one (fetched at our chosen level) takes over. autoStartLoad:
        // false holds off any fragment loading until we call startLoad()
        // ourselves, after currentLevel is already set.
        autoStartLoad: false,
      });
      hlsInstance = hls;
      hls.loadSource(hlsSrc);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, (event, data) => {
        // Setting currentLevel (rather than startLevel) takes loadLevel out
        // of auto mode, so hls.js's bandwidth-based ABR never steps this
        // back down mid-playback once it starts measuring throughput — the
        // level picked here is what plays for the whole session.
        if (data.levels && data.levels.length > 0) {
          hls.currentLevel = pickStartLevel(data.levels);
        }
        hls.startLoad();
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

  // Warms the hls.min.js cache during idle time on browsers that need it
  // (Safari/iOS play HLS natively and never load this), so the FIRST tap
  // on a trigger doesn't pay for both the library fetch and the manifest
  // fetch back-to-back — only runs when a reel actually exists on the page.
  if (document.querySelector("[data-reelup-trigger], [data-reelup-pop]")) {
    const probe = document.createElement("video");
    if (!supportsNativeHls(probe)) {
      const schedule = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 2000));
      schedule(() => {
        const link = document.createElement("link");
        link.rel = "prefetch";
        link.as = "script";
        link.href = currentScriptSrc.replace("reel-hls.js", "hls.min.js");
        document.head.appendChild(link);
      });
    }
  }
})();
