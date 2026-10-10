// Full-screen story viewer for the Stories widget: segmented progress,
// auto-advance, tap left/right to move, press-and-hold to pause, and a
// product sticker that slides up a drawer. Product cards inside the drawer
// are handled by the delegated cart code in reel-lightbox.js.
(() => {
  const viewer = () => window.ReelupViewer;
  const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const SEEN_KEY = "reelup-seen-stories";
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
  let durationMs = 15000;
  let timer = null;
  let drawerOpen = false;
  let advancing = false;
  let pausedRemainingMs = null;

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

  const requestAdvance = (dialog) => {
    if (advancing) return;
    advancing = true;
    goTo(dialog, currentIndex + 1).finally(() => {
      advancing = false;
    });
  };

  const schedule = (dialog, ms) => {
    clearTimer();
    timer = setTimeout(() => requestAdvance(dialog), ms);
  };

  const pause = (dialog) => {
    dialog.querySelector("video").pause();
    clearTimer();
    pausedRemainingMs = freezeSegment(dialog);
  };

  const resume = (dialog) => {
    dialog.querySelector("video").play().catch(() => {});
    const remaining = pausedRemainingMs ?? durationMs;
    pausedRemainingMs = null;
    resumeSegment(dialog, remaining);
    schedule(dialog, remaining);
  };

  const setDrawer = (dialog, open) => {
    const drawer = dialog.querySelector("[data-reelup-story-drawer]");
    if (open === drawerOpen) return;
    drawerOpen = open;
    drawer.hidden = !open;
    dialog.classList.toggle("is-shopping", open);
    if (open) {
      pause(dialog);
      drawer.querySelector("button, a, select")?.focus();
    } else {
      resume(dialog);
    }
  };

  const goTo = async (dialog, target) => {
    if (target >= reels.length) {
      dialog.close();
      return;
    }
    const i = Math.max(target, 0);
    if (drawerOpen) {
      drawerOpen = false;
      dialog.querySelector("[data-reelup-story-drawer]").hidden = true;
      dialog.classList.remove("is-shopping");
    }
    pausedRemainingMs = null;
    reels.forEach((_, n) => {
      if (n !== i) setSegment(dialog, n, n < i ? "done" : "idle");
    });

    currentIndex = i;
    const trigger = reels[i];
    durationMs = parseInt(trigger.dataset.storyDuration, 10) || 15000;
    const reelId = trigger.dataset.reelId ?? "";
    dialog.setAttribute("data-reelup-reel-id", reelId);
    markSeen(reelId);
    viewer()?.trackAnalytics(reelId, "view");

    const video = dialog.querySelector("video");
    const title = dialog.querySelector(".reelup-story__title");
    const avatar = dialog.querySelector(".reelup-story__avatar");
    clearTimer();
    window.ReelupHls?.teardown(video);

    title.textContent = trigger.dataset.title ?? "";
    const poster = trigger.dataset.posterUrl;
    if (poster) {
      video.setAttribute("poster", poster);
      avatar.style.backgroundImage = `url("${poster.replace(/"/g, "%22")}")`;
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
    sticker.hidden = count === 0;
    if (count > 0) {
      const firstImage = list.querySelector(".reelup-product__media img");
      const thumb = sticker.querySelector(".reelup-story__sticker-thumb");
      thumb.style.backgroundImage = firstImage ? `url("${firstImage.src.replace(/"/g, "%22")}")` : "";
      thumb.hidden = !firstImage;
      sticker.querySelector(".reelup-story__sticker-count").textContent = count > 1 ? String(count) : "";
    }
    dialog.querySelector("[data-reelup-cart-status]").hidden = true;

    setSegment(dialog, i, "active");
    try {
      await viewer()?.startPlayback(video, trigger.dataset.hlsSrc);
    } catch {
      // Still advance on schedule so a broken reel can't trap the viewer.
    }
    if (currentIndex === i && !drawerOpen) schedule(dialog, durationMs);
  };

  const build = () => {
    const existing = document.getElementById("reelup-story-viewer");
    if (existing) return existing;
    const { labels, icons } = viewer();

    const dialog = document.createElement("dialog");
    dialog.id = "reelup-story-viewer";
    dialog.className = `reelup-story${viewer().theme === "light" ? " reelup-viewer--light" : ""}`;
    dialog.setAttribute("aria-labelledby", "reelup-story-title");
    dialog.innerHTML = `
      <div class="reelup-story__frame">
        <video class="reelup-story__video" playsinline muted></video>
        <div class="reelup-story__shade" aria-hidden="true"></div>
        <div class="reelup-story__progress" data-reelup-story-progress aria-hidden="true"></div>
        <header class="reelup-story__header">
          <span class="reelup-story__avatar" aria-hidden="true"></span>
          <h2 class="reelup-story__title" id="reelup-story-title"></h2>
          <button type="button" class="reelup-viewer__icon" data-reelup-story-share aria-label="${labels.share}" hidden>${icons.share}</button>
          <button type="button" class="reelup-viewer__icon" data-reelup-story-mute></button>
          <button type="button" class="reelup-viewer__icon" data-reelup-story-close aria-label="${labels.close}">${icons.close}</button>
        </header>
        <button type="button" class="reelup-story__tap reelup-story__tap--prev" data-reelup-story-prev aria-label="${labels.previous}"></button>
        <button type="button" class="reelup-story__tap reelup-story__tap--next" data-reelup-story-next aria-label="${labels.next}"></button>
        <button type="button" class="reelup-story__sticker" data-reelup-story-shop hidden>
          <span class="reelup-story__sticker-thumb" aria-hidden="true"></span>
          <span>${labels.shop}</span>
          <span class="reelup-story__sticker-count"></span>
        </button>
        <div class="reelup-story__drawer" data-reelup-story-drawer hidden>
          <div class="reelup-story__drawer-head">
            <span>${labels.shop}</span>
            <button type="button" class="reelup-viewer__icon reelup-viewer__icon--light" data-reelup-story-drawer-close aria-label="${labels.closeProducts}">${icons.down}</button>
          </div>
          <div class="reelup-story__list" data-reelup-story-list></div>
          <p class="reelup-viewer__cart" data-reelup-cart-status hidden>
            <span class="reelup-cart-message" aria-live="polite"></span>
            <a href="${viewer().cartUrl}">${labels.viewCart}</a>
          </p>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);

    const video = dialog.querySelector("video");
    const frame = dialog.querySelector(".reelup-story__frame");
    const mute = dialog.querySelector("[data-reelup-story-mute]");
    video.addEventListener("volumechange", () => {
      mute.innerHTML = video.muted ? icons.muted : icons.unmuted;
      mute.setAttribute("aria-label", video.muted ? labels.unmute : labels.mute);
    });
    mute.addEventListener("click", () => {
      video.muted = !video.muted;
    });
    video.addEventListener("ended", () => requestAdvance(dialog));

    const step = (delta) => {
      advancing = false;
      goTo(dialog, currentIndex + delta);
    };
    dialog.querySelector("[data-reelup-story-close]").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-reelup-story-share]").addEventListener("click", () => {
      const trigger = reels[currentIndex];
      if (!trigger) return;
      pause(dialog);
      viewer()
        .share(frame, trigger.dataset.reelId, trigger.dataset.title || document.title)
        .finally(() => {
          if (dialog.open && !drawerOpen) resume(dialog);
        });
    });
    dialog.querySelector("[data-reelup-story-prev]").addEventListener("click", () => step(-1));
    dialog.querySelector("[data-reelup-story-next]").addEventListener("click", () => step(1));
    dialog.querySelector("[data-reelup-story-shop]").addEventListener("click", () => setDrawer(dialog, true));
    dialog.querySelector("[data-reelup-story-drawer-close]").addEventListener("click", () => setDrawer(dialog, false));

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.target.closest?.("select, input")) return;
      if (drawerOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setDrawer(dialog, false);
        }
        return;
      }
      if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
    });
    dialog.addEventListener("close", () => {
      clearTimer();
      window.ReelupHls?.teardown(video);
      drawerOpen = false;
      dialog.classList.remove("is-shopping");
      dialog.querySelector("[data-reelup-story-drawer]").hidden = true;
      document.documentElement.classList.remove("reelup-locked");
      document.dispatchEvent(new CustomEvent("reelup:viewer-change"));
      reels[currentIndex]?.querySelector(".reelup-trigger__button")?.focus({ preventScroll: true });
    });

    // Press and hold anywhere on the video to pause, like the social apps
    // shoppers already know. Buttons keep their own taps.
    let held = false;
    let holdTimer = null;
    frame.addEventListener("pointerdown", (event) => {
      if (drawerOpen || event.target.closest("button:not(.reelup-story__tap), a, select, [data-reelup-story-drawer]")) return;
      holdTimer = setTimeout(() => {
        held = true;
        pause(dialog);
      }, 180);
    });
    frame.addEventListener("click", (event) => {
      // A hold that ended over a tap zone shouldn't also count as a tap.
      if (held && event.target.closest("[data-reelup-story-prev], [data-reelup-story-next]")) {
        event.stopImmediatePropagation();
      }
    }, true);
    const release = () => {
      clearTimeout(holdTimer);
      if (!held) return;
      held = false;
      resume(dialog);
    };
    frame.addEventListener("pointerup", () => setTimeout(release, 0));
    frame.addEventListener("pointercancel", release);
    frame.addEventListener("pointerleave", release);

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
    if (!dialog.open) {
      dialog.showModal();
      document.documentElement.classList.add("reelup-locked");
      document.dispatchEvent(new CustomEvent("reelup:viewer-change"));
    }
    goTo(dialog, startIndex);
  };

  const hoverCapable = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;

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
        const button = trigger.querySelector(".reelup-trigger__button");
        if (!button) return;
        const open = () => openViewer(group, i);
        if (trigger.dataset.playTrigger === "hover" && hoverCapable) button.addEventListener("mouseenter", open);
        button.addEventListener("click", open);
      });
    });
  };

  bindAll();
  document.addEventListener("shopify:section:load", bindAll);
})();
