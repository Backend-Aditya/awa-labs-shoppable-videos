// The admin's live preview. Class names come from preview.module.css; the
// components project runs CSS modules with non-scoped names, so `.deck` here
// is `styles.deck` in the component.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatDuration, WidgetPreview } from "./WidgetPreview";
import type { PreviewReel } from "./WidgetPreview";
import { WIDGET_KIND_META } from "../../models/widget-kinds";
import type { WidgetKind, WidgetStyleConfig } from "../../models/widget-kinds";
import { BRAND_DEFAULTS } from "../../models/brand";
import type { BrandConfig } from "../../models/brand";

const reel = (n: number, products = 2): PreviewReel => ({
  id: `r${n}`,
  title: `Reel ${n}`,
  posterUrl: `https://cdn.test/poster-${n}.jpg`,
  durationSeconds: 65 + n,
  products: Array.from({ length: products }, (_, i) => ({
    id: `p${n}-${i}`,
    title: `Product ${n}.${i}`,
    imageUrl: null,
    price: `$${10 + i}.00`,
  })),
});
const reels = (count: number) => Array.from({ length: count }, (_, i) => reel(i + 1));

const defaults = (kind: Exclude<WidgetKind, "GRID">): WidgetStyleConfig => ({ ...WIDGET_KIND_META[kind].defaults });

function renderPreview(kind: Exclude<WidgetKind, "GRID">, style: WidgetStyleConfig = {}, list = reels(4), brand?: BrandConfig) {
  const utils = render(<WidgetPreview kind={kind} style={{ ...defaults(kind), ...style }} reels={list} brand={brand} />);
  const viewport = utils.container.querySelector<HTMLElement>(".viewport")!;
  return { ...utils, viewport };
}

