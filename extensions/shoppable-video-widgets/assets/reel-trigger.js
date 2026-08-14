(() => {
  document.querySelectorAll("[data-reelup-trigger]").forEach((trigger) => {
    trigger
      .querySelector(".reelup-trigger__button")
      ?.addEventListener("click", () => window.ReelupLightbox?.open(trigger));
  });
})();
