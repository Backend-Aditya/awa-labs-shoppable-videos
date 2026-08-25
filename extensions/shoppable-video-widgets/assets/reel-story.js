(() => {
  const DURATION_MS = 15000;

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
      // Force a reflow so the transition below animates from 0% instead
      // of the two inline-style writes batching into one recalculation
      // and jumping straight to 100%.
      void fill.offsetWidth;
      fill.style.transition = `width ${DURATION_MS}ms linear`;
      fill.style.width = "100%";
    } else {
      fill.style.transition = "none";
      fill.style.width = "0%";
    }
  };

  const freezeActiveSegment = (dialog) => {
    const segment = dialog.querySelector(`.reelup-story__segment[data-index="${currentIndex}"]`);
    const fill = segment?.querySelector(".reelup-story__segment-fill");
    if (!fill) return DURATION_MS;

    const segmentWidth = segment.getBoundingClientRect().width;
    const fillWidth = fill.getBoundingClientRect().width;
    const percent = segmentWidth > 0 ? fillWidth / segmentWidth : 0;

    fill.style.transition = "none";
    fill.style.width = `${percent * 100}%`;

    return Math.max(DURATION_MS * (1 - percent), 0);
  };

  const resumeActiveSegment = (dialog, remainingMs) => {
    const segment = dialog.querySelector(`.reelup-story__segment[data-index="${currentIndex}"]`);
    const fill = segment?.querySelector(".reelup-story__segment-fill");
    if (!fill || remainingMs <= 0) return;

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

    const remaining = pausedRemainingMs ?? DURATION_MS;
    pausedRemainingMs = null;
    resumeActiveSegment(dialog, remaining);
    clearTimer();
    timer = setTimeout(() => requestAdvance(dialog), remaining);
  };

  const scheduleAdvance = (dialog) => {
    clearTimer();
    timer = setTimeout(() => requestAdvance(dialog), DURATION_MS);
  };

  const trackAnalytics = async (reelId, eventType) => {
    if (!reelId || !window.Shopify?.shop) return;
    try {
      await fetch("/apps/reels/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopDomain: window.Shopify.shop,
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
    const posterUrl = trigger.dataset.posterUrl;
    if (posterUrl) {
      video.setAttribute("poster", posterUrl);
    } else {
      video.removeAttribute("poster");
    }

    drawerList.replaceChildren();
    const template = trigger.querySelector("template[data-reelup-products]");
    if (template) {
      const shopLabel = trigger.dataset.shopLabel ?? "";
      drawerHeading.textContent = shopLabel;
      drawerList.appendChild(template.content.cloneNode(true));
      shopButton.hidden = false;
      shopButton.textContent = shopLabel;
    } else {
      shopButton.hidden = true;
    }

    setSegmentState(dialog, index, "active");

    try {
      await window.ReelupHls.attach(video, trigger.dataset.hlsSrc);
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
        const response = await fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: variantId, quantity: 1 }),
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

  document.querySelectorAll("[data-reelup-story-group]").forEach((group) => {
    if (group.dataset.reelupStoryGroupBound) return;
    group.dataset.reelupStoryGroupBound = "true";

    Array.from(group.querySelectorAll("[data-reelup-trigger]")).forEach((trigger, index) => {
      trigger
        .querySelector(".reelup-trigger__button")
        ?.addEventListener("click", () => openViewer(group, index));
    });
  });
})();
