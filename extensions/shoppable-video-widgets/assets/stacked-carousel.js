(() => {
  const supportsNativeHls = (video) =>
    video.canPlayType("application/vnd.apple.mpegurl") !== "";

  const attachSource = (cardEl, video, hlsSrc) => {
    if (supportsNativeHls(video)) {
      video.src = hlsSrc;
      return Promise.resolve();
    }
    return Promise.reject(new Error("HLS not supported and no fallback loaded for stacked-carousel"));
  };

  const activateCard = async (cardEl) => {
    if (cardEl.dataset.reelupBound) return;
    cardEl.dataset.reelupBound = "true";

    const video = cardEl.querySelector(".reelup-stack__video");
    const hlsSrc = cardEl.dataset.hlsSrc;
    if (!video || !hlsSrc) return;

    try {
      await attachSource(cardEl, video, hlsSrc);
      cardEl.setAttribute("data-activated", "true");
      await video.play();
    } catch {
      // Leave the poster visible if playback can't start.
    }
  };

  document.querySelectorAll("[data-reelup-stack]").forEach((stackEl) => {
    const cards = Array.from(stackEl.querySelectorAll("[data-reelup-stack-card]"));
    if (cards.length === 0) return;

    let order = cards;
    const reindex = () => {
      order.forEach((card, index) => {
        card.style.setProperty("--reelup-stack-index", String(index));
      });
    };

    const advance = () => {
      const [front, ...rest] = order;
      front.querySelector(".reelup-stack__video")?.pause();
      order = [...rest, front];
      reindex();
      activateCard(order[0]);
    };

    reindex();
    activateCard(order[0]);

    stackEl.querySelector("[data-reelup-stack-next]")?.addEventListener("click", advance);
    stackEl.addEventListener("click", (event) => {
      const card = event.target.closest("[data-reelup-stack-card]");
      if (!card || card !== order[0]) return;
      if (order.length > 1) advance();
    });
  });
})();
