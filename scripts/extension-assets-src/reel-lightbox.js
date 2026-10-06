(() => {
  const buildLightbox = () => {
    const existing = document.getElementById("reelup-lightbox");
    if (existing) return existing;

    const dialog = document.createElement("dialog");
    dialog.id = "reelup-lightbox";
    dialog.className = "reelup-lightbox";
    dialog.setAttribute("aria-labelledby", "reelup-lightbox-title");
    const playSvg = `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    const pauseSvg = `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

    dialog.innerHTML = `
      <button type="button" class="reelup-lightbox__close" data-reelup-lightbox-close>&times;</button>
      <div class="reelup-lightbox__body">
        <div class="reelup-lightbox__player">
          <h2 id="reelup-lightbox-title" class="reelup-lightbox__title"></h2>
          <div class="reelup-lightbox__video-container">
            <video class="reelup-lightbox__video" playsinline></video>
            <button type="button" class="reelup-lightbox__play-pause" data-reelup-play-pause>${playSvg}</button>
          </div>
        </div>
        <div class="reelup-lightbox__products" data-reelup-lightbox-products hidden>
           <h3 class="reelup-lightbox__products-heading" data-reelup-lightbox-products-heading></h3>
           <div class="reelup-lightbox__products-list" data-reelup-lightbox-products-list></div>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);

    const video = dialog.querySelector(".reelup-lightbox__video");
    const bodyEl = dialog.querySelector(".reelup-lightbox__body");
    const productsPanel = dialog.querySelector("[data-reelup-lightbox-products]");
    const productsList = dialog.querySelector("[data-reelup-lightbox-products-list]");
    const closeButton = dialog.querySelector("[data-reelup-lightbox-close]");

    dialog.addEventListener("close", () => {
      window.ReelupHls?.teardown(video);
      productsList.replaceChildren();
      productsPanel.hidden = true;
    });

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target === bodyEl) dialog.close();
    });

    closeButton.addEventListener("click", () => dialog.close());
    
    const videoContainer = dialog.querySelector(".reelup-lightbox__video-container");
    const playPauseBtn = dialog.querySelector("[data-reelup-play-pause]");

    const togglePlayback = () => {
      if (video.paused) video.play();
      else video.pause();
    };

    // The button carries its own click handler (and is keyboard-focusable,
    // unlike the old pointer-events:none overlay this replaced) so it's an
    // independent control, not just a visual echo of a container click —
    // stopPropagation keeps that one tap from also bubbling to the
    // container's own listener and toggling playback twice.
    playPauseBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePlayback();
    });

    videoContainer.addEventListener("click", togglePlayback);

    const updateIcon = () => {
      playPauseBtn.innerHTML = video.paused ? playSvg : pauseSvg;
      playPauseBtn.setAttribute(
        "aria-label",
        video.paused ? (dialog.dataset.playLabel ?? "Play") : (dialog.dataset.pauseLabel ?? "Pause"),
      );
    };

    video.addEventListener("play", updateIcon);
    video.addEventListener("pause", updateIcon);

    videoContainer.addEventListener("mouseenter", () => {
      updateIcon();
      playPauseBtn.classList.add("reelup-lightbox__play-pause--visible");
    });

    videoContainer.addEventListener("mouseleave", () => {
      playPauseBtn.classList.remove("reelup-lightbox__play-pause--visible");
    });

    productsList.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-reelup-add-to-cart]");
      const link = event.target.closest(".reelup-lightbox__product-link");
      
      if (dialog.dataset.currentReelId && (button || link)) {
        window.ReelupLightbox?.trackAnalytics?.(dialog.dataset.currentReelId, "click_product");
      }

      if (!button || button.dataset.state === "loading") return;

      const variantId = button.dataset.variantId;
      const addLabel = button.dataset.addLabel ?? button.textContent;
      const addedLabel = button.dataset.addedLabel ?? addLabel;

      button.dataset.state = "loading";

      try {
        // _reelup_reel_id is a hidden line-item property (underscore prefix
        // hides it from the customer-facing cart/checkout/order UI, a
        // Shopify convention) — it rides along through checkout onto the
        // order itself, and the orders/paid webhook reads it back off to
        // attribute revenue to this reel. No cookie or session tracking
        // needed; the data travels with the order.
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

  const open = async (triggerEl) => {
    const hlsSrc = triggerEl.dataset.hlsSrc;
    if (!hlsSrc) return;

    const dialog = buildLightbox();
    const reelId = triggerEl.dataset.reelId;
    dialog.dataset.currentReelId = reelId;

    const video = dialog.querySelector(".reelup-lightbox__video");
    const title = dialog.querySelector(".reelup-lightbox__title");
    const closeButton = dialog.querySelector("[data-reelup-lightbox-close]");
    const productsPanel = dialog.querySelector("[data-reelup-lightbox-products]");
    const productsHeading = dialog.querySelector("[data-reelup-lightbox-products-heading]");
    const productsList = dialog.querySelector("[data-reelup-lightbox-products-list]");

    const posterUrl = triggerEl.dataset.posterUrl;
    const reelTitle = triggerEl.dataset.title ?? "";
    const closeLabel = triggerEl.dataset.closeLabel ?? "Close";
    const shopLabel = triggerEl.dataset.shopLabel ?? "";

    dialog.dataset.playLabel = triggerEl.dataset.playLabel ?? "Play";
    dialog.dataset.pauseLabel = triggerEl.dataset.pauseLabel ?? "Pause";
    const playPauseBtn = dialog.querySelector("[data-reelup-play-pause]");
    playPauseBtn.setAttribute("aria-label", dialog.dataset.playLabel);

    title.textContent = reelTitle;
    closeButton.setAttribute("aria-label", closeLabel);
    if (posterUrl) {
      video.setAttribute("poster", posterUrl);
    } else {
      video.removeAttribute("poster");
    }

    window.ReelupViewerSettings?.applyDialogSettings(dialog, video, title, triggerEl);

    productsList.replaceChildren();
    const template = triggerEl.querySelector("template[data-reelup-products]");
    if (template) {
      productsHeading.textContent = shopLabel;
      productsList.appendChild(template.content.cloneNode(true));
      productsPanel.hidden = false;
      window.ReelupViewerSettings?.applyProductListSettings(productsList, triggerEl);
    } else {
      productsPanel.hidden = true;
    }

    dialog.showModal();
    if (reelId) trackAnalytics(reelId, "view");

    // Unmuted autoplay is only allowed inside the transient-activation window
    // from the click that opened this dialog. attach() below can await a
    // network fetch (hls.js itself, then the HLS manifest) that easily
    // outlasts that window, so unmuted play() after it resolves can be
    // silently rejected by the browser. Muted play is always allowed, so we
    // start playback muted immediately (still inside the gesture), then
    // restore the real mute state once attach() resolves — browsers permit
    // unmuting already-playing media without a fresh gesture.
    const desiredMuted = video.muted;
    video.muted = true;
    video.play().catch(() => {});

    try {
      await window.ReelupHls.attach(video, hlsSrc);
      video.muted = desiredMuted;
      await video.play();
    } catch {
      // Playback failed to initialize; the lightbox stays open with the
      // poster/controls visible so the shopper can still browse products.
    }
  };

  window.ReelupLightbox = { open, trackAnalytics };
})();
