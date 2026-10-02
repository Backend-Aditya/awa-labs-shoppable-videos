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
  };

  const applyProductListSettings = (listEl, triggerEl) => {
    const hidePrice = triggerEl.dataset.showPrice === "false";
    listEl.querySelectorAll(".reelup-lightbox__product-price").forEach((priceEl) => {
      priceEl.hidden = hidePrice;
    });

    const ctaLabel = triggerEl.dataset.ctaLabel;
    if (ctaLabel) {
      listEl.querySelectorAll("[data-reelup-add-to-cart]").forEach((button) => {
        button.dataset.addLabel = ctaLabel;
        button.textContent = ctaLabel;
      });
    }
  };

  window.ReelupViewerSettings = { applyDialogSettings, applyProductListSettings };
})();
