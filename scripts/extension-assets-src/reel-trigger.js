(() => {
  const bindAll = () => {
    document.querySelectorAll("[data-reelup-trigger]").forEach((trigger) => {
      if (trigger.closest("[data-reelup-story-group]")) return;
      if (trigger.dataset.reelupTriggerBound) return;
      trigger.dataset.reelupTriggerBound = "true";

      trigger
        .querySelector(".reelup-trigger__button")
        ?.addEventListener("click", () => window.ReelupLightbox?.open(trigger));
    });
  };

  bindAll();

  // Shopify's theme editor re-renders a section via AJAX whenever the
  // merchant tweaks a block setting, swapping in fresh (unbound) markup
  // without a full page reload — without this, triggers added that way
  // stay dead until the merchant manually refreshes the preview.
  document.addEventListener("shopify:section:load", bindAll);
  document.addEventListener("shopify:block:select", bindAll);
})();
