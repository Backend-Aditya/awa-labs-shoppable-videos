// Floating video: reveals the player unless the shopper dismissed it this
// session, and lets the label bubble open it too.
(() => {
  const bindAll = () => {
    document.querySelectorAll("[data-reelup-pop]").forEach((pop) => {
      if (pop.dataset.reelupPopBound) return;
      pop.dataset.reelupPopBound = "true";

      // Keyed by embed block id as well as reel id so two embeds never
      // share a dismissal, even if one's reel id were blank.
      const storageKey = `reelup-pop-dismissed-${pop.dataset.blockId || "default"}-${pop.dataset.reelId || "default"}`;
      let dismissed = false;
      try {
        dismissed = sessionStorage.getItem(storageKey) === "true";
      } catch {
        // Storage unavailable: show it; dismissal just won't persist.
      }
      if (dismissed) return;
      const delayMs = Math.min(Math.max(parseFloat(pop.dataset.delay) || 0, 0), 60) * 1000;
      setTimeout(() => {
        pop.hidden = false;
      }, delayMs);

      pop.querySelector("[data-reelup-pop-open]")?.addEventListener("click", () => {
        pop.querySelector(".reelup-trigger__button")?.click();
      });

      pop.querySelector("[data-reelup-pop-dismiss]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        pop.hidden = true;
        pop.querySelector(".reelup-trigger__preview")?.remove();
        try {
          sessionStorage.setItem(storageKey, "true");
        } catch {
          // Applies to this page view only.
        }
      });
    });
  };

  bindAll();
  document.addEventListener("shopify:section:load", bindAll);
})();
