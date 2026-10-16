// HLS playback for every <video> the app drives: the viewers (full quality,
// one at a time) and the inline previews (lowest rendition, several at
// once). Safari/iOS play HLS natively; everywhere else hls.js is loaded on
// first intent (see prefetch) and given one instance per video element.
//
// Note on the hls.js build: hls.light.min.js would be ~40% smaller, but the
// light build drops the audio-track controller, and Cloudflare Stream
// manifests carry audio as a separate EXT-X-MEDIA TYPE=AUDIO rendition
// group — with the light build those reels play silently. So the full
// hls.min.js stays vendored; it is only fetched on intent, never on load.
(() => {
  // Loaded by the app embed and, when the embed is off, by the blocks'
  // loader — a second copy must not replace the first one's instances.
  if (window.ReelupHls) return;

  const currentScriptSrc = document.currentScript?.src ?? "";
  const instances = new WeakMap();
  // Per-video attach generation: every attach()/destroy() bumps it, so an
  // attach still awaiting hls.js or the manifest knows it was superseded.
  const generations = new WeakMap();
  // The settle function of the attach currently waiting on MANIFEST_PARSED.
  const pending = new WeakMap();
  let generationSeq = 0;

  const supportsNativeHls = (video) => video.canPlayType("application/vnd.apple.mpegurl") !== "";

  const superseded = () => {
    const error = new Error("Superseded by a newer attach");
    error.name = "AbortError";
    return error;
  };

  // Pick the highest rendition the measured link can sustain BEFORE any
  // segment is requested — the first segment is otherwise fetched at a
  // guess. Network Information API is Chromium-only; elsewhere hls.js's
  // own estimate (-1 = auto) is used. ABR stays on afterwards.
  const pickStartLevel = (levels) => {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const downlinkMbps = conn?.downlink;
    if (!downlinkMbps) return -1;
    const budgetBps = downlinkMbps * 1000000 * 0.7;
    let chosen = 0;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].bitrate <= budgetBps) chosen = i;
    }
    return chosen;
  };

  let hlsJsPromise = null;
  const loadHlsJs = () => {
    if (window.Hls) return Promise.resolve();
    if (!hlsJsPromise) {
      hlsJsPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector("script[data-reelup-hlsjs]");
        const script = existing ?? document.createElement("script");
        script.addEventListener("load", () => resolve());
        script.addEventListener("error", () => {
          hlsJsPromise = null;
          script.remove();
          reject(new Error("Failed to load hls.js"));
        });
        if (!existing) {
          script.src = currentScriptSrc.replace(/reel-hls\.js/, "hls.min.js");
          script.dataset.reelupHlsjs = "true";
          document.head.appendChild(script);
        }
      });
    }
    return hlsJsPromise;
  };

  // Fetch hls.js ahead of the first open (called on hover/focus/touch of a
  // trigger). No-op where HLS is native or the library is already here.
  let prefetched = false;
  const prefetch = () => {
    if (prefetched) return;
    prefetched = true;
    if (supportsNativeHls(document.createElement("video"))) return;
    loadHlsJs().catch(() => {
      prefetched = false;
    });
  };

  const destroy = (video) => {
    generations.set(video, ++generationSeq);
    const settle = pending.get(video);
    pending.delete(video);
    settle?.(superseded());
    instances.get(video)?.destroy();
    instances.delete(video);
  };

  const fail = (video) => {
    video.dispatchEvent(new CustomEvent("reelup:playback-error", { bubbles: true }));
  };

  // Mid-play fatal errors: retry the network a couple of times, recover the
  // media pipeline once or twice, otherwise give up and let the viewer show
  // a retry message.
  const handleFatal = (hls, video, data, retries) => {
    const { ErrorTypes } = window.Hls;
    if (data.type === ErrorTypes.NETWORK_ERROR && retries.network < 3) {
      retries.network += 1;
      hls.startLoad();
      return;
    }
    if (data.type === ErrorTypes.MEDIA_ERROR && retries.media < 2) {
      retries.media += 1;
      hls.recoverMediaError();
      return;
    }
    if (instances.get(video) === hls) {
      instances.delete(video);
      hls.destroy();
    }
    fail(video);
  };

  // `preview: true` = lowest rendition, small buffer, no audio concerns.
  // Rejects with an AbortError if a newer attach()/teardown() for the same
  // video happened while this one was still waiting.
  const attach = async (video, hlsSrc, { preview = false } = {}) => {
    destroy(video);
    const generation = generations.get(video);
    const isCurrent = () => generations.get(video) === generation;

    if (supportsNativeHls(video)) {
      video.src = hlsSrc;
      return;
    }

    await loadHlsJs();
    if (!isCurrent()) throw superseded();
    if (!window.Hls?.isSupported()) throw new Error("HLS not supported");

    const Hls = window.Hls;
    const hls = new Hls(
      preview
        ? { autoStartLoad: false, capLevelToPlayerSize: true, maxBufferLength: 6, maxMaxBufferLength: 10, startLevel: 0 }
        : // autoStartLoad:false holds the first fragment until startLevel is
          // chosen below; otherwise hls.js fetches one at its own guess.
          { autoStartLoad: false, capLevelToPlayerSize: false },
    );
    instances.set(video, hls);
    const retries = { network: 0, media: 0 };

    await new Promise((resolve, reject) => {
      let settled = false;
      const settle = (error) => {
        if (settled) return;
        settled = true;
        if (pending.get(video) === settle) pending.delete(video);
        if (error) reject(error);
        else resolve();
      };
      pending.set(video, settle);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        if (!isCurrent()) return;
        if (data.levels?.length) {
          if (preview) {
            // Previews stay on the lowest rendition for their whole life.
            hls.autoLevelCapping = 0;
          } else {
            // startLevel only seeds the first fragment; ABR adapts after.
            hls.startLevel = pickStartLevel(data.levels);
          }
        }
        hls.startLoad();
        settle();
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || !isCurrent()) return;
        if (!settled) {
          // Manifest never arrived: nothing to recover, report to caller.
          if (instances.get(video) === hls) instances.delete(video);
          hls.destroy();
          settle(new Error(data.type));
          return;
        }
        handleFatal(hls, video, data, retries);
      });
      hls.loadSource(hlsSrc);
      hls.attachMedia(video);
    });
  };

  // Stops decoding/buffering for a video whose viewer or preview went away.
  const teardown = (video) => {
    destroy(video);
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  // Stops network activity but keeps the current frame on screen (used
  // when a scroll preview has played long enough).
  const stopLoading = (video) => {
    instances.get(video)?.stopLoad();
  };

  window.ReelupHls = { attach, teardown, stopLoading, prefetch, supportsNativeHls };
})();
