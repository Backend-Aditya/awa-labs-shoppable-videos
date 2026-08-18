(() => {
  document.querySelectorAll("[data-reelup-pop]").forEach((pop) => {
    if (pop.dataset.reelupPopBound) return;
    pop.dataset.reelupPopBound = "true";

    const reelId = pop.dataset.reelId ?? "default";
    const storageKey = `reelup-pop-dismissed-${reelId}`;

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
