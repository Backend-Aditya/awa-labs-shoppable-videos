// Floating video: reveals the player unless the shopper dismissed it this
// session, and lets the label bubble open it too.
(() => {
  if (window.AwaSvPop) return;

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

  // A theme bar fixed to the bottom of the screen (mobile tab bar, sticky
  // add to cart, cookie banner) would cover a bottom-corner player. Find
  // the topmost such bar under the player's column and lift the player
  // above it (--awa-sv-pop-lift, used by the CSS).
  const isPinned = (el) => {
    for (let node = el; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") return node;
    }
    return null;
  };

  const barHeightUnder = (pop) => {
    if (pop.hidden || !document.elementsFromPoint || !/awa-sv-pop--bottom/.test(pop.className)) return 0;
    const vh = window.innerHeight;
    const rect = pop.getBoundingClientRect();
    let top = vh;
    for (const x of [rect.left + 6, (rect.left + rect.right) / 2, rect.right - 6]) {
      for (const el of document.elementsFromPoint(x, vh - 2)) {
        if (pop.contains(el)) continue;
        const bar = isPinned(el);
        if (!bar) continue;
        const box = bar.getBoundingClientRect();
        // Only bars docked to the bottom edge; never full-screen drawers.
        if (box.bottom >= vh - 4 && box.top < vh && box.height < vh * 0.4) top = Math.min(top, box.top);
        break;
      }
    }
    return Math.max(Math.round(vh - top), 0);
  };

  const pops = new Set();
  let frame = 0;
  const liftAll = () => {
    frame = 0;
    pops.forEach((pop) => {
      if (!pop.isConnected) return pops.delete(pop);
      const lift = `${barHeightUnder(pop)}px`;
      if (pop.style.getPropertyValue("--awa-sv-pop-lift") !== lift) pop.style.setProperty("--awa-sv-pop-lift", lift);
    });
  };
  const scheduleLift = () => {
    if (!frame) frame = requestAnimationFrame(liftAll);
  };
  window.addEventListener("resize", scheduleLift, { passive: true });
  // Some themes slide their bars in or out while scrolling.
  window.addEventListener("scroll", scheduleLift, { passive: true });

  const bindAll = () => {
    document.querySelectorAll("[data-awa-sv-pop]").forEach((pop) => {
      if (pop.dataset.awaSvPopBound) return;
      pop.dataset.awaSvPopBound = "true";

      // Keyed by embed block id as well as reel id so two embeds never
      // share a dismissal, even if one's reel id were blank.
      const storageKey = `awa-sv-pop-dismissed-${pop.dataset.blockId || "default"}-${pop.dataset.reelId || "default"}`;
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
        pops.add(pop);
        liftAll();
        // Theme bars can render late; check again shortly after.
        setTimeout(scheduleLift, 600);
        setTimeout(scheduleLift, 2000);
        document.dispatchEvent(new CustomEvent("awa-sv:layout-change"));
      }, delayMs);

      pop.querySelector("[data-awa-sv-pop-open]")?.addEventListener("click", () => {
        pop.querySelector(".awa-sv-trigger__button")?.click();
      });

      pop.querySelector("[data-awa-sv-pop-dismiss]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        const hadFocus = pop.contains(document.activeElement);
        pop.hidden = true;
        document.dispatchEvent(new CustomEvent("awa-sv:layout-change"));
        if (hadFocus) moveFocusAway();
        try {
          sessionStorage.setItem(storageKey, "true");
        } catch {
          // Applies to this page view only.
        }
      });
    });
  };

  window.AwaSvPop = { bind: bindAll };
  bindAll();
  document.addEventListener("shopify:section:load", bindAll);
})();
