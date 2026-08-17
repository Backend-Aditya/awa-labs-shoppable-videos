(() => {
  document.querySelectorAll("[data-reelup-trigger]").forEach((trigger) => {
    if (trigger.closest("[data-reelup-story-group]")) return;
    if (trigger.dataset.reelupTriggerBound) return;
    trigger.dataset.reelupTriggerBound = "true";

    trigger
      .querySelector(".reelup-trigger__button")
      ?.addEventListener("click", () => window.ReelupLightbox?.open(trigger));
  });
})();
