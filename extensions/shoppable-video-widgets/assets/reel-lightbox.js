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
          <div class="reelup-lightbox__video-container" style="position: relative; height: 100%; display: flex; align-items: center; justify-content: center; cursor: pointer; user-select: none; -webkit-user-select: none;">
            <video class="reelup-lightbox__video" playsinline style="max-height: 100%; max-width: 100%; pointer-events: none;"></video>
            <button type="button" class="reelup-lightbox__play-pause" style="position: absolute; background: rgba(0,0,0,0.6); color: white; border: none; border-radius: 50%; width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; pointer-events: none; opacity: 0; transition: opacity 0.2s;">${playSvg}</button>
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
    const playPauseBtn = dialog.querySelector(".reelup-lightbox__play-pause");
    
    videoContainer.addEventListener("click", () => {
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    });

    const updateIcon = () => {
      playPauseBtn.innerHTML = video.paused ? playSvg : pauseSvg;
    };

    video.addEventListener("play", updateIcon);
    video.addEventListener("pause", updateIcon);

    videoContainer.addEventListener("mouseenter", () => {
      updateIcon();
      playPauseBtn.style.opacity = "1";
    });

    videoContainer.addEventListener("mouseleave", () => {
      playPauseBtn.style.opacity = "0";
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

    title.textContent = reelTitle;
    closeButton.setAttribute("aria-label", closeLabel);
    if (posterUrl) {
      video.setAttribute("poster", posterUrl);
    } else {
      video.removeAttribute("poster");
    }

    productsList.replaceChildren();
    const template = triggerEl.querySelector("template[data-reelup-products]");
    if (template) {
      productsHeading.textContent = shopLabel;
      productsList.appendChild(template.content.cloneNode(true));
      productsPanel.hidden = false;
    } else {
      productsPanel.hidden = true;
    }

    dialog.showModal();
    if (reelId) trackAnalytics(reelId, "view");

    try {
      await window.ReelupHls.attach(video, hlsSrc);
      await video.play();
    } catch {
      // Playback failed to initialize; the lightbox stays open with the
      // poster/controls visible so the shopper can still browse products.
    }
  };

  window.ReelupLightbox = { open, trackAnalytics };
})();
