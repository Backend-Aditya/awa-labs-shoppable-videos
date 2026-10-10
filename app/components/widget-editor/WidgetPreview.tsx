// Live, approximate render of each storefront widget inside a mock page, so
// merchants see a change the moment they make it instead of saving and
// reloading their theme. Mirrors the shapes, spacing and style variables of
// extensions/shoppable-video-widgets/assets/*.css — keep the two in step when
// changing either.
import type { CSSProperties } from "react";
import { useState } from "react";
import type { WidgetKind, WidgetStyleConfig } from "../../models/widget-kinds";
import type { BrandConfig } from "../../models/brand";
import { BRAND_DEFAULTS } from "../../models/brand";
import styles from "./preview.module.css";

export interface PreviewProduct {
  id: string;
  title: string;
  imageUrl: string | null;
  price: string;
}

export interface PreviewReel {
  id: string;
  title: string;
  posterUrl?: string;
  durationSeconds?: number;
  products: PreviewProduct[];
}

const SAMPLE_POSTERS = [
  "linear-gradient(160deg, #d9c7b8, #8c6f5a)",
  "linear-gradient(160deg, #b9cbd6, #4f6b7d)",
  "linear-gradient(160deg, #d6d1b4, #7d7a4f)",
  "linear-gradient(160deg, #e0b9b9, #8a4f5a)",
  "linear-gradient(160deg, #c3c9e0, #565f8c)",
];

const SAMPLE_REELS: PreviewReel[] = ["Morning routine", "Styling tips", "Unboxing", "Behind the scenes", "How it fits"].map(
  (title, i) => ({
    id: `sample-${i}`,
    title,
    durationSeconds: [24, 41, 18, 33, 27][i],
    products: [
      { id: `p-${i}`, title: ["Linen shirt", "Canvas tote", "Ceramic mug", "Wool scarf", "Leather belt"][i], imageUrl: null, price: ["$48.00", "$32.00", "$18.00", "$56.00", "$40.00"][i] },
      { id: `q-${i}`, title: "Everyday cap", imageUrl: null, price: "$24.00" },
    ],
  }),
);

const RADIUS = { sharp: "0px", rounded: "10px", soft: "18px" } as const;
const SHADOW = {
  none: "none",
  soft: "0 2px 10px rgb(0 0 0 / 0.10)",
  bold: "0 14px 32px rgb(0 0 0 / 0.24)",
} as const;

export function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Poster({ reel, index, className }: { reel: PreviewReel; index: number; className?: string }) {
  return (
    <div
      className={`${styles.poster} ${className ?? ""}`}
      style={{
        backgroundImage: reel.posterUrl ? `url("${reel.posterUrl}")` : SAMPLE_POSTERS[index % SAMPLE_POSTERS.length],
      }}
    />
  );
}

function ProductThumb({ product, size }: { product: PreviewProduct; size: number }) {
  return (
    <span
      className={styles.productThumb}
      style={{
        width: size,
        height: size,
        backgroundImage: product.imageUrl ? `url("${product.imageUrl}")` : undefined,
      }}
    />
  );
}

function Skeleton({ w, h = 10, r = 4 }: { w: string | number; h?: number; r?: number }) {
  return <span className={styles.skeleton} style={{ width: w, height: h, borderRadius: r }} />;
}

type Device = "desktop" | "mobile";
type Mode = "page" | "viewer";

