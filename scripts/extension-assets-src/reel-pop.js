(() => {
  document.querySelectorAll("[data-reelup-pop]").forEach((pop) => {
    if (pop.dataset.reelupPopBound) return;
    pop.dataset.reelupPopBound = "true";

    // Keyed by block id, not just reel id — block.id is always unique per
    // app-embed instance, so two reel-pop blocks (e.g. on different pages
    // via theme-section visibility, or a merchant with two embeds enabled)
    // never share a dismissal key even if `data-reel-id` is ever blank.
    const reelId = pop.dataset.reelId || "default";
    const blockId = pop.dataset.blockId || "default";
    const storageKey = `reelup-pop-dismissed-${blockId}-${reelId}`;

    let alreadyDismissed = false;
    try {
      alreadyDismissed = sessionStorage.getItem(storageKey) === "true";
    } catch {
      // sessionStorage unavailable (private browsing, quota, etc.) — treat
      // as not-dismissed; the bubble just won't remember dismissal below.
    }

    if (alreadyDismissed) {
      pop.hidden = true;
      return;
    }

    const dismissButton = pop.querySelector("[data-reelup-pop-dismiss]");
    dismissButton?.addEventListener("click", (event) => {
      // The dismiss button is a positioned sibling of the trigger, not a
      // descendant of it, but stop propagation anyway so a click here can
      // never be misread as a click on the trigger's own open-lightbox
      // button by anything listening higher up the tree.
      event.stopPropagation();
      pop.hidden = true;
      try {
        sessionStorage.setItem(storageKey, "true");
      } catch {
        // Dismissal still applies to this page view; it just won't persist
        // across navigations if storage isn't available.
      }
    });
  });
})();
