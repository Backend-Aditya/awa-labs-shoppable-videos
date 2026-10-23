// Full-screen story viewer for the Stories widget: segmented progress,
// auto-advance, tap left/right or swipe sideways to move, swipe down to
// close, press-and-hold or the play/pause button (Space / K) to pause, and
// a product sticker that slides up a drawer. Product cards inside the
// drawer are handled by the delegated cart code in reel-lightbox.js.
(() => {
  // Loaded by the embed and possibly again by a block loader.
  if (window.ReelupStory) return;

  const viewer = () => window.ReelupViewer;
  const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  // Stream thumbnails accept ?height=; the avatar is tiny, so don't pull
  // the full-resolution frame for it.
  const sizedPoster = (url, height) => {
    if (!url || !/cloudflarestream\.com|videodelivery\.net/i.test(url) || /[?&]height=/i.test(url)) return url;
    return `${url}${url.includes("?") ? "&" : "?"}height=${height}`;
  };

  const SEEN_KEY = "reelup-seen-stories";
  const SEEN_AFTER_MS = 3000;
  const readSeen = () => {
    try {
      return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"));
    } catch {
      return new Set();
    }
  };
  const markSeen = (reelId) => {
    if (!reelId) return;
    try {
      const seen = [...readSeen().add(reelId)].slice(-200);
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    } catch {
      // Private mode / storage full: rings just stay coloured.
    }
    document
      .querySelectorAll(`[data-reelup-story-group] [data-reelup-trigger][data-reel-id="${CSS.escape(reelId)}"]`)
      .forEach((el) => el.classList.add("is-seen"));
  };

  let reels = [];
  let currentIndex = 0;
  let storyDurationMs = 15000; // the merchant's setting for this reel
  let durationMs = 15000; // min(video length, setting), known once playing
  let timer = null;
  let seenTimer = null;
  let drawerOpen = false;
  let advancing = false;
  let pausedRemainingMs = null;
  let segmentStarted = false;
  // Bumped by every goTo() and by close; async work holding an older token
  // must stop (no playing, advancing, marking seen or tracking).
  let storySeq = 0;
  // Why the story is paused right now. The clock only runs while empty.
  // "buffering" stops the clock but not the video, which carries on by
  // itself once data arrives; every other reason pauses the video too.
  const pauseReasons = new Set();
  const holdsVideo = () => [...pauseReasons].some((reason) => reason !== "buffering");

  const clearTimer = () => {
    clearTimeout(timer);
    timer = null;
  };

  const segmentFill = (dialog, i) =>
    dialog.querySelector(`.reelup-story__segment[data-index="${i}"] .reelup-story__segment-fill`);

  const setSegment = (dialog, i, state) => {
    const fill = segmentFill(dialog, i);
    if (!fill) return;
    fill.style.transition = "none";
    fill.style.transform = state === "done" ? "scaleX(1)" : "scaleX(0)";
    if (state !== "active" || prefersReducedMotion()) return;
    // Reflow so the transition runs from 0 instead of batching both writes.
    void fill.offsetWidth;
    fill.style.transition = `transform ${durationMs}ms linear`;
    fill.style.transform = "scaleX(1)";
  };

  const freezeSegment = (dialog) => {
    const fill = segmentFill(dialog, currentIndex);
    if (!fill) return durationMs;
    const ratio = fill.getBoundingClientRect().width / (fill.parentElement.getBoundingClientRect().width || 1);
    fill.style.transition = "none";
    fill.style.transform = `scaleX(${ratio})`;
    return Math.max(durationMs * (1 - ratio), 0);
  };

  const resumeSegment = (dialog, remaining) => {
    const fill = segmentFill(dialog, currentIndex);
    if (!fill || remaining <= 0 || prefersReducedMotion()) return;
    void fill.offsetWidth;
    fill.style.transition = `transform ${remaining}ms linear`;
    fill.style.transform = "scaleX(1)";
  };

  // Under reduced motion stories never move on by themselves — the shopper
  // advances with next / arrow keys.
  const autoAdvance = () => !prefersReducedMotion();

  const requestAdvance = (dialog) => {
    if (!dialog.open || advancing || !autoAdvance()) return;
    advancing = true;
    goTo(dialog, currentIndex + 1).finally(() => {
      advancing = false;
    });
  };

  const schedule = (dialog, ms) => {
    clearTimer();
    if (!dialog.open || !autoAdvance() || pauseReasons.size > 0) return;
    const token = storySeq;
    timer = setTimeout(() => {
      if (token === storySeq) requestAdvance(dialog);
    }, ms);
  };

  const syncToggle = (dialog) => {
    const toggle = dialog.querySelector("[data-reelup-story-toggle]");
    if (!toggle) return;
    const { labels, icons } = viewer();
    const paused = pauseReasons.has("user");
    toggle.innerHTML = paused ? icons.playSmall : icons.pauseSmall;
    toggle.setAttribute("aria-label", paused ? labels.play : labels.pause);
  };

  const pause = (dialog, reason) => {
    const wasRunning = pauseReasons.size === 0;
    pauseReasons.add(reason);
    if (reason === "user") syncToggle(dialog);
    if (holdsVideo()) dialog.querySelector("video").pause();
    if (!wasRunning) return;
    clearTimer();
    if (segmentStarted) pausedRemainingMs = freezeSegment(dialog);
  };

  const resume = (dialog, reason) => {
    if (!pauseReasons.delete(reason)) return;
    if (reason === "user") syncToggle(dialog);
    if (!dialog.open) return;
    // A video held only by buffering must keep playing to ever un-buffer.
    if (!holdsVideo()) dialog.querySelector("video").play().catch(() => {});
    if (pauseReasons.size > 0) return;
    if (!segmentStarted) return; // the `playing` handler starts the segment
    const remaining = pausedRemainingMs ?? durationMs;
    pausedRemainingMs = null;
    resumeSegment(dialog, remaining);
    schedule(dialog, remaining);
  };

  const togglePause = (dialog) => {
    if (pauseReasons.has("user")) resume(dialog, "user");
    else pause(dialog, "user");
  };

  // The bar and the timer start when the video actually plays (not when the
  // request went out), and the story is "watched" after a few seconds.
  const startSegment = (dialog, token) => {
    if (!dialog.open || token !== storySeq || segmentStarted) return;
    segmentStarted = true;
    const video = dialog.querySelector("video");
    const videoMs = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : Infinity;
    durationMs = Math.max(Math.min(videoMs, storyDurationMs), 1000);
    const trigger = reels[currentIndex];
    viewer()?.trackAnalytics(trigger?.dataset.reelId ?? "", "view", { trigger });
    clearTimeout(seenTimer);
    seenTimer = setTimeout(() => {
      if (token === storySeq && dialog.open) markSeen(trigger?.dataset.reelId);
    }, SEEN_AFTER_MS);
    if (pauseReasons.size > 0) {
      setSegment(dialog, currentIndex, "idle");
      pausedRemainingMs = durationMs;
      return;
    }
    setSegment(dialog, currentIndex, "active");
    schedule(dialog, durationMs);
  };

  const setDrawer = (dialog, open) => {
    const drawer = dialog.querySelector("[data-reelup-story-drawer]");
    if (open === drawerOpen) return;
    drawerOpen = open;
    drawer.hidden = !open;
    dialog.classList.toggle("is-shopping", open);
    if (open) {
      pause(dialog, "drawer");
      drawer.querySelector("button, a, select")?.focus();
    } else {
      resume(dialog, "drawer");
      dialog.querySelector("[data-reelup-story-shop]")?.focus();
    }
  };

  const goTo = async (dialog, target) => {
    if (!dialog.open) return;
    const previous = reels[currentIndex];
    if (target > currentIndex && previous) markSeen(previous.dataset.reelId);
    if (target >= reels.length) {
      dialog.close();
      return;
    }
    const i = Math.max(target, 0);
    const token = ++storySeq;
    const isCurrent = () => dialog.open && token === storySeq && currentIndex === i;

    if (drawerOpen) {
      drawerOpen = false;
      dialog.querySelector("[data-reelup-story-drawer]").hidden = true;
      dialog.classList.remove("is-shopping");
    }
    // Moving on resumes a paused story (like the social apps); a hidden tab
    // stays paused until it's visible again.
    pauseReasons.delete("user");
    pauseReasons.delete("drawer");
    pauseReasons.delete("hold");
    pauseReasons.delete("share");
    pauseReasons.delete("buffering");
    syncToggle(dialog);
    pausedRemainingMs = null;
    segmentStarted = false;
    clearTimer();
    clearTimeout(seenTimer);
    reels.forEach((_, n) => setSegment(dialog, n, n < i ? "done" : "idle"));

    currentIndex = i;
    const trigger = reels[i];
    storyDurationMs = parseInt(trigger.dataset.storyDuration, 10) || 15000;
    durationMs = storyDurationMs;
    const reelId = trigger.dataset.reelId ?? "";
    dialog.progress.flush();
    dialog.setAttribute("data-reelup-reel-id", reelId);
    dialog.reelupTrigger = trigger;

    const video = dialog.querySelector("video");
    const title = dialog.querySelector(".reelup-story__title");
    const avatar = dialog.querySelector(".reelup-story__avatar");
    window.ReelupHls?.teardown(video);
    dialog.buffering.reset();

    title.textContent = trigger.dataset.title ?? "";
    viewer()?.nameDialog(dialog, "reelup-story-title", trigger.dataset.title);
    const poster = trigger.dataset.posterUrl;
    if (poster) {
      video.setAttribute("poster", poster);
      avatar.style.backgroundImage = `url("${sizedPoster(poster, 120).replace(/"/g, "%22")}")`;
    } else {
      video.removeAttribute("poster");
      avatar.style.backgroundImage = "";
    }

    viewer()?.applyViewerSettings(dialog, video, null, trigger);
    dialog.querySelector("[data-reelup-story-share]").hidden = trigger.dataset.showShare === "false";
    video.dispatchEvent(new Event("volumechange"));

    const list = dialog.querySelector("[data-reelup-story-list]");
    const count = viewer()?.cloneProducts(trigger, list) ?? 0;
    const sticker = dialog.querySelector("[data-reelup-story-shop]");
    const linkUrl = viewer()?.safeLink(trigger.dataset.linkUrl) ?? "";
    // No products but a link button: the sticker goes straight to the link.
    sticker.dataset.link = count === 0 ? linkUrl : "";
    sticker.querySelector(".reelup-story__sticker-label").textContent =
      count === 0 && linkUrl ? trigger.dataset.linkLabel || viewer().labels.learnMore : viewer().labels.shop;
    sticker.hidden = count === 0 && !linkUrl;
    if (count === 0) sticker.querySelector(".reelup-story__sticker-thumb").hidden = true;
    if (count > 0) {
      const firstImage = list.querySelector(".reelup-product__media img");
      const thumb = sticker.querySelector(".reelup-story__sticker-thumb");
      thumb.style.backgroundImage = firstImage ? `url("${firstImage.src.replace(/"/g, "%22")}")` : "";
      thumb.hidden = !firstImage;
      sticker.querySelector(".reelup-story__sticker-count").textContent = count > 1 ? String(count) : "";
    }
    dialog.querySelector("[data-reelup-cart-status]").hidden = true;

    let failed = false;
    let started = false;
    try {
      started = await viewer()?.startPlayback(video, trigger.dataset.hlsSrc, isCurrent);
    } catch {
      failed = true;
    }
    if (failed && isCurrent()) dialog.buffering.fail();
    if (!dialog.open) {
      window.ReelupHls?.teardown(video);
      return;
    }
    if (!isCurrent()) return;
    if (pauseReasons.size > 0) video.pause();
    // A broken reel still gets its segment and timer, so it can't trap the
    // viewer; a working one starts on `playing` (or now, if that already
    // fired before this await resumed).
    if (failed || !started || !video.paused) startSegment(dialog, token);
  };

  const build = () => {
    const existing = document.getElementById("reelup-story-viewer");
    if (existing) return existing;
    const { labels, icons, escapeHtml } = viewer();
    const L = Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, escapeHtml(v)]));

    const dialog = document.createElement("dialog");
    dialog.id = "reelup-story-viewer";
    dialog.className = `reelup-story${viewer().theme === "light" ? " reelup-viewer--light" : ""}`;
    dialog.setAttribute("aria-labelledby", "reelup-story-title");
    dialog.innerHTML = `
      <div class="reelup-story__frame">
        <video class="reelup-story__video" playsinline muted></video>
        <div class="reelup-story__shade" aria-hidden="true"></div>
        <span class="reelup-spinner" aria-hidden="true"></span>
        <div class="reelup-story__progress" data-reelup-story-progress aria-hidden="true"></div>
        <header class="reelup-story__header">
          <span class="reelup-story__avatar" aria-hidden="true"></span>
          <h2 class="reelup-story__title" id="reelup-story-title"></h2>
          <button type="button" class="reelup-viewer__icon" data-reelup-story-toggle aria-label="${L.pause}">${icons.pauseSmall}</button>
          <button type="button" class="reelup-viewer__icon" data-reelup-story-share aria-label="${L.share}" hidden>${icons.share}</button>
          <button type="button" class="reelup-viewer__icon" data-reelup-story-mute></button>
          <button type="button" class="reelup-viewer__icon" data-reelup-story-close aria-label="${L.close}">${icons.close}</button>
        </header>
        <button type="button" class="reelup-story__tap reelup-story__tap--prev" data-reelup-story-prev aria-label="${L.previous}"></button>
        <button type="button" class="reelup-story__tap reelup-story__tap--next" data-reelup-story-next aria-label="${L.next}"></button>
        <button type="button" class="reelup-story__sticker" data-reelup-story-shop hidden>
          <span class="reelup-story__sticker-thumb" aria-hidden="true"></span>
          <span class="reelup-story__sticker-label">${L.shop}</span>
          <span class="reelup-story__sticker-count"></span>
        </button>
        <div class="reelup-toast" aria-hidden="true"></div>
        <div class="reelup-story__drawer" data-reelup-story-drawer hidden>
          <div class="reelup-story__drawer-head">
            <span>${L.shop}</span>
            <button type="button" class="reelup-viewer__icon reelup-viewer__icon--light" data-reelup-story-drawer-close aria-label="${L.closeProducts}">${icons.down}</button>
          </div>
          <div class="reelup-story__list" data-reelup-story-list></div>
          <p class="reelup-viewer__cart" data-reelup-cart-status hidden>
            <span class="reelup-cart-message"></span>
            <a href="${escapeHtml(viewer().cartUrl)}">${L.viewCart}</a>
          </p>
        </div>
      </div>
    `;
    dialog.appendChild(viewer().makeLiveRegion());
    document.body.appendChild(dialog);

    const video = dialog.querySelector("video");
    const frame = dialog.querySelector(".reelup-story__frame");
    const mute = dialog.querySelector("[data-reelup-story-mute]");
    dialog.buffering = viewer().watchBuffering(video, frame);
    dialog.progress = viewer().watchProgress(
      video,
      () => dialog.getAttribute("data-reelup-reel-id"),
      () => dialog.reelupTrigger,
    );
    video.addEventListener("volumechange", () => {
      mute.innerHTML = video.muted ? icons.muted : icons.unmuted;
      mute.setAttribute("aria-label", video.muted ? labels.unmute : labels.mute);
    });
    mute.addEventListener("click", () => {
      video.muted = !video.muted;
      viewer().setUserMuted(video.muted);
    });
    video.addEventListener("playing", () => {
      startSegment(dialog, storySeq);
      resume(dialog, "buffering");
    });
    // A stall mid-story stops the clock, so a slow connection never moves
    // on from a story the shopper hasn't actually seen.
    video.addEventListener("waiting", () => {
      if (segmentStarted && dialog.open) pause(dialog, "buffering");
    });
    video.addEventListener("ended", () => requestAdvance(dialog));

    const step = (delta) => {
      advancing = false;
      goTo(dialog, currentIndex + delta);
    };
    dialog.querySelector("[data-reelup-story-toggle]").addEventListener("click", () => togglePause(dialog));
    dialog.querySelector("[data-reelup-story-close]").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-reelup-story-share]").addEventListener("click", () => {
      const trigger = reels[currentIndex];
      if (!trigger) return;
      pause(dialog, "share");
      viewer()
        .share(frame, trigger.dataset.reelId, trigger.dataset.title || document.title)
        .finally(() => resume(dialog, "share"));
    });
    dialog.querySelector("[data-reelup-story-prev]").addEventListener("click", () => step(-1));
    dialog.querySelector("[data-reelup-story-next]").addEventListener("click", () => step(1));
    dialog.querySelector("[data-reelup-story-shop]").addEventListener("click", (event) => {
      const link = event.currentTarget.dataset.link;
      if (link) {
        viewer().trackAnalytics(reels[currentIndex]?.dataset.reelId, "click_product", { trigger: reels[currentIndex] });
        window.location.href = link;
        return;
      }
      setDrawer(dialog, true);
    });
    dialog.querySelector("[data-reelup-story-drawer-close]").addEventListener("click", () => setDrawer(dialog, false));

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.target.closest?.("select, input, textarea")) return;
      if (drawerOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setDrawer(dialog, false);
        }
        return;
      }
      const key = event.key;
      // Space on a focused button already activates that button.
      if ((key === " " && !event.target.closest?.("button, a")) || key === "k" || key === "K") {
        event.preventDefault();
        togglePause(dialog);
        return;
      }
      const rtl = viewer().isRtl(dialog);
      if (key === (rtl ? "ArrowRight" : "ArrowLeft")) step(-1);
      else if (key === (rtl ? "ArrowLeft" : "ArrowRight")) step(1);
    });
    dialog.addEventListener("close", () => {
      storySeq += 1;
      dialog.progress.flush();
      clearTimer();
      clearTimeout(seenTimer);
      pauseReasons.clear();
      segmentStarted = false;
      window.ReelupHls?.teardown(video);
      drawerOpen = false;
      dialog.classList.remove("is-shopping");
      dialog.querySelector("[data-reelup-story-drawer]").hidden = true;
      document.documentElement.classList.remove("reelup-locked");
      document.dispatchEvent(new CustomEvent("reelup:viewer-change"));
      reels[currentIndex]?.querySelector(".reelup-trigger__button")?.focus({ preventScroll: true });
    });

    document.addEventListener("visibilitychange", () => {
      if (!dialog.open) return;
      if (document.hidden) pause(dialog, "hidden");
      else resume(dialog, "hidden");
    });

    // Press and hold anywhere on the video to pause, like the social apps
    // shoppers already know. Buttons keep their own taps.
    let held = false;
    let holdTimer = null;
    let swipeStart = null;
    let swiped = false;
    frame.addEventListener("pointerdown", (event) => {
      if (drawerOpen || event.target.closest("button:not(.reelup-story__tap), a, select, [data-reelup-story-drawer]")) return;
      holdTimer = setTimeout(() => {
        held = true;
        pause(dialog, "hold");
      }, 180);
    });
    frame.addEventListener("click", (event) => {
      // A hold or swipe that ended over a tap zone isn't also a tap.
      if ((held || swiped) && event.target.closest("[data-reelup-story-prev], [data-reelup-story-next]")) {
        event.stopImmediatePropagation();
      }
      swiped = false;
    }, true);
    const release = () => {
      clearTimeout(holdTimer);
      if (!held) return;
      held = false;
      resume(dialog, "hold");
    };
    frame.addEventListener("pointerup", () => setTimeout(release, 0));
    frame.addEventListener("pointercancel", release);
    frame.addEventListener("pointerleave", release);

    // Swipes, as on the social apps shoppers know: down closes, sideways
    // moves between stories (in reading direction). Touch events, because
    // the browser may claim the gesture and cancel its pointer events.
    frame.addEventListener("touchstart", (event) => {
      swiped = false;
      swipeStart =
        event.touches.length === 1 && !drawerOpen && !event.target.closest("[data-reelup-story-drawer]")
          ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
          : null;
    }, { passive: true });
    frame.addEventListener("touchend", (event) => {
      if (!swipeStart) return;
      const dx = event.changedTouches[0].clientX - swipeStart.x;
      const dy = event.changedTouches[0].clientY - swipeStart.y;
      swipeStart = null;
      if (dy > 80 && dy > Math.abs(dx) * 1.5) {
        swiped = true;
        dialog.close();
      } else if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swiped = true;
        step((dx < 0) !== viewer().isRtl(dialog) ? 1 : -1);
      }
    });

    return dialog;
  };

  const openViewer = (groupEl, startIndex) => {
    if (!viewer()) return;
    reels = Array.from(groupEl.querySelectorAll("[data-reelup-trigger]"));
    if (reels.length === 0) return;
    const dialog = build();
    dialog.querySelector("[data-reelup-story-progress]").innerHTML = reels
      .map((_, i) => `<span class="reelup-story__segment" data-index="${i}"><span class="reelup-story__segment-fill"></span></span>`)
      .join("");
    currentIndex = startIndex;
    if (!dialog.open) {
      dialog.showModal();
      document.documentElement.classList.add("reelup-locked");
      document.dispatchEvent(new CustomEvent("reelup:viewer-change"));
      dialog.querySelector("[data-reelup-story-close]")?.focus();
    }
    goTo(dialog, startIndex);
  };

  const bindAll = () => {
    const seen = readSeen();
    document.querySelectorAll("[data-reelup-story-group]").forEach((group) => {
      const triggers = Array.from(group.querySelectorAll("[data-reelup-trigger]"));
      triggers.forEach((trigger) => {
        if (seen.has(trigger.dataset.reelId)) trigger.classList.add("is-seen");
      });
      if (group.dataset.reelupStoryBound) return;
      group.dataset.reelupStoryBound = "true";
      triggers.forEach((trigger, i) => {
        trigger.querySelector(".reelup-trigger__button")?.addEventListener("click", () => openViewer(group, i));
      });
    });
  };

  window.ReelupStory = { open: openViewer, bind: bindAll };
  bindAll();
  document.addEventListener("shopify:section:load", bindAll);
})();