export function WidgetPreview({
  kind,
  style,
  reels,
  brand = BRAND_DEFAULTS,
}: {
  kind: WidgetKind;
  style: WidgetStyleConfig;
  reels: PreviewReel[];
  brand?: BrandConfig;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [mode, setMode] = useState<Mode>("page");
  const usingSamples = reels.length === 0;
  const shown = usingSamples ? SAMPLE_REELS : reels;

  const vars = {
    "--pv-radius": RADIUS[style.cornerStyle ?? "rounded"],
    "--pv-shadow": SHADOW[style.shadowPreset ?? "none"],
    "--pv-accent": style.accentColor || brand.accentColor,
    "--pv-accent-2": style.accentSecondaryColor || style.accentColor || brand.accentColor,
    "--pv-bg": style.backgroundColor || "transparent",
    "--pv-text": style.textColor || "#1a1a1a",
    "--pv-cta": style.ctaColor || brand.buttonColor,
    "--pv-cta-text": style.ctaTextColor || brand.buttonTextColor,
    "--pv-sale": brand.salePriceColor,
    "--pv-size": `${style.triggerSize ?? 200}px`,
    "--pv-columns": String(style.columns ?? 4),
  } as CSSProperties;

  return (
    <div className={styles.frame}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup} role="tablist" aria-label="Preview">
          <button type="button" role="tab" aria-selected={mode === "page"} onClick={() => setMode("page")}>
            On page
          </button>
          <button type="button" role="tab" aria-selected={mode === "viewer"} onClick={() => setMode("viewer")}>
            Video viewer
          </button>
        </div>
        <div className={styles.toolbarGroup} role="radiogroup" aria-label="Device">
          <button type="button" role="radio" aria-checked={device === "desktop"} onClick={() => setDevice("desktop")} aria-label="Desktop">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v8a1.5 1.5 0 0 1-1.5 1.5H11v1.5h2a.75.75 0 0 1 0 1.5H7a.75.75 0 0 1 0-1.5h2V14H4.5A1.5 1.5 0 0 1 3 12.5v-8Zm1.5 0v8h11v-8h-11Z" /></svg>
          </button>
          <button type="button" role="radio" aria-checked={device === "mobile"} onClick={() => setDevice("mobile")} aria-label="Mobile">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6.5 2A1.5 1.5 0 0 0 5 3.5v13A1.5 1.5 0 0 0 6.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 13.5 2h-7Zm0 1.5h7v13h-7v-13ZM9 14.25a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1-.75-.75Z" /></svg>
          </button>
        </div>
      </div>

      <div className={styles.stage} data-device={device}>
        <div className={styles.viewport} style={vars} data-device={device}>
          {mode === "viewer" ? (
            <ViewerPreview reel={shown[0]} index={0} style={style} device={device} theme={brand.viewerTheme} />
          ) : (
            <PagePreview kind={kind} style={style} reels={shown} device={device} />
          )}
        </div>
      </div>

      {usingSamples && (
        <p className={styles.footnote}>Showing sample videos. Add reels on the Content tab to preview your own.</p>
      )}
    </div>
  );
}

