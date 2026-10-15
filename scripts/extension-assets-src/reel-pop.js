// Floating video: reveals the player unless the shopper dismissed it this
// session, and lets the label bubble open it too.
(() => {
  if (window.ReelupPop) return;

  // After the floating player disappears, keyboard focus would otherwise
  // fall back to <body> (the top of the page). Move it to the main content
  // landmark instead, without scrolling.
  const moveFocusAway = () => {
    const main = document.querySelector("main, [role='main'], #MainContent");
    if (!main) return;
    if (!main.hasAttribute("tabindex")) {
      main.setAttribute("tabindex", "-1");
      main.addEventListener("blur", () => main.removeAttribute("tabindex"), { once: true });
    }
    main.focus({ preventScroll: true });
  };

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
        document.dispatchEvent(new CustomEvent("reelup:layout-change"));
      }, delayMs);

      pop.querySelector("[data-reelup-pop-open]")?.addEventListener("click", () => {
        pop.querySelector(".reelup-trigger__button")?.click();
      });

      pop.querySelector("[data-reelup-pop-dismiss]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        const hadFocus = pop.contains(document.activeElement);
        pop.hidden = true;
        document.dispatchEvent(new CustomEvent("reelup:layout-change"));
        if (hadFocus) moveFocusAway();
        try {
          sessionStorage.setItem(storageKey, "true");
        } catch {
          // Applies to this page view only.
        }
      });
    });
  };

  window.ReelupPop = { bind: bindAll };
  bindAll();
  document.addEventListener("shopify:section:load", bindAll);
})();
