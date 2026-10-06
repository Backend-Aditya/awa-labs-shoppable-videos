(() => {
  const applyDialogSettings = (dialog, video, titleEl, triggerEl) => {
    const cssVars = {
      "--reelup-cta-color": triggerEl.dataset.ctaColor,
      "--reelup-cta-text-color": triggerEl.dataset.ctaTextColor,
      "--reelup-cta-hover-color": triggerEl.dataset.ctaHoverColor,
    };

    for (const [name, value] of Object.entries(cssVars)) {
      // The dialog is a shared singleton reused across every open() call —
      // a value left over from a PREVIOUS trigger's custom color must be
      // explicitly cleared here, not just conditionally set, or it leaks
      // onto the next trigger that has no color configured at all.
      if (value) dialog.style.setProperty(name, value);
      else dialog.style.removeProperty(name);
    }

    video.muted = triggerEl.dataset.mutedDefault === "true";
    video.loop = triggerEl.dataset.loop === "true";
    titleEl.hidden = triggerEl.dataset.showTitle === "false";

    // Same leftover-state concern as the CSS vars above: a previous
    // trigger's cta-style class must be explicitly removed, not just
    // conditionally added, since the dialog is a shared singleton.
    dialog.classList.remove("reelup-lightbox--cta-square", "reelup-lightbox--cta-text-link");
    const ctaStyle = triggerEl.dataset.ctaStyle;
    if (ctaStyle === "square") dialog.classList.add("reelup-lightbox--cta-square");
    else if (ctaStyle === "text-link") dialog.classList.add("reelup-lightbox--cta-text-link");
  };

  const applyProductListSettings = (listEl, triggerEl) => {
    const hidePrice = triggerEl.dataset.showPrice === "false";
    listEl.querySelectorAll(".reelup-lightbox__product-price").forEach((priceEl) => {
      priceEl.hidden = hidePrice;
    });

    const hideImage = triggerEl.dataset.showProductImage === "false";
    listEl.querySelectorAll(".reelup-lightbox__product-image").forEach((imageEl) => {
      imageEl.hidden = hideImage;
    });

    const ctaLabel = triggerEl.dataset.ctaLabel;
    if (ctaLabel) {
      listEl.querySelectorAll("[data-reelup-add-to-cart]").forEach((button) => {
        button.dataset.addLabel = ctaLabel;
        button.textContent = ctaLabel;
      });
    }
  };

  // Tap-to-reveal product tags: when a trigger opts in via
  // data-tag-reveal-mode="tap", the product list stays collapsed under the
  // products heading until the shopper taps it, instead of always showing
  // the list open (the default). `listEl` is the product rows container,
  // `toggleEl` the heading that acts as the tap target.
  const setUpTapReveal = (listEl, toggleEl, triggerEl) => {
    if (!listEl || !toggleEl) return;
    const tapMode = triggerEl.dataset.tagRevealMode === "tap";
    listEl.classList.toggle("reelup-lightbox__products-list--tap", tapMode);
    listEl.classList.remove("reelup-lightbox__products--visible");
    if (!tapMode) return;

    if (toggleEl.dataset.reelupTapBound) return;
    toggleEl.dataset.reelupTapBound = "true";
    toggleEl.addEventListener("click", () => {
      listEl.classList.toggle("reelup-lightbox__products--visible");
    });
  };

  window.ReelupViewerSettings = { applyDialogSettings, applyProductListSettings, setUpTapReveal };
})();