function PagePreview({
  kind,
  style,
  reels,
  device,
}: {
  kind: WidgetKind;
  style: WidgetStyleConfig;
  reels: PreviewReel[];
  device: Device;
}) {
  switch (kind) {
    case "PRODUCT_PAGE_REELS":
      return (
        <>
          <ProductPageMock device={device} />
          <Filmstrip style={style} reels={reels} />
        </>
      );
    case "CAROUSEL":
      return (
        <>
          <HomeHeroMock />
          <Deck style={style} reels={reels} device={device} />
        </>
      );
    case "STORIES":
      return (
        <>
          <Stories style={style} reels={reels} />
          <HomeHeroMock />
        </>
      );
    case "SINGLE_VIDEO":
      return <Feature style={style} reel={reels[0]} device={device} />;
    case "REEL_POPS":
      return <Pop style={style} reel={reels[0]} />;
    case "ADD_TO_CART_VIDEO":
      return <AtcMock style={style} reel={reels[0]} device={device} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ mocks */

function ProductPageMock({ device }: { device: Device }) {
  return (
    <div className={styles.productMock} data-device={device}>
      <span className={styles.mockImage} />
      <div className={styles.mockLines}>
        <Skeleton w="70%" h={14} />
        <Skeleton w="30%" />
        <Skeleton w="100%" h={34} r={8} />
      </div>
    </div>
  );
}

function HomeHeroMock() {
  return (
    <div className={styles.heroMock}>
      <Skeleton w="45%" h={14} />
      <Skeleton w="30%" />
    </div>
  );
}

function Heading({ text, align = "start" }: { text?: string; align?: "start" | "center" }) {
  if (!text) return null;
  return (
    <h3 className={styles.heading} style={{ textAlign: align }}>
      {text}
    </h3>
  );
}

/* ------------------------------------------------------------- filmstrip */

function Filmstrip({ style, reels }: { style: WidgetStyleConfig; reels: PreviewReel[] }) {
  const grid = style.layoutMode === "grid";
  return (
    <div className={styles.section} style={{ background: "var(--pv-bg)" }}>
      <Heading text={style.heading} />
      <div className={grid ? styles.filmGrid : styles.filmRow}>
        {reels.map((reel, i) => (
          <div key={reel.id} className={styles.filmCard}>
            <div className={styles.filmPosterWrap}>
              <Poster reel={reel} index={i} />
              {style.showDuration && formatDuration(reel.durationSeconds) && (
                <span className={styles.chip}>
                  <PlayGlyph size={8} />
                  {formatDuration(reel.durationSeconds)}
                </span>
              )}
            </div>
            {style.showCaption && <p className={styles.caption}>{reel.title}</p>}
            {style.showProductPreview && reel.products[0] && (
              <div className={styles.filmProduct}>
                <ProductThumb product={reel.products[0]} size={26} />
                <span className={styles.filmProductText}>
                  <span className={styles.oneLine}>{reel.products[0].title}</span>
                  {style.showPrice && <span className={styles.subdued}>{reel.products[0].price}</span>}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ deck */

function Deck({ style, reels, device }: { style: WidgetStyleConfig; reels: PreviewReel[]; device: Device }) {
  const [requested, setActive] = useState(1);
  const active = Math.max(0, Math.min(requested, reels.length - 1));
  const mode = style.layoutMode ?? "stack";

  if (mode === "grid" || mode === "carousel") {
    return (
      <div className={styles.section} style={{ background: "var(--pv-bg)" }}>
        <Heading text={style.heading} align="center" />
        <div className={mode === "grid" ? styles.deckGrid : styles.deckSlider}>
          {reels.map((reel, i) => (
            <div key={reel.id} className={styles.deckGridCard}>
              <Poster reel={reel} index={i} />
              {style.showCaption && <span className={styles.overlayCaption}>{reel.title}</span>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const spread = device === "mobile" ? 46 : 58;
  return (
    <div className={styles.section} style={{ background: "var(--pv-bg)" }}>
      <Heading text={style.heading} align="center" />
      <div className={styles.deck}>
        {reels.map((reel, i) => {
          const offset = i - active;
          const abs = Math.abs(offset);
          if (abs > 2) return null;
          return (
            <button
              type="button"
              key={reel.id}
              className={styles.deckCard}
              data-active={offset === 0 || undefined}
              onClick={() => setActive(i)}
              aria-label={reel.title}
              style={{
                transform: `translateX(calc(-50% + ${offset * spread}%)) scale(${1 - abs * 0.14})`,
                zIndex: 10 - abs,
                filter: abs ? `brightness(${1 - abs * 0.18})` : undefined,
              }}
            >
              <Poster reel={reel} index={i} />
              {offset === 0 && (
                <>
                  <span className={styles.deckPlay}>
                    <PlayGlyph size={14} />
                  </span>
                  {style.showCaption && <span className={styles.overlayCaption}>{reel.title}</span>}
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className={styles.deckNav}>
        <span className={styles.deckArrow} aria-hidden="true">‹</span>
        {reels.map((reel, i) => (
          <span key={reel.id} className={styles.deckDot} data-active={i === active || undefined} />
        ))}
        <span className={styles.deckArrow} aria-hidden="true">›</span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- stories */

function Stories({ style, reels }: { style: WidgetStyleConfig; reels: PreviewReel[] }) {
  const ring =
    style.ringStyle === "solid"
      ? "var(--pv-accent)"
      : "linear-gradient(45deg, var(--pv-accent), var(--pv-accent-2))";
  return (
    <div className={styles.section}>
      <Heading text={style.heading} />
      <div className={styles.storyRow}>
        {reels.map((reel, i) => (
          <div key={reel.id} className={styles.story}>
            <span className={styles.storyRing} style={{ background: i === reels.length - 1 ? "#d4d4d4" : ring }}>
              <span className={styles.storyInner}>
                <Poster reel={reel} index={i} className={styles.storyPoster} />
              </span>
            </span>
            {style.showCaption && <span className={styles.storyLabel}>{reel.title}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- feature */

function Feature({ style, reel, device }: { style: WidgetStyleConfig; reel: PreviewReel; device: Device }) {
  const split = style.singleLayout !== "poster";
  const video = (
    <div className={styles.featureVideo}>
      <Poster reel={reel} index={0} />
      <span className={styles.featurePlay}>
        <PlayGlyph size={18} />
      </span>
      {style.showDuration && formatDuration(reel.durationSeconds) && (
        <span className={styles.chip}>{formatDuration(reel.durationSeconds)}</span>
      )}
    </div>
  );

  if (!split) {
    return (
      <div className={styles.section} style={{ background: "var(--pv-bg)" }}>
        <Heading text={style.heading} align="center" />
        <div className={styles.featureSolo}>{video}</div>
      </div>
    );
  }

  return (
    <div className={styles.section} style={{ background: "var(--pv-bg)" }}>
      <div className={styles.feature} data-device={device}>
        {video}
        <div className={styles.featureBody}>
          {style.heading && <h3 className={styles.featureHeading}>{style.heading}</h3>}
          <p className={styles.subdued}>{reel.title}</p>
          <div className={styles.featureProducts}>
            {reel.products.slice(0, 3).map((product) => (
              <div key={product.id} className={styles.featureProduct}>
                {style.showProductImage && <ProductThumb product={product} size={48} />}
                <span className={styles.filmProductText}>
                  <span className={styles.oneLine}>{product.title}</span>
                  {style.showPrice && <span className={styles.subdued}>{product.price}</span>}
                </span>
                <CtaButton style={style} small />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- pop */

const POP_POSITION: Record<string, CSSProperties> = {
  bottom_right: { right: 14, bottom: 14 },
  bottom_left: { left: 14, bottom: 14 },
  top_right: { right: 14, top: 14 },
  top_left: { left: 14, top: 14 },
};

function Pop({ style, reel }: { style: WidgetStyleConfig; reel: PreviewReel }) {
  const portrait = style.popShape !== "circle";
  const size = Math.round((style.triggerSize ?? 96) * 0.8);
  const position = POP_POSITION[style.position ?? "bottom_right"];
  const onLeft = (style.position ?? "bottom_right").endsWith("left");
  return (
    <div className={styles.popPage}>
      <HomeHeroMock />
      <div className={styles.popGrid}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={styles.mockTile} />
        ))}
      </div>
      <div className={styles.pop} style={{ ...position, flexDirection: onLeft ? "row" : "row-reverse" }}>
        <span
          className={styles.popPlayer}
          data-pulse={style.showPulse || undefined}
          style={{
            width: size,
            height: portrait ? Math.round(size * 16 / 9) : size,
            borderRadius: portrait ? 14 : "50%",
          }}
        >
          <Poster reel={reel} index={0} />
          <span className={styles.popDismiss}>×</span>
        </span>
        {style.bubbleLabel && (
          <span className={styles.popLabel}>
            <PlayGlyph size={8} />
            {style.bubbleLabel}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- atc */

function AtcMock({ style, reel, device }: { style: WidgetStyleConfig; reel: PreviewReel; device: Device }) {
  const size = style.triggerSize ?? 56;
  const sub = [reel.title, style.showDuration ? formatDuration(reel.durationSeconds) : ""].filter(Boolean).join(" · ");
  return (
    <div className={styles.productMock} data-device={device}>
      <span className={styles.mockImage} />
      <div className={styles.mockLines}>
        <Skeleton w="70%" h={14} />
        <Skeleton w="30%" />
        <div className={styles.mockVariants}>
          <Skeleton w={36} h={24} r={6} />
          <Skeleton w={36} h={24} r={6} />
          <Skeleton w={36} h={24} r={6} />
        </div>
        <span className={styles.mockAtc}>Add to cart</span>
        <div className={styles.atcRow} style={{ background: "var(--pv-bg)" }}>
          <span className={styles.atcThumb} style={{ width: size, height: size }}>
            <Poster reel={reel} index={0} />
            <span className={styles.atcPlay}>
              <PlayGlyph size={8} />
            </span>
          </span>
          <span className={styles.atcText}>
            <span className={styles.atcLabel}>{style.watchLabel || "Watch video"}</span>
            {sub && <span className={`${styles.subdued} ${styles.oneLine}`}>{sub}</span>}
          </span>
          <span className={styles.atcChevron} aria-hidden="true">›</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- viewer */

function CtaButton({ style, small = false }: { style: WidgetStyleConfig; small?: boolean }) {
  const label = style.ctaLabel || "Add to cart";
  return (
    <span className={styles.cta} data-variant={style.ctaStyle ?? "pill"} data-small={small || undefined}>
      {label}
    </span>
  );
}

function ViewerPreview({
  reel,
  index,
  style,
  device,
  theme,
}: {
  reel: PreviewReel;
  index: number;
  style: WidgetStyleConfig;
  device: Device;
  theme: BrandConfig["viewerTheme"];
}) {
  const tap = style.tagRevealMode === "tap";
  return (
    <div className={styles.viewer} data-device={device} data-theme={theme}>
      <div className={styles.viewerPlayer}>
        <Poster reel={reel} index={index} />
        <span className={styles.viewerProgress}>
          <span style={{ width: "38%" }} />
        </span>
        {style.showTitleOverlay && <span className={styles.viewerTitle}>{reel.title}</span>}
        {style.showShare !== false && (
          <span className={`${styles.viewerMute} ${styles.viewerShare}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3 7.5 7.5l1.4 1.4L11 6.8V15h2V6.8l2.1 2.1 1.4-1.4L12 3ZM5 13v6.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V13h-2v6H7v-6H5Z" /></svg>
          </span>
        )}
        <span className={styles.viewerMute}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.03v7.94c1.48-.73 2.5-2.25 2.5-3.97z" /></svg>
        </span>
      </div>
      <div className={styles.viewerPanel}>
        <div className={styles.viewerPanelHead}>
          <span>Shop this video</span>
          {tap && <span className={styles.subdued}>{reel.products.length} ›</span>}
        </div>
        {!tap &&
          reel.products.slice(0, 2).map((product) => (
            <div key={product.id} className={styles.viewerProduct}>
              {style.showProductImage && <ProductThumb product={product} size={44} />}
              <span className={styles.filmProductText}>
                <span className={styles.oneLine}>{product.title}</span>
                {style.showPrice && <span className={styles.subdued}>{product.price}</span>}
              </span>
              {style.showQuantity && <span className={styles.qty}>− 1 +</span>}
              <CtaButton style={style} small />
            </div>
          ))}
        {!tap && style.showRecommendations !== false && device === "desktop" && (
          <div className={styles.recs}>
            <span className={styles.recsTitle}>You may also like</span>
            <span className={styles.recsRow}>
              {[0, 1, 2].map((i) => (
                <span key={i} className={styles.recTile} />
              ))}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function PlayGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
      <path d="M2 1.2v7.6a.5.5 0 0 0 .76.43l6.1-3.8a.5.5 0 0 0 0-.86L2.76.77A.5.5 0 0 0 2 1.2Z" />
    </svg>
  );
}
