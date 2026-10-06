(() => {
  const prefersReducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  let currentDurationMs = 15000;

  let reels = [];
  let currentIndex = 0;
  let timer = null;
  let drawerOpen = false;
  let advancing = false;
  let pausedRemainingMs = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const requestAdvance = (dialog) => {
    if (advancing) return;
    advancing = true;
    goTo(dialog, currentIndex + 1).finally(() => {
      advancing = false;
    });
  };

  const renderProgress = (dialog) => {
    const progress = dialog.querySelector("[data-reelup-story-progress]");
    progress.innerHTML = reels
      .map(
        (_, i) =>
          `<div class="reelup-story__segment" data-index="${i}"><div class="reelup-story__segment-fill"></div></div>`,
      )
      .join("");
  };

  const setSegmentState = (dialog, index, state) => {
    const segment = dialog.querySelector(`.reelup-story__segment[data-index="${index}"]`);
    const fill = segment?.querySelector(".reelup-story__segment-fill");
    if (!fill) return;

    if (state === "done") {
      fill.style.transition = "none";
      fill.style.width = "100%";
    } else if (state === "active") {
      fill.style.transition = "none";
      fill.style.width = "0%";
      if (prefersReducedMotion()) return;
      // Force a reflow so the transition below animates from 0% instead
      // of the two inline-style writes batching into one recalculation
      // and jumping straight to 100%.
      void fill.offsetWidth;
      fill.style.transition = `width ${currentDurationMs}ms linear`;
      fill.style.width = "100%";
    } else {
      fill.style.transition = "none";
      fill.style.width = "0%";
    }
  };

  const freezeActiveSegment = (dialog) => {
    const segment = dialog.querySelector(`.reelup-story__segment[data-index="${currentIndex}"]`);
    const fill = segment?.querySelector(".reelup-story__segment-fill");
    if (!fill) return currentDurationMs;

    const segmentWidth = segment.getBoundingClientRect().width;
    const fillWidth = fill.getBoundingClientRect().width;
    const percent = segmentWidth > 0 ? fillWidth / segmentWidth : 0;

    fill.style.transition = "none";
    fill.style.width = `${percent * 100}%`;

    return Math.max(currentDurationMs * (1 - percent), 0);
  };

  const resumeActiveSegment = (dialog, remainingMs) => {
    const segment = dialog.querySelector(`.reelup-story__segment[data-index="${currentIndex}"]`);
    const fill = segment?.querySelector(".reelup-story__segment-fill");
    if (!fill || remainingMs <= 0) return;
    if (prefersReducedMotion()) return;

    // Force a reflow so the transition below animates from the frozen width
    // instead of the two inline-style writes batching into one recalculation.
    void fill.offsetWidth;
    fill.style.transition = `width ${remainingMs}ms linear`;
    fill.style.width = "100%";
  };

  const closeDrawerImmediate = (dialog) => {
    dialog.querySelector("[data-reelup-story-drawer]").hidden = true;
    drawerOpen = false;
  };

  const openDrawer = (dialog) => {
    dialog.querySelector("[data-reelup-story-drawer]").hidden = false;
    drawerOpen = true;
    dialog.querySelector(".reelup-story__video").pause();
    clearTimer();
    pausedRemainingMs = freezeActiveSegment(dialog);
  };

  const closeDrawer = (dialog) => {
    closeDrawerImmediate(dialog);
    dialog.querySelector(".reelup-story__video").play().catch(() => {});

    const remaining = pausedRemainingMs ?? currentDurationMs;
    pausedRemainingMs = null;
    resumeActiveSegment(dialog, remaining);
    clearTimer();
    timer = setTimeout(() => requestAdvance(dialog), remaining);
  };

  const scheduleAdvance = (dialog) => {
    clearTimer();
    timer = setTimeout(() => requestAdvance(dialog), currentDurationMs);
  };

  const trackAnalytics = async (reelId, eventType) => {
    if (!reelId) return;
    try {
      await fetch("/apps/reels/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopDomain: window.Shopify?.shop,
          reelId,
          eventType,
        }),
      });
    } catch (e) {
      console.error("Failed to track", e);
    }
  };

  const goTo = async (dialog, targetIndex) => {
    const index = Math.max(targetIndex, 0);
    if (index >= reels.length) {
      dialog.close();
      return;
    }

    if (drawerOpen) closeDrawerImmediate(dialog);

    reels.forEach((_, i) => {
      if (i < index) setSegmentState(dialog, i, "done");
      else if (i > index) setSegmentState(dialog, i, "idle");
    });

    currentIndex = index;
    const trigger = reels[index];

    currentDurationMs = parseInt(trigger.dataset.storyDuration, 10) || 15000;

    const reelId = trigger.dataset.reelId;
    dialog.dataset.currentReelId = reelId;
    if (reelId) trackAnalytics(reelId, "view");

    const video = dialog.querySelector(".reelup-story__video");
    const title = dialog.querySelector(".reelup-story__title");
    const closeButton = dialog.querySelector("[data-reelup-story-close]");
    const shopButton = dialog.querySelector("[data-reelup-story-shop]");
    const drawerHeading = dialog.querySelector("[data-reelup-story-drawer-heading]");
    const drawerList = dialog.querySelector("[data-reelup-story-drawer-list]");

    clearTimer();
    window.ReelupHls?.teardown(video);

    title.textContent = trigger.dataset.title ?? "";
    closeButton.setAttribute("aria-label", trigger.dataset.closeLabel ?? "Close");
    dialog.dataset.muteLabel = trigger.dataset.muteLabel ?? "Mute";
    dialog.dataset.unmuteLabel = trigger.dataset.unmuteLabel ?? "Unmute";
    const posterUrl = trigger.dataset.posterUrl;
    if (posterUrl) {
      video.setAttribute("poster", posterUrl);
    } else {
      video.removeAttribute("poster");
    }

    window.ReelupViewerSettings?.applyDialogSettings(dialog, video, title, trigger);
    // applyDialogSettings may set video.muted to the SAME value it already
    // had (no native "volumechange" fires then), so force the icon's own
    // listener to re-check explicitly rather than relying on that event.
    video.dispatchEvent(new Event("volumechange"));

    drawerList.replaceChildren();
    const template = trigger.querySelector("template[data-reelup-products]");
    if (template) {
      const shopLabel = trigger.dataset.shopLabel ?? "";
      drawerHeading.textContent = shopLabel;
      drawerList.appendChild(template.content.cloneNode(true));
      shopButton.hidden = false;
      shopButton.textContent = shopLabel;
      window.ReelupViewerSettings?.applyProductListSettings(drawerList, trigger);
    } else {
      shopButton.hidden = true;
    }

    setSegmentState(dialog, index, "active");

    // See reel-lightbox.js's open() for why: attach() can await a network
    // fetch that outlasts the transient-activation window from the
    // triggering click, so unmuted play() after it resolves can be silently
    // rejected. Start muted (always allowed), restore the real mute state
    // once attach() resolves.
    const desiredMuted = video.muted;
    video.muted = true;
    video.play().catch(() => {});

    try {
      await window.ReelupHls.attach(video, trigger.dataset.hlsSrc);
      video.muted = desiredMuted;
      await video.play();
    } catch {
      // Playback failed to initialize; still advance on schedule below so
      // the shopper isn't stuck on a broken segment forever.
    }
    scheduleAdvance(dialog);
  };

  const buildViewer = () => {
    const existing = document.getElementById("reelup-story-viewer");
    if (existing) return existing;

    const mutedSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0 0 14 8.03v1.97l2.42 2.42c.05-.15.08-.3.08-.42zm2.5 0c0 .94-.2 1.82-.54 2.63l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>`;
    const unmutedSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.03v7.94c1.48-.73 2.5-2.25 2.5-3.97zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;

    const dialog = document.createElement("dialog");
    dialog.id = "reelup-story-viewer";
    dialog.className = "reelup-story";
    dialog.setAttribute("aria-labelledby", "reelup-story-title");
    dialog.innerHTML = `
      <div class="reelup-story__progress" data-reelup-story-progress></div>
      <button type="button" class="reelup-story__close" data-reelup-story-close aria-label="Close">&times;</button>
      <div class="reelup-story__frame">
        <h2 id="reelup-story-title" class="reelup-story__title"></h2>
        <video class="reelup-story__video" playsinline muted></video>
        <button type="button" class="reelup-story__mute" data-reelup-story-mute>${unmutedSvg}</button>
        <button type="button" class="reelup-story__nav reelup-story__nav--prev" data-reelup-story-prev aria-label="Previous">&lsaquo;</button>
        <button type="button" class="reelup-story__nav reelup-story__nav--next" data-reelup-story-next aria-label="Next">&rsaquo;</button>
        <button type="button" class="reelup-story__shop" data-reelup-story-shop hidden></button>
      </div>
      <div class="reelup-story__drawer" data-reelup-story-drawer hidden>
        <button type="button" class="reelup-story__drawer-handle" data-reelup-story-drawer-close aria-label="Close products"></button>
        <h3 class="reelup-lightbox__products-heading" data-reelup-story-drawer-heading></h3>
        <div class="reelup-lightbox__products-list" data-reelup-story-drawer-list></div>
      </div>
    `;
    document.body.appendChild(dialog);

    const video = dialog.querySelector(".reelup-story__video");
    const drawerList = dialog.querySelector("[data-reelup-story-drawer-list]");
    const muteBtn = dialog.querySelector("[data-reelup-story-mute]");

    const updateMuteIcon = () => {
      muteBtn.innerHTML = video.muted ? mutedSvg : unmutedSvg;
      muteBtn.setAttribute(
        "aria-label",
        video.muted ? (dialog.dataset.unmuteLabel ?? "Unmute") : (dialog.dataset.muteLabel ?? "Mute"),
      );
    };
    muteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      video.muted = !video.muted;
    });
    video.addEventListener("volumechange", updateMuteIcon);

    dialog.querySelector("[data-reelup-story-close]").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-reelup-story-prev]").addEventListener("click", () => {
      advancing = false;
      goTo(dialog, currentIndex - 1);
    });
    dialog.querySelector("[data-reelup-story-next]").addEventListener("click", () => {
      advancing = false;
      goTo(dialog, currentIndex + 1);
    });
    dialog.querySelector("[data-reelup-story-shop]").addEventListener("click", () => openDrawer(dialog));
    dialog
      .querySelector("[data-reelup-story-drawer-close]")
      .addEventListener("click", () => closeDrawer(dialog));

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });

    dialog.addEventListener("close", () => {
      clearTimer();
      window.ReelupHls?.teardown(video);
      closeDrawerImmediate(dialog);
    });

    dialog.addEventListener("keydown", (event) => {
      if (drawerOpen) return;
      if (event.key === "ArrowLeft") {
        advancing = false;
        goTo(dialog, currentIndex - 1);
      } else if (event.key === "ArrowRight") {
        advancing = false;
        goTo(dialog, currentIndex + 1);
      }
    });

    const frame = dialog.querySelector(".reelup-story__frame");
    let heldForPause = false;

    // Press-and-hold-to-pause: Instagram-style convention shoppers already
    // expect from story UIs. Scoped to the frame (not the nav buttons that
    // overlay it) so a tap-to-advance click on those keeps working untouched
    // — a pointerdown here never fires on those buttons since they stop
    // their own clicks from needing this at all.
    frame.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      heldForPause = true;
      video.pause();
      clearTimer();
      pausedRemainingMs = freezeActiveSegment(dialog);
    });

    const releaseHold = () => {
      if (!heldForPause) return;
      heldForPause = false;
      video.play().catch(() => {});
      const remaining = pausedRemainingMs ?? currentDurationMs;
      pausedRemainingMs = null;
      resumeActiveSegment(dialog, remaining);
      timer = setTimeout(() => requestAdvance(dialog), remaining);
    };

    frame.addEventListener("pointerup", releaseHold);
    frame.addEventListener("pointercancel", releaseHold);
    frame.addEventListener("pointerleave", releaseHold);

    video.addEventListener("ended", () => requestAdvance(dialog));

    drawerList.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-reelup-add-to-cart]");
      const link = event.target.closest(".reelup-lightbox__product-link");

      if (dialog.dataset.currentReelId && (button || link)) {
        trackAnalytics(dialog.dataset.currentReelId, "click_product");
      }

      if (!button || button.dataset.state === "loading") return;

      const variantId = button.dataset.variantId;
      const addLabel = button.dataset.addLabel ?? button.textContent;
      const addedLabel = button.dataset.addedLabel ?? addLabel;

      button.dataset.state = "loading";

      try {
        // See the identical comment in reel-lightbox.js: a hidden line-item
        // property that rides along through checkout onto the order, read
        // back off by the orders/paid webhook for revenue attribution.
        const body = { id: variantId, quantity: 1 };
        if (dialog.dataset.currentReelId) {
          body.properties = { _reelup_reel_id: dialog.dataset.currentReelId };
        }
        const response = await fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error("Add to cart failed");

        document.dispatchEvent(new CustomEvent("cart:refresh"));
        button.dataset.state = "added";
        button.textContent = addedLabel;
      } catch {
        button.dataset.state = "";
        button.textContent = addLabel;
        return;
      }

      setTimeout(() => {
        button.dataset.state = "";
        button.textContent = addLabel;
      }, 2000);
    });

    return dialog;
  };

  const openViewer = (groupEl, startIndex) => {
    reels = Array.from(groupEl.querySelectorAll("[data-reelup-trigger]"));
    if (reels.length === 0) return;

    const dialog = buildViewer();
    renderProgress(dialog);
    dialog.showModal();
    goTo(dialog, startIndex);
  };

  const hoverCapable = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;

  document.querySelectorAll("[data-reelup-story-group]").forEach((group) => {
    if (group.dataset.reelupStoryGroupBound) return;
    group.dataset.reelupStoryGroupBound = "true";

    Array.from(group.querySelectorAll("[data-reelup-trigger]")).forEach((trigger, index) => {
      const button = trigger.querySelector(".reelup-trigger__button");
      if (!button) return;
      const open = () => openViewer(group, index);

      // Same hover-capable guard as reel-trigger.js's standalone triggers —
      // touch devices keep the default click-to-open.
      if (trigger.dataset.playTrigger === "hover" && hoverCapable) {
        button.addEventListener("mouseenter", open);
      } else {
        button.addEventListener("click", open);
      }
    });
  });
})();