describe("formatDuration", () => {
  it.each([
    [undefined, ""],
    [0, ""],
    [Number.NaN, ""],
    [5, "0:05"],
    [65, "1:05"],
    [59.6, "1:00"],
    [600, "10:00"],
  ])("%s → %j", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe("WidgetPreview — page mode per kind", () => {
  it("PRODUCT_PAGE_REELS: filmstrip with heading, captions, duration chips and first product", () => {
    const { container } = renderPreview("PRODUCT_PAGE_REELS", { heading: "Watch it" });
    expect(screen.getByRole("heading", { name: "Watch it" })).toBeInTheDocument();
    expect(container.querySelector(".filmRow")).not.toBeNull();
    expect(container.querySelectorAll(".filmCard")).toHaveLength(4);
    expect(screen.getByText("Reel 1")).toBeInTheDocument();
    expect(screen.getByText("1:06")).toBeInTheDocument();
    expect(screen.getByText("Product 1.0")).toBeInTheDocument();
    expect(screen.queryByText("Product 1.1")).not.toBeInTheDocument();
  });

  it("PRODUCT_PAGE_REELS: grid layout and hidden extras", () => {
    const { container } = renderPreview("PRODUCT_PAGE_REELS", {
      layoutMode: "grid",
      showCaption: false,
      showDuration: false,
      showProductPreview: false,
    });
    expect(container.querySelector(".filmGrid")).not.toBeNull();
    expect(screen.queryByText("Reel 1")).not.toBeInTheDocument();
    expect(screen.queryByText("1:06")).not.toBeInTheDocument();
    expect(screen.queryByText("Product 1.0")).not.toBeInTheDocument();
  });

  it("CAROUSEL: stacked deck shows at most 5 cards, centre card active, side card click brings it forward", async () => {
    const { container } = renderPreview("CAROUSEL", { layoutMode: "stack" }, reels(6));
    const deck = container.querySelector(".deck")!;
    // active=1 by default; cards more than 2 away are not drawn.
    const cards = within(deck as HTMLElement).getAllByRole("button");
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Bring “Reel 1” forward",
      "Preview “Reel 2” in the video viewer",
      "Bring “Reel 3” forward",
      "Bring “Reel 4” forward",
    ]);
    expect(cards[1]).toHaveAttribute("data-active", "true");

    await userEvent.click(screen.getByRole("button", { name: /Reel 4/ }));
    expect(screen.getByRole("button", { name: /Reel 4/ })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: /Reel 2/ })).not.toHaveAttribute("data-active");
    expect(container.querySelectorAll(".deckDot[data-active]")).toHaveLength(1);
    expect(container.querySelectorAll(".deckDot")[3]).toHaveAttribute("data-active", "true");

    // The arrows step through the deck too.
    await userEvent.click(screen.getByRole("button", { name: "Next video" }));
    expect(container.querySelectorAll(".deckDot")[4]).toHaveAttribute("data-active", "true");
  });

  it("CAROUSEL: clicking the front card opens it in the viewer preview", async () => {
    renderPreview("CAROUSEL", { layoutMode: "stack" }, reels(6));
    await userEvent.click(screen.getByRole("button", { name: "Preview “Reel 2” in the video viewer" }));
    expect(screen.getByRole("radio", { name: "Video viewer" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("2 / 6")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next video" }));
    expect(screen.getByText("3 / 6")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous video" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous video" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous video" }));
    expect(screen.getByText("6 / 6")).toBeInTheDocument();
  });

  it("PRODUCT_PAGE_REELS: a filmstrip card opens with Enter and plays its preview on hover", async () => {
    // Only Stream posters have an animated preview to swap in.
    const streamReels = reels(3).map((r, i) => ({
      ...r,
      posterUrl: `https://customer-x.cloudflarestream.com/uid${i}/thumbnails/thumbnail.jpg?time=2s`,
      coverTime: 2,
    }));
    const { container } = renderPreview("PRODUCT_PAGE_REELS", {}, streamReels);
    const card = screen.getByRole("button", { name: "Preview “Reel 3” in the video viewer" });
    await userEvent.hover(card);
    expect(card.querySelector("img")?.getAttribute("src")).toBe(
      "https://customer-x.cloudflarestream.com/uid2/thumbnails/thumbnail.gif?time=2s&duration=4s&height=360&fps=12",
    );
    await userEvent.unhover(card);
    expect(card.querySelector("img")).toBeNull();
    card.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    expect(container.querySelector(".viewer")).not.toBeNull();
  });

  it.each([1, 2])("CAROUSEL: a stack with %i reel(s) falls back to the slider, like the storefront", (count) => {
    const { container } = renderPreview("CAROUSEL", { layoutMode: "stack" }, reels(count));
    expect(container.querySelector(".deck")).toBeNull();
    expect(container.querySelector(".deckSlider")).not.toBeNull();
    expect(container.querySelectorAll(".deckGridCard")).toHaveLength(count);
  });

  it("CAROUSEL: grid layout", () => {
    const { container } = renderPreview("CAROUSEL", { layoutMode: "grid" }, reels(4));
    expect(container.querySelector(".deckGrid")).not.toBeNull();
  });

  it("STORIES: a ring per reel, last one greyed as 'seen', gradient vs solid ring", () => {
    const { container, rerender } = renderPreview("STORIES", { ringStyle: "gradient", showCaption: true });
    const rings = container.querySelectorAll<HTMLElement>(".storyRing");
    expect(rings).toHaveLength(4);
    expect(rings[0].style.background).toContain("linear-gradient");
    expect(rings[3].style.background).toMatch(/#d4d4d4|rgb\(212, 212, 212\)/);
    expect(screen.getByText("Reel 1")).toBeInTheDocument();

    rerender(<WidgetPreview kind="STORIES" style={{ ...defaults("STORIES"), ringStyle: "solid" }} reels={reels(4)} />);
    expect(container.querySelectorAll<HTMLElement>(".storyRing")[0].style.background).toBe("var(--pv-accent)");
  });

  it("SINGLE_VIDEO: split layout lists up to 3 products with CTA", () => {
    const { container } = renderPreview("SINGLE_VIDEO", { singleLayout: "split", heading: "Featured", ctaLabel: "Buy now" }, [reel(1, 4)]);
    expect(container.querySelector(".feature")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Featured" })).toBeInTheDocument();
    expect(container.querySelectorAll(".featureProduct")).toHaveLength(3);
    expect(screen.getAllByText("Buy now")).toHaveLength(3);
  });

  it("SINGLE_VIDEO: poster layout has no product column", () => {
    const { container } = renderPreview("SINGLE_VIDEO", { singleLayout: "poster" }, [reel(1)]);
    expect(container.querySelector(".featureSolo")).not.toBeNull();
    expect(container.querySelector(".featureProduct")).toBeNull();
  });

  it("REEL_POPS: bubble label, position and circle shape", () => {
    const { container } = renderPreview("REEL_POPS", { bubbleLabel: "Watch me", position: "top_left", popShape: "circle", triggerSize: 100 });
    expect(screen.getByText("Watch me")).toBeInTheDocument();
    const pop = container.querySelector<HTMLElement>(".pop")!;
    expect(pop.style.left).toBe("14px");
    expect(pop.style.top).toBe("14px");
    expect(pop.style.flexDirection).toBe("row");
    const player = container.querySelector<HTMLElement>(".popPlayer")!;
    expect(player.style.borderRadius).toBe("50%");
    expect(player.style.width).toBe("80px");
    expect(player.style.height).toBe("80px");
  });

  it("REEL_POPS: portrait is 9:16 and defaults to the bottom right", () => {
    const { container } = renderPreview("REEL_POPS", { popShape: "portrait", triggerSize: 90, position: undefined, bubbleLabel: "" });
    const pop = container.querySelector<HTMLElement>(".pop")!;
    expect(pop.style.right).toBe("14px");
    expect(pop.style.flexDirection).toBe("row-reverse");
    expect(container.querySelector<HTMLElement>(".popPlayer")!.style.height).toBe("128px");
    expect(container.querySelector(".popLabel")).toBeNull();
  });

  it("ADD_TO_CART_VIDEO: watch label falls back, meta joins title and duration", () => {
    renderPreview("ADD_TO_CART_VIDEO", { watchLabel: "", showDuration: true }, [reel(1)]);
    expect(screen.getByText("Watch video")).toBeInTheDocument();
    expect(screen.getByText("Reel 1 · 1:06")).toBeInTheDocument();
  });

  it("uses sample reels and says so when the widget has none", () => {
    const { container } = renderPreview("PRODUCT_PAGE_REELS", {}, []);
    expect(screen.getByText(/Showing sample videos/)).toBeInTheDocument();
    expect(container.querySelectorAll(".filmCard")).toHaveLength(5);
    expect(screen.getByText("Morning routine")).toBeInTheDocument();
  });

  it("does not show the sample footnote with real reels", () => {
    renderPreview("PRODUCT_PAGE_REELS");
    expect(screen.queryByText(/Showing sample videos/)).not.toBeInTheDocument();
  });

  it("switches device", async () => {
    const { viewport } = renderPreview("PRODUCT_PAGE_REELS");
    expect(viewport).toHaveAttribute("data-device", "desktop");
    await userEvent.click(screen.getByRole("radio", { name: "Mobile" }));
    expect(viewport).toHaveAttribute("data-device", "mobile");
    expect(screen.getByRole("radio", { name: "Mobile" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("WidgetPreview — style variables and brand fallbacks", () => {
  const brand: BrandConfig = {
    ...BRAND_DEFAULTS,
    accentColor: "#aa0000",
    buttonColor: "#00aa00",
    buttonTextColor: "#0000aa",
    salePriceColor: "#ff00ff",
  };

  it("empty widget colors inherit the brand kit", () => {
    const { viewport } = renderPreview("PRODUCT_PAGE_REELS", { accentColor: "", ctaColor: "", ctaTextColor: "" }, reels(2), brand);
    expect(viewport.style.getPropertyValue("--pv-accent")).toBe("#aa0000");
    expect(viewport.style.getPropertyValue("--pv-accent-2")).toBe("#aa0000");
    expect(viewport.style.getPropertyValue("--pv-cta")).toBe("#00aa00");
    expect(viewport.style.getPropertyValue("--pv-cta-text")).toBe("#0000aa");
    expect(viewport.style.getPropertyValue("--pv-sale")).toBe("#ff00ff");
    expect(viewport.style.getPropertyValue("--pv-bg")).toBe("transparent");
    expect(viewport.style.getPropertyValue("--pv-text")).toBe("#1a1a1a");
  });

  it("widget colors override the brand kit", () => {
    const { viewport } = renderPreview(
      "STORIES",
      { accentColor: "#111111", accentSecondaryColor: "#222222", ctaColor: "#333333", ctaTextColor: "#444444", backgroundColor: "#555555", textColor: "#666666" },
      reels(2),
      brand,
    );
    expect(viewport.style.getPropertyValue("--pv-accent")).toBe("#111111");
    expect(viewport.style.getPropertyValue("--pv-accent-2")).toBe("#222222");
    expect(viewport.style.getPropertyValue("--pv-cta")).toBe("#333333");
    expect(viewport.style.getPropertyValue("--pv-cta-text")).toBe("#444444");
    expect(viewport.style.getPropertyValue("--pv-bg")).toBe("#555555");
    expect(viewport.style.getPropertyValue("--pv-text")).toBe("#666666");
  });

  it("without a brand prop, uses BRAND_DEFAULTS", () => {
    const { viewport } = renderPreview("PRODUCT_PAGE_REELS", { accentColor: "", ctaColor: "" });
    expect(viewport.style.getPropertyValue("--pv-accent")).toBe(BRAND_DEFAULTS.accentColor);
    expect(viewport.style.getPropertyValue("--pv-cta")).toBe(BRAND_DEFAULTS.buttonColor);
  });

  it("maps corner, shadow, size and columns", () => {
    const { viewport } = renderPreview("PRODUCT_PAGE_REELS", { cornerStyle: "soft", shadowPreset: "bold", triggerSize: 240, columns: 3 });
    expect(viewport.style.getPropertyValue("--pv-radius")).toBe("18px");
    expect(viewport.style.getPropertyValue("--pv-shadow")).toContain("32px");
    expect(viewport.style.getPropertyValue("--pv-size")).toBe("240px");
    expect(viewport.style.getPropertyValue("--pv-columns")).toBe("3");
  });
});

describe("WidgetPreview — viewer mode", () => {
  const openViewer = () => userEvent.click(screen.getByRole("radio", { name: "Video viewer" }));

  it("shows the first reel's products with CTA, quantity and recommendations", async () => {
    const { container } = renderPreview("PRODUCT_PAGE_REELS", {
      tagRevealMode: "always",
      showQuantity: true,
      showRecommendations: true,
      showTitleOverlay: true,
      ctaLabel: "",
      ctaStyle: "square",
    });
    await openViewer();
    expect(screen.getByRole("radio", { name: "Video viewer" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Shop this video")).toBeInTheDocument();
    expect(container.querySelectorAll(".viewerProduct")).toHaveLength(2);
    expect(screen.getAllByText("Add to cart")[0]).toHaveAttribute("data-variant", "square");
    expect(screen.getAllByText("− 1 +")).toHaveLength(2);
    expect(screen.getByText("You may also like")).toBeInTheDocument();
    expect(container.querySelector(".viewerTitle")).toHaveTextContent("Reel 1");
    expect(container.querySelector(".viewerShare")).not.toBeNull();
  });

  it("tap reveal hides the product list behind a count", async () => {
    const { container } = renderPreview("PRODUCT_PAGE_REELS", { tagRevealMode: "tap" }, [reel(1, 3)]);
    await openViewer();
    expect(screen.getByText("3 ›")).toBeInTheDocument();
    expect(container.querySelector(".viewerProduct")).toBeNull();
    expect(screen.queryByText("You may also like")).not.toBeInTheDocument();
  });

  it("hides share, title and recommendations when turned off; recs never on mobile", async () => {
    const { container } = renderPreview("PRODUCT_PAGE_REELS", {
      showShare: false,
      showTitleOverlay: false,
      showRecommendations: true,
    });
    await openViewer();
    expect(container.querySelector(".viewerShare")).toBeNull();
    expect(container.querySelector(".viewerTitle")).toBeNull();
    expect(screen.getByText("You may also like")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Mobile" }));
    expect(screen.queryByText("You may also like")).not.toBeInTheDocument();
  });

  it("follows the brand's viewer theme", async () => {
    const { container } = renderPreview("SINGLE_VIDEO", {}, [reel(1)], { ...BRAND_DEFAULTS, viewerTheme: "light" });
    await openViewer();
    expect(container.querySelector(".viewer")).toHaveAttribute("data-theme", "light");
    await userEvent.click(screen.getByRole("radio", { name: "On page" }));
    expect(container.querySelector(".viewer")).toBeNull();
  });
});

describe("sale badge", () => {
  it("shows on sample products with a compare-at price, only when switched on", async () => {
    const { rerender } = render(<WidgetPreview kind="PRODUCT_PAGE_REELS" style={{ ...defaults("PRODUCT_PAGE_REELS"), showSaleBadge: true }} reels={[]} />);
    await userEvent.click(screen.getByRole("radio", { name: "Video viewer" }));
    expect(screen.getByText("−20%")).toBeTruthy();
    expect(screen.getByText("$60.00")).toBeTruthy();
    rerender(<WidgetPreview kind="PRODUCT_PAGE_REELS" style={{ ...defaults("PRODUCT_PAGE_REELS"), showSaleBadge: false }} reels={[]} />);
    expect(screen.queryByText("−20%")).toBeNull();
  });

  it("never invents a discount for real products (no compare-at price reaches the editor)", async () => {
    renderPreview("PRODUCT_PAGE_REELS", { ...defaults("PRODUCT_PAGE_REELS"), showSaleBadge: true });
    await userEvent.click(screen.getByRole("radio", { name: "Video viewer" }));
    expect(screen.queryByText(/^−\d+%$/)).toBeNull();
  });
});
