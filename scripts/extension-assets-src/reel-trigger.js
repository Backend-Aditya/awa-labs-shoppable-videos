// Wires every non-story trigger to the video viewer, plus the layout
// behaviour of the inline widgets: filmstrip arrows, the stacked deck, and
// muted scroll previews. Re-runs on theme-editor section reloads, which
// swap in fresh unbound markup without a page load.
(() => {
  const hoverCapable = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  /* -------------------------------------------------------- triggers */

  const bindTriggers = () => {
    document.querySelectorAll("[data-reelup-trigger]").forEach((trigger) => {
      if (trigger.closest("[data-reelup-story-group]") || trigger.dataset.reelupBound) return;
      trigger.dataset.reelupBound = "true";
      const button = trigger.querySelector(".reelup-trigger__button");
      if (!button) return;

      const open = () => {
        const groupEl = trigger.closest("[data-reelup-group]");
        const group = groupEl ? Array.from(groupEl.querySelectorAll("[data-reelup-trigger]")) : null;
        window.ReelupLightbox?.open(trigger, group);
      };

      // Hover-to-open only where a real hover exists; touch keeps tap.
      if (trigger.dataset.playTrigger === "hover" && hoverCapable) {
        let hoverTimer = null;
        button.addEventListener("mouseenter", () => {
          hoverTimer = setTimeout(open, 350);
        });
        button.addEventListener("mouseleave", () => clearTimeout(hoverTimer));
      }
      button.addEventListener("click", open);
    });
  };

  /* ------------------------------------------------------- filmstrip */

  const bindStrips = () => {
    document.querySelectorAll("[data-reelup-strip]").forEach((track) => {
      if (track.dataset.reelupStripBound) return;
      track.dataset.reelupStripBound = "true";
      const viewport = track.parentElement;
      const prev = viewport.querySelector("[data-reelup-strip-prev]");
      const next = viewport.querySelector("[data-reelup-strip-next]");
      if (!prev || !next) return;

      const update = () => {
        const max = track.scrollWidth - track.clientWidth;
        prev.hidden = track.scrollLeft <= 4;
        next.hidden = track.scrollLeft >= max - 4;
      };
      const scrollBy = (dir) =>
        track.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: reducedMotion() ? "auto" : "smooth" });

      prev.addEventListener("click", () => scrollBy(-1));
      next.addEventListener("click", () => scrollBy(1));
      track.addEventListener("scroll", update, { passive: true });
      window.addEventListener("resize", update, { passive: true });
      update();
    });
  };

  /* ------------------------------------------------------------ deck */

  const bindDecks = () => {
    document.querySelectorAll("[data-reelup-deck]").forEach((deck) => {
      if (deck.dataset.reelupDeckBound) return;
      deck.dataset.reelupDeckBound = "true";

      const stage = deck.querySelector(".reelup-deck__stage");
      const cards = Array.from(deck.querySelectorAll("[data-reelup-deck-card]"));
      const dots = Array.from(deck.querySelectorAll("[data-reelup-deck-dots] span"));
      const status = deck.querySelector("[data-reelup-deck-status]");
      if (cards.length < 2) return;

      let active = Math.min(1, cards.length - 1);

      const render = () => {
        cards.forEach((card, i) => {
          const offset = i - active;
          const distance = Math.abs(offset);
          card.style.setProperty("--ru-offset", String(offset));
          card.style.setProperty("--ru-distance", String(Math.min(distance, 3)));
          card.style.zIndex = String(20 - distance);
          card.classList.toggle("is-active", offset === 0);
          card.toggleAttribute("data-far", distance > 2);
          // Only the front card is reachable by keyboard — the others are
          // decoration until they come forward.
          const button = card.querySelector(".reelup-trigger__button");
          if (button) button.tabIndex = offset === 0 ? 0 : -1;
          card.setAttribute("aria-hidden", offset === 0 ? "false" : "true");
        });
        dots.forEach((dot, i) => dot.classList.toggle("is-active", i === active));
        const title = cards[active].querySelector("[data-reelup-trigger]")?.dataset.title ?? "";
        if (status) status.textContent = `${active + 1} / ${cards.length}${title ? ` — ${title}` : ""}`;
        document.dispatchEvent(new CustomEvent("reelup:deck-change"));
      };

      const goTo = (i) => {
        active = (i + cards.length) % cards.length;
        render();
      };

      // A tap on a side card brings it forward instead of opening it.
      // Capture phase so it runs before the trigger's own click handler.
      stage.addEventListener(
        "click",
        (event) => {
          const card = event.target.closest("[data-reelup-deck-card]");
          if (!card || card.classList.contains("is-active")) return;
          event.preventDefault();
          event.stopPropagation();
          goTo(cards.indexOf(card));
        },
        true,
      );

      deck.querySelector("[data-reelup-deck-prev]")?.addEventListener("click", () => goTo(active - 1));
      deck.querySelector("[data-reelup-deck-next]")?.addEventListener("click", () => goTo(active + 1));
      deck.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft") goTo(active - 1);
        else if (event.key === "ArrowRight") goTo(active + 1);
      });

      let startX = null;
      let swiped = false;
      stage.addEventListener("pointerdown", (event) => {
        startX = event.clientX;
        swiped = false;
      });
      stage.addEventListener("pointerup", (event) => {
        if (startX === null) return;
        const dx = event.clientX - startX;
        startX = null;
        if (Math.abs(dx) > 40) {
          swiped = true;
          goTo(active + (dx < 0 ? 1 : -1));
        }
      });
      // A swipe that ends over the front card must not also open it.
      stage.addEventListener(
        "click",
        (event) => {
          if (swiped) {
            swiped = false;
            event.preventDefault();
            event.stopPropagation();
          }
        },
        true,
      );

      deck.classList.add("is-ready");
      render();
    });
  };

  /* ------------------------------------------------- scroll previews */

  // Muted, looping previews while triggers are on screen — lowest HLS
  // rendition, at most MAX_PREVIEWS playing at once (the ones nearest the
  // viewport centre win), never on data-saver or reduced-motion. Posters
  // stay underneath until the first frame is ready, so nothing flashes.
  const MAX_PREVIEWS = 3;
  const saveData = navigator.connection?.saveData === true;
  const visible = new Set();
  const running = new Map();

  const stopPreview = (trigger) => {
    const video = running.get(trigger);
    if (!video) return;
    running.delete(trigger);
    window.ReelupHls?.teardown(video);
    video.remove();
  };

  const startPreview = (trigger) => {
    const button = trigger.querySelector(".reelup-trigger__button");
    if (!button || running.has(trigger) || !window.ReelupHls) return;
    const video = document.createElement("video");
    video.className = "reelup-trigger__preview";
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.setAttribute("tabindex", "-1");
    video.addEventListener("playing", () => video.classList.add("is-playing"), { once: true });
    const poster = button.querySelector(".reelup-trigger__poster");
    button.insertBefore(video, poster ? poster.nextSibling : button.firstChild);
    running.set(trigger, video);
    window.ReelupHls.attach(video, trigger.dataset.hlsSrc, { preview: true })
      .then(() => video.play())
      .catch(() => stopPreview(trigger));
  };

  const distanceToCentre = (el) => {
    const r = el.getBoundingClientRect();
    return Math.abs(r.top + r.height / 2 - window.innerHeight / 2) + Math.abs(r.left + r.width / 2 - window.innerWidth / 2);
  };

  const reconcile = () => {
    const viewerOpen = document.querySelector("dialog.reelup-viewer[open], dialog.reelup-story[open]");
    const wanted = viewerOpen
      ? []
      : [...visible]
          .filter((t) => t.isConnected && !t.closest("[hidden]") && !t.closest(".is-ready [data-reelup-deck-card]:not(.is-active)"))
          .sort((a, b) => distanceToCentre(a) - distanceToCentre(b))
          .slice(0, MAX_PREVIEWS);
    for (const trigger of [...running.keys()]) if (!wanted.includes(trigger)) stopPreview(trigger);
    wanted.forEach(startPreview);
  };

  let reconcileQueued = false;
  const queueReconcile = () => {
    if (reconcileQueued) return;
    reconcileQueued = true;
    requestAnimationFrame(() => {
      reconcileQueued = false;
      reconcile();
    });
  };

  const previewObserver =
    !saveData && "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) visible.add(entry.target);
              else visible.delete(entry.target);
            }
            queueReconcile();
          },
          { threshold: 0.6 },
        )
      : null;

  const bindPreviews = () => {
    if (!previewObserver || reducedMotion()) return;
    document.querySelectorAll('[data-reelup-trigger][data-autoplay-scroll="true"]').forEach((trigger) => {
      if (trigger.dataset.reelupPreviewBound || !trigger.dataset.hlsSrc) return;
      trigger.dataset.reelupPreviewBound = "true";
      previewObserver.observe(trigger);
    });
  };

  // Viewers pause every preview while open; decks change which card is in
  // front. Both just ask for a fresh reconcile.
  document.addEventListener("reelup:viewer-change", queueReconcile);
  document.addEventListener("reelup:deck-change", queueReconcile);
  window.addEventListener("scroll", queueReconcile, { passive: true });

  const bindAll = () => {
    bindTriggers();
    bindStrips();
    bindDecks();
    bindPreviews();
  };

  // Shared links carry ?reelup=<id>; open that reel once, after binding.
  const openFromUrl = () => {
    const id = new URLSearchParams(window.location.search).get("reelup");
    if (!id || !/^\d+$/.test(id)) return;
    const trigger = Array.from(document.querySelectorAll("[data-reelup-trigger]")).find((t) =>
      String(t.dataset.reelId ?? "").split("/").pop() === id,
    );
    if (!trigger) return;
    trigger.scrollIntoView({ block: "center" });
    if (trigger.closest("[data-reelup-story-group]")) {
      trigger.querySelector(".reelup-trigger__button")?.click();
      return;
    }
    const groupEl = trigger.closest("[data-reelup-group]");
    window.ReelupLightbox?.open(trigger, groupEl ? Array.from(groupEl.querySelectorAll("[data-reelup-trigger]")) : null);
  };

  bindAll();
  // Story triggers are bound by reel-story.js, which loads before this file.
  openFromUrl();
  document.addEventListener("shopify:section:load", bindAll);
  document.addEventListener("shopify:block:select", bindAll);
})();
