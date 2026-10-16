// Wires every non-story trigger to the video viewer, plus the layout
// behaviour of the inline widgets: scroll arrows (filmstrip, stories row,
// slider), the stacked deck, muted scroll/hover previews, and ?reelup=
// deep links. Re-runs on theme-editor section reloads, which swap in
// fresh unbound markup without a page load.
(() => {
  // Loaded by the embed and possibly again by a block loader.
  if (window.ReelupTrigger) return;

  const hoverCapable = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const isRtl = (el) => {
    try {
      return getComputedStyle(el).direction === "rtl";
    } catch {
      return document.documentElement.dir === "rtl";
    }
  };

  /* ------------------------------------------------- hls.js on intent */

  // hls.js (~400 KB) is fetched the first time a shopper shows intent —
  // pointer over / focus on / touch of any trigger — never on page load.
  const onIntent = (event) => {
    if (!event.target.closest?.("[data-reelup-trigger], [data-reelup-pop]")) return;
    window.ReelupHls?.prefetch?.();
    ["pointerover", "focusin", "touchstart"].forEach((type) => document.removeEventListener(type, onIntent, true));
  };
  ["pointerover", "focusin", "touchstart"].forEach((type) =>
    document.addEventListener(type, onIntent, { capture: true, passive: true }),
  );

  /* -------------------------------------------------------- triggers */

  const hovered = new Set();
  let queueReconcile = () => {};

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

      // "Hover" play trigger: hovering plays the muted inline preview (on
      // devices with a real hover); opening the viewer is always a click.
      if (trigger.dataset.playTrigger === "hover" && hoverCapable && trigger.dataset.hlsSrc) {
        button.addEventListener("mouseenter", () => {
          hovered.add(trigger);
          queueReconcile();
        });
        button.addEventListener("mouseleave", () => {
          hovered.delete(trigger);
          queueReconcile();
        });
      }
      button.addEventListener("click", open);
    });
  };

  /* --------------------------------------------- scroll arrows (strip) */

  // Any horizontally scrolling row marked [data-reelup-strip] with
  // [data-reelup-strip-prev/next] buttons beside it (inside its parent):
  // the filmstrip, the stories row and the deck's slider/no-JS row.
  const strips = new Map(); // track -> ResizeObserver | resize listener

  const pruneStrips = () => {
    for (const [track, cleanup] of strips) {
      if (!track.isConnected) {
        cleanup();
        strips.delete(track);
      }
    }
  };

  const bindStrips = () => {
    pruneStrips();
    document.querySelectorAll("[data-reelup-strip]").forEach((track) => {
      if (track.dataset.reelupStripBound) return;
      track.dataset.reelupStripBound = "true";
      const viewport = track.parentElement;
      const prev = viewport.querySelector("[data-reelup-strip-prev]");
      const next = viewport.querySelector("[data-reelup-strip-next]");
      if (!prev || !next) return;

      // RTL: scrollLeft runs 0 → negative, so compare magnitudes and flip
      // the scroll direction; "prev" always means towards the start.
      const update = () => {
        const max = track.scrollWidth - track.clientWidth;
        const position = Math.abs(track.scrollLeft);
        prev.hidden = max <= 4 || position <= 4;
        next.hidden = max <= 4 || position >= max - 4;
      };
      const scrollByPage = (dir) => {
        const sign = isRtl(track) ? -1 : 1;
        track.scrollBy({ left: dir * sign * track.clientWidth * 0.8, behavior: reducedMotion() ? "auto" : "smooth" });
      };

      prev.addEventListener("click", () => scrollByPage(-1));
      next.addEventListener("click", () => scrollByPage(1));
      track.addEventListener("scroll", update, { passive: true });
      if ("ResizeObserver" in window) {
        const observer = new ResizeObserver(update);
        observer.observe(track);
        strips.set(track, () => observer.disconnect());
      } else {
        window.addEventListener("resize", update, { passive: true });
        strips.set(track, () => window.removeEventListener("resize", update));
      }
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
      const statusFormat = deck.dataset.statusFormat || "__CURRENT__ / __TOTAL__";
      if (cards.length < 2) return;

      let active = Math.min(1, cards.length - 1);
      let announced = false;

      const buttonOf = (card) => card?.querySelector(".reelup-trigger__button");

      const render = (announceChange) => {
        const sign = isRtl(deck) ? -1 : 1;
        cards.forEach((card, i) => {
          const offset = i - active;
          const distance = Math.abs(offset);
          card.style.setProperty("--ru-offset", String(offset * sign));
          card.style.setProperty("--ru-distance", String(Math.min(distance, 3)));
          card.style.zIndex = String(20 - distance);
          card.classList.toggle("is-active", offset === 0);
          card.toggleAttribute("data-far", distance > 2);
          // Only the front card is reachable by keyboard — the others are
          // decoration until they come forward.
          const button = buttonOf(card);
          if (button) button.tabIndex = offset === 0 ? 0 : -1;
          card.setAttribute("aria-hidden", offset === 0 ? "false" : "true");
        });
        dots.forEach((dot, i) => dot.classList.toggle("is-active", i === active));
        // Announce only real changes, never the initial render.
        if (status && (announceChange || announced)) {
          announced = true;
          const title = cards[active].querySelector("[data-reelup-trigger]")?.dataset.title ?? "";
          const position = statusFormat.replace("__CURRENT__", String(active + 1)).replace("__TOTAL__", String(cards.length));
          const text = `${position}${title ? `: ${title}` : ""}`;
          if (status.textContent !== text) status.textContent = text;
        }
        document.dispatchEvent(new CustomEvent("reelup:deck-change"));
      };

      const goTo = (i, { focus = false } = {}) => {
        const nextActive = (i + cards.length) % cards.length;
        if (nextActive === active) return;
        active = nextActive;
        render(true);
        if (focus) buttonOf(cards[active])?.focus({ preventScroll: true });
      };
      // Used to sync the deck to the last reel viewed in the viewer.
      deck.reelupDeckGoTo = (card) => {
        const i = cards.indexOf(card);
        if (i >= 0) goTo(i);
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
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const forward = (event.key === "ArrowRight") !== isRtl(deck);
        // Focus on a card follows the card that comes forward; focus on the
        // arrow buttons stays put.
        const onCard = Boolean(event.target.closest?.("[data-reelup-deck-card]"));
        event.preventDefault();
        goTo(active + (forward ? 1 : -1), { focus: onCard });
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
          const sign = isRtl(deck) ? -1 : 1;
          goTo(active + (dx < 0 ? 1 : -1) * sign);
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
      render(false);
    });
  };

  // After the viewer closes, bring the last viewed reel to the front of
  // its deck (the viewer then focuses its button).
  document.addEventListener("reelup:viewer-closed", (event) => {
    const trigger = event.detail?.trigger;
    const card = trigger?.closest?.("[data-reelup-deck-card]");
    card?.closest("[data-reelup-deck]")?.reelupDeckGoTo?.(card);
  });

  /* ------------------------------------------------- scroll previews */

  // Muted previews while triggers are on screen — lowest HLS rendition, at
  // most MAX_PREVIEWS at once (the ones nearest the viewport centre win),
  // never on data-saver or reduced-motion, never before window load, paused
  // while the tab is hidden, and each stops after PREVIEW_MS on its last
  // frame so a page left open doesn't stream forever. Hover previews
  // (playTrigger "hover") run while hovered. Posters stay underneath until
  // the first frame is ready, so nothing flashes.
  const MAX_PREVIEWS = 3;
  const PREVIEW_MS = 8000;
  const saveData = navigator.connection?.saveData === true;
  const visible = new Set();
  const running = new Map(); // trigger -> { video, timer, startedAt, remaining, done, hover }
  const finished = new WeakSet();
  let pageLoaded = document.readyState === "complete";

  const stopPreview = (trigger) => {
    const entry = running.get(trigger);
    if (!entry) return;
    running.delete(trigger);
    clearTimeout(entry.timer);
    window.ReelupHls?.teardown(entry.video);
    entry.video.remove();
  };

  const finishPreview = (trigger) => {
    const entry = running.get(trigger);
    if (!entry || entry.done) return;
    entry.done = true;
    clearTimeout(entry.timer);
    finished.add(trigger);
    entry.video.pause();
    window.ReelupHls?.stopLoading?.(entry.video);
    queueReconcile();
  };

  const startTimer = (trigger, entry) => {
    if (entry.hover || entry.done) return;
    clearTimeout(entry.timer);
    entry.startedAt = Date.now();
    entry.timer = setTimeout(() => finishPreview(trigger), entry.remaining);
  };

  const startPreview = (trigger, hover) => {
    const button = trigger.querySelector(".reelup-trigger__button");
    if (!button || running.has(trigger) || !window.ReelupHls || !trigger.dataset.hlsSrc) return;
    const video = document.createElement("video");
    video.className = "reelup-trigger__preview";
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.setAttribute("tabindex", "-1");
    const entry = { video, timer: null, startedAt: 0, remaining: PREVIEW_MS, done: false, hover };
    video.addEventListener(
      "playing",
      () => {
        video.classList.add("is-playing");
        startTimer(trigger, entry);
      },
      { once: true },
    );
    const poster = button.querySelector(".reelup-trigger__poster");
    button.insertBefore(video, poster ? poster.nextSibling : button.firstChild);
    running.set(trigger, entry);
    window.ReelupHls.attach(video, trigger.dataset.hlsSrc, { preview: true })
      .then(() => (running.get(trigger) === entry ? video.play() : undefined))
      .catch(() => {
        if (running.get(trigger) === entry) stopPreview(trigger);
      });
  };

  const distanceToCentre = (el) => {
    const r = el.getBoundingClientRect();
    return Math.abs(r.top + r.height / 2 - window.innerHeight / 2) + Math.abs(r.left + r.width / 2 - window.innerWidth / 2);
  };

  const eligible = (t) =>
    t.isConnected && !t.closest("[hidden]") && !t.closest(".is-ready [data-reelup-deck-card]:not(.is-active)");

  const reconcile = () => {
    const viewerOpen = document.querySelector("dialog.reelup-viewer[open], dialog.reelup-story[open]");
    if (document.hidden) return;
    const hoverWanted = viewerOpen ? [] : [...hovered].filter(eligible);
    const scrollWanted =
      viewerOpen || !pageLoaded || reducedMotion()
        ? []
        : [...visible]
            .filter((t) => eligible(t) && !finished.has(t) && !hovered.has(t))
            .sort((a, b) => distanceToCentre(a) - distanceToCentre(b));
    const wanted = [...hoverWanted, ...scrollWanted].slice(0, MAX_PREVIEWS);

    for (const [trigger, entry] of [...running]) {
      if (wanted.includes(trigger)) continue;
      // A finished preview keeps its last frame while it stays on screen.
      if (entry.done && !viewerOpen && visible.has(trigger) && eligible(trigger)) continue;
      stopPreview(trigger);
    }
    wanted.forEach((trigger) => {
      const entry = running.get(trigger);
      if (entry?.done && hovered.has(trigger)) {
        // Hovering a finished preview restarts it.
        stopPreview(trigger);
      }
      startPreview(trigger, hovered.has(trigger));
    });
  };

  let reconcileQueued = false;
  queueReconcile = () => {
    if (reconcileQueued) return;
    reconcileQueued = true;
    requestAnimationFrame(() => {
      reconcileQueued = false;
      reconcile();
    });
  };

  if (!pageLoaded) {
    window.addEventListener(
      "load",
      () => {
        pageLoaded = true;
        queueReconcile();
      },
      { once: true },
    );
  }

  document.addEventListener("visibilitychange", () => {
    for (const [trigger, entry] of running) {
      if (entry.done) continue;
      if (document.hidden) {
        entry.video.pause();
        if (entry.timer) {
          clearTimeout(entry.timer);
          entry.timer = null;
          entry.remaining = Math.max(entry.remaining - (Date.now() - entry.startedAt), 0);
        }
      } else {
        entry.video.play().catch(() => {});
        if (entry.startedAt) startTimer(trigger, entry);
      }
    }
    if (!document.hidden) queueReconcile();
  });

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
    if (!previewObserver) return;
    // Forget triggers removed by a theme-editor reload.
    for (const t of [...visible]) if (!t.isConnected) visible.delete(t);
    for (const t of [...hovered]) if (!t.isConnected) hovered.delete(t);
    document.querySelectorAll("[data-reelup-trigger]").forEach((trigger) => {
      if (trigger.dataset.reelupPreviewBound || !trigger.dataset.hlsSrc) return;
      // Hover triggers are observed too, so a finished frame is dropped
      // when they scroll away.
      if (trigger.dataset.autoplayScroll !== "true" && trigger.dataset.playTrigger !== "hover") return;
      trigger.dataset.reelupPreviewBound = "true";
      previewObserver.observe(trigger);
    });
  };

  // Viewers pause every preview while open; decks change which card is in
  // front. Both just ask for a fresh reconcile.
  document.addEventListener("reelup:viewer-change", queueReconcile);
  document.addEventListener("reelup:deck-change", queueReconcile);
  document.addEventListener("reelup:layout-change", queueReconcile);
  window.addEventListener("scroll", queueReconcile, { passive: true });

  const bindAll = () => {
    bindTriggers();
    bindStrips();
    bindDecks();
    bindPreviews();
    queueReconcile();
  };

  // Shared links carry ?reelup=<id>; open that reel once, after binding,
  // then drop the parameter so reloads/back navigation don't reopen it.
  const openFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("reelup");
    if (!id || !/^\d+$/.test(id)) return;
    const trigger = Array.from(document.querySelectorAll("[data-reelup-trigger]")).find(
      (t) => String(t.dataset.reelId ?? "").split("/").pop() === id,
    );
    if (!trigger) return;
    trigger.scrollIntoView({ block: "center" });
    if (trigger.closest("[data-reelup-story-group]")) {
      trigger.querySelector(".reelup-trigger__button")?.click();
    } else {
      const groupEl = trigger.closest("[data-reelup-group]");
      window.ReelupLightbox?.open(trigger, groupEl ? Array.from(groupEl.querySelectorAll("[data-reelup-trigger]")) : null);
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("reelup");
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // Sandboxed frames can refuse replaceState; harmless.
    }
  };

  window.ReelupTrigger = { bind: bindAll };
  bindAll();
  // Story triggers are bound by reel-story.js, which loads before this file.
  openFromUrl();
  document.addEventListener("shopify:section:load", bindAll);
  document.addEventListener("shopify:section:unload", () => setTimeout(pruneStrips, 0));
  document.addEventListener("shopify:block:select", bindAll);
})();
