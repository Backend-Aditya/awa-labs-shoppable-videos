// Design-tab building blocks shared by the widget editor: style presets
// ("looks"), arrangement icons, card template drawings, and the Design tab
// for the two video-row widgets (stacked carousel, product page reels).
import { useState } from "react";
import {
  CARD_TEMPLATES as CARD_TEMPLATE_OPTIONS,
  SIZING_FIELDS,
} from "../../models/widget-kinds";
import type { SizingField, StyleFieldKey, WidgetKindMeta, WidgetStyleConfig } from "../../models/widget-kinds";
import type { BrandConfig } from "../../models/brand";
import type { Device, PreviewHighlight } from "./WidgetPreview";
import { Card, ColorInput, Field, handleRovingKeys, Section, Segmented, Slider, TextInput, Toggle } from "./controls";
import styles from "./editor.module.css";

export interface Look {
  name: string;
  style: WidgetStyleConfig;
  swatch: { bg: string; pill: string; radius: number };
}

export const LOOKS: Look[] = [
  {
    name: "Brand",
    style: { cornerStyle: "rounded", shadowPreset: "none", ctaStyle: "pill", accentColor: "", ctaColor: "", ctaTextColor: "", backgroundColor: "" },
    swatch: { bg: "#f4f4f4", pill: "#141414", radius: 999 },
  },
  {
    name: "Editorial",
    style: { cornerStyle: "sharp", shadowPreset: "none", ctaStyle: "text-link", accentColor: "#1d1d1b", ctaColor: "#1d1d1b", ctaTextColor: "#ffffff", backgroundColor: "#efebe4" },
    swatch: { bg: "#efebe4", pill: "#1d1d1b", radius: 0 },
  },
  {
    name: "Showcase",
    style: {
      cornerStyle: "rounded",
      shadowPreset: "none",
      ctaStyle: "square",
      accentColor: "#c9a86a",
      ctaColor: "#4a2b3a",
      ctaTextColor: "#ffffff",
      backgroundColor: "#161412",
      textColor: "#f3efe8",
      cardTemplate: "overlay",
      showPlayIcon: false,
      showCardBadge: true,
      layoutMode: "carousel",
    },
    swatch: { bg: "#161412", pill: "#c9a86a", radius: 4 },
  },
  {
    name: "Vivid",
    style: { cornerStyle: "soft", shadowPreset: "bold", ctaStyle: "pill", accentColor: "#5b3df5", ctaColor: "#5b3df5", ctaTextColor: "#ffffff", backgroundColor: "" },
    swatch: { bg: "#ebe7ff", pill: "#5b3df5", radius: 999 },
  },
];

export const ICON_FILMSTRIP = (
  <svg width="36" height="22" viewBox="0 0 36 22" aria-hidden="true">
    <rect x="1" y="2" width="9" height="16" rx="2" fill="currentColor" />
    <rect x="13" y="2" width="9" height="16" rx="2" fill="currentColor" opacity=".55" />
    <rect x="25" y="2" width="9" height="16" rx="2" fill="currentColor" opacity=".3" />
  </svg>
);
export const ICON_GRID = (
  <svg width="36" height="22" viewBox="0 0 36 22" aria-hidden="true">
    {[0, 1, 2, 3].map((i) => (
      <rect key={i} x={2 + i * 8.5} y="2" width="7" height="8" rx="1.5" fill="currentColor" />
    ))}
    {[0, 1, 2, 3].map((i) => (
      <rect key={i} x={2 + i * 8.5} y="12" width="7" height="8" rx="1.5" fill="currentColor" opacity=".55" />
    ))}
  </svg>
);
export const ICON_STACK = (
  <svg width="36" height="22" viewBox="0 0 36 22" aria-hidden="true">
    <rect x="4" y="5" width="8" height="13" rx="2" fill="currentColor" opacity=".3" />
    <rect x="24" y="5" width="8" height="13" rx="2" fill="currentColor" opacity=".3" />
    <rect x="12" y="1" width="12" height="20" rx="2" fill="currentColor" />
  </svg>
);

// Mini drawings of each carousel card template, matching the storefront's
// .awa-sv-cards--* layouts: where the product sits, and its button.
export function TemplateSchematic({ template }: { template: NonNullable<WidgetStyleConfig["cardTemplate"]> }) {
  const below = template === "classic" || template === "modern" || template === "vibrant";
  const cardH = below ? 34 : 50;
  return (
    <svg className={styles.templateArt} viewBox="0 0 88 60" aria-hidden="true">
      {[4, 31, 58].map((x) => (
        <g key={x}>
          <rect x={x} y="4" width="26" height={cardH} rx="3" fill="currentColor" opacity=".18" />
          {template === "title" && <rect x={x + 3} y={cardH - 6} width="16" height="4" rx="1" fill="currentColor" opacity=".55" />}
          {template === "overlay" && (
            <>
              <rect x={x + 2} y={cardH - 10} width="22" height="10" rx="2" fill="currentColor" opacity=".45" />
              <rect x={x + 4} y={cardH - 8} width="6" height="6" rx="1" fill="#fff" />
            </>
          )}
          {below && (
            <>
              {template !== "modern" && <rect x={x} y={cardH + 7} width="6" height="6" rx="1" fill="currentColor" opacity=".4" />}
              <rect x={template === "modern" ? x : x + 8} y={cardH + 7} width={template === "modern" ? 20 : 14} height="3" rx="1" fill="currentColor" opacity=".55" />
              <rect x={template === "modern" ? x : x + 8} y={cardH + 12} width="10" height="2" rx="1" fill="currentColor" opacity=".35" />
              {template !== "classic" && (
                <rect
                  x={x}
                  y={cardH + 17}
                  width="26"
                  height="6"
                  rx={template === "vibrant" ? 3 : 1}
                  fill={template === "vibrant" ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth={template === "vibrant" ? 0 : 0.8}
                  opacity=".7"
                />
              )}
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------ design: video rows */

// Design tab for the stacked carousel and the product page reels: one
// collapsible section per part of the widget, each summarising its current
// choices when closed. Opening a section outlines that part in the preview.
// Sizes and spacing follow the desktop/mobile switch, which is the
// preview's own device switch, so what's edited is what's shown.
type DesignArea = "cards" | "header" | "layout" | "colors";
const AREA_HIGHLIGHT: Record<DesignArea, PreviewHighlight> = {
  cards: "cards",
  header: "header",
  layout: "layout",
  colors: "section",
};

const ICON_CARDS = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
    <path d="M4.5 3A1.5 1.5 0 0 0 3 4.5v11A1.5 1.5 0 0 0 4.5 17h4A1.5 1.5 0 0 0 10 15.5v-11A1.5 1.5 0 0 0 8.5 3h-4Zm0 1.5h4v8h-4v-8Zm7-1.5A1.5 1.5 0 0 0 10 4.5V5h1.5v-.5h4v8H12V14h3.5a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 15.5 3h-4Z" />
  </svg>
);
const ICON_HEADER = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
    <path d="M4 4.75A.75.75 0 0 1 4.75 4h10.5a.75.75 0 0 1 0 1.5H10.75v10a.75.75 0 0 1-1.5 0v-10H4.75A.75.75 0 0 1 4 4.75Z" />
  </svg>
);
const ICON_LAYOUT = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
    <path d="M3 5.75A.75.75 0 0 1 3.75 5h12.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 5.75Zm0 8.5a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1-.75-.75ZM6.25 8a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 6.25 8Zm7.5 0a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 .75-.75Z" />
  </svg>
);
const ICON_COLORS = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
    <path d="M10 3a7 7 0 1 0 0 14c.97 0 1.5-.7 1.5-1.5 0-.4-.15-.74-.38-1a1.4 1.4 0 0 1-.37-.95c0-.83.67-1.5 1.5-1.5H14a3 3 0 0 0 3-3C17 5.86 13.87 3 10 3Zm-4 7.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm2-3a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm4 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
  </svg>
);

const ICON_DESKTOP = (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v8a1.5 1.5 0 0 1-1.5 1.5H11v1.5h2a.75.75 0 0 1 0 1.5H7a.75.75 0 0 1 0-1.5h2V14H4.5A1.5 1.5 0 0 1 3 12.5v-8Zm1.5 0v8h11v-8h-11Z" />
  </svg>
);
const ICON_MOBILE = (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M6.5 2A1.5 1.5 0 0 0 5 3.5v13A1.5 1.5 0 0 0 6.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 13.5 2h-7Zm0 1.5h7v13h-7v-13Z" />
  </svg>
);

// Stack card sizes (px), desktop and phones.
type StackSize = "auto" | "small" | "medium" | "large";
const STACK_SIZES: Record<"desktop" | "mobile", Record<Exclude<StackSize, "auto">, number>> = {
  desktop: { small: 220, medium: 280, large: 340 },
  mobile: { small: 180, medium: 230, large: 280 },
};

const CORNER_LABEL = { sharp: "Square", rounded: "Rounded", soft: "Soft" } as const;
const LAYOUT_LABEL = { stack: "Stack", carousel: "Slider", grid: "Grid" } as const;

// A size slider for the device being edited: shows the storefront's own
// default (tagged Auto) until set, and can be reset back to it.
export function sizeSliderFor(style: WidgetStyleConfig, setStyle: (patch: Partial<WidgetStyleConfig>) => void, device: Device) {
  const mobile = device === "mobile";
  return function sizeSlider(field: SizingField) {
    const key = mobile ? field.mobileKey : field.key;
    const set = style[key] as number | undefined;
    // Unset on mobile: the storefront scales the desktop value down.
    const fallback = mobile ? Math.min((style[field.key] as number | undefined) ?? field.autoMobile, field.autoMobile * 1.6) : field.auto;
    return (
      <Slider
        key={`${field.key}-${device}`}
        label={field.label}
        min={field.min}
        max={field.max}
        value={set ?? Math.round(fallback)}
        auto={set === undefined}
        onReset={() => setStyle({ [key]: undefined } as Partial<WidgetStyleConfig>)}
        onChange={(value) => setStyle({ [key]: value } as Partial<WidgetStyleConfig>)}
      />
    );
  };
}

// The desktop/mobile switch above the sections: it is the preview's own
// device switch, so what's edited is what's shown.
export function DeviceBar({ device, setDevice }: { device: Device; setDevice: (device: Device) => void }) {
  const mobile = device === "mobile";
  return (
    <div className={styles.deviceBar}>
      <span className={styles.deviceBarText}>
        <span className={styles.deviceBarTitle}>Editing sizes for {mobile ? "phones" : "desktop"}</span>
        <span className={styles.hint}>
          {mobile ? "Phones get their own sizes. Auto scales your desktop sizes down." : "Switch to Mobile to set phone sizes separately."}
        </span>
      </span>
      <Segmented
        label="Screen size"
        hideLabel
        value={device}
        onChange={setDevice}
        options={[
          { value: "desktop" as const, label: "Desktop", icon: ICON_DESKTOP },
          { value: "mobile" as const, label: "Mobile", icon: ICON_MOBILE },
        ]}
      />
    </div>
  );
}

// Eyebrow, heading, subheading and their alignment.
export function HeaderControls({
  style,
  setStyle,
  align,
}: {
  style: WidgetStyleConfig;
  setStyle: (patch: Partial<WidgetStyleConfig>) => void;
  align: "start" | "center";
}) {
  return (
    <>
      <TextInput label="Eyebrow" value={style.eyebrow ?? ""} placeholder="e.g. Shoppable reels" onChange={(eyebrow) => setStyle({ eyebrow })} />
      <TextInput label="Heading" value={style.heading ?? ""} placeholder="No heading" onChange={(heading) => setStyle({ heading })} />
      <TextInput
        label="Subheading"
        value={style.subheading ?? ""}
        placeholder="e.g. Tap any reel to watch, then shop the pieces in it."
        maxLength={160}
        onChange={(subheading) => setStyle({ subheading })}
      />
      <Segmented
        label="Alignment"
        value={align}
        onChange={(headerAlign) => setStyle({ headerAlign })}
        options={[
          { value: "start", label: "Left" },
          { value: "center", label: "Center" },
        ]}
        hint="Leave a field empty to hide it. You can also edit this text, and add a “View all” link, in the theme editor."
      />
    </>
  );
}

export const DESIGN_ICONS = { cards: ICON_CARDS, header: ICON_HEADER, layout: ICON_LAYOUT, colors: ICON_COLORS };

export function ShowcaseDesignTab({
  meta,
  style,
  setStyle,
  brand,
  device,
  setDevice,
  onFocusArea,
}: {
  meta: WidgetKindMeta;
  style: WidgetStyleConfig;
  setStyle: (patch: Partial<WidgetStyleConfig>) => void;
  brand: BrandConfig;
  device: Device;
  setDevice: (device: Device) => void;
  onFocusArea: (area: PreviewHighlight | null) => void;
}) {
  const has = (key: StyleFieldKey) => meta.fields.includes(key);
  const [open, setOpen] = useState<DesignArea | null>("cards");
  const toggle = (area: DesignArea) => {
    const next = open === area ? null : area;
    setOpen(next);
    onFocusArea(next ? AREA_HIGHLIGHT[next] : null);
  };
  const mobile = device === "mobile";
  const isCarousel = meta.kind === "CAROUSEL";
  const template = style.cardTemplate ?? "title";
  const layout = style.layoutMode ?? (isCarousel ? "stack" : "carousel");
  const align = style.headerAlign ?? (isCarousel ? "center" : "start");

  const sizeSlider = sizeSliderFor(style, setStyle, device);
  const fieldsIn = (group: SizingField["group"]) => SIZING_FIELDS.filter((f) => f.group === group && has(f.key));
  const applyLook = (look: Look) => {
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(look.style)) {
      if (has(key as StyleFieldKey)) patch[key] = value;
    }
    setStyle(patch as Partial<WidgetStyleConfig>);
  };
  const resetAllSizes = () =>
    setStyle(
      Object.fromEntries(
        ["triggerSize", "triggerSizeMobile", "columnsMobile", ...SIZING_FIELDS.flatMap((f) => [f.key, f.mobileKey])].map((k) => [k, undefined]),
      ) as Partial<WidgetStyleConfig>,
    );

  // Cards per row (slider, filmstrip, grid): card sizes are worked out from
  // the page width on the storefront. Phones can show half a card more in
  // a scrolling row; a grid needs whole columns.
  const perRowOptions = mobile ? (layout === "grid" ? [1, 2, 3] : [1, 1.5, 2, 2.5, 3]) : [2, 3, 4, 5, 6];
  const storedPerRow = mobile ? (style.columnsMobile ?? 2) : (style.columns ?? 4);
  const perRow = perRowOptions.includes(storedPerRow) ? storedPerRow : Math.floor(storedPerRow);
  const perRowLabel = perRow % 1 ? `${Math.floor(perRow)}½ cards` : `${perRow} card${perRow === 1 ? "" : "s"}`;
  // The stack has no rows: a card size instead, Auto = responsive default.
  const storedStack = mobile ? style.triggerSizeMobile : style.triggerSize;
  const stackSize: StackSize =
    storedStack === undefined
      ? "auto"
      : (Object.entries(STACK_SIZES[mobile ? "mobile" : "desktop"]).reduce(
          (best, [name, px]) => (Math.abs(px - storedStack) < Math.abs(STACK_SIZES[mobile ? "mobile" : "desktop"][best] - storedStack) ? (name as Exclude<StackSize, "auto">) : best),
          "medium" as Exclude<StackSize, "auto">,
        ) as StackSize);

  const templateLabel = CARD_TEMPLATE_OPTIONS.find((t) => t.value === template)?.label ?? "";
  const cardsSummary = [
    templateLabel,
    CORNER_LABEL[style.cornerStyle ?? "rounded"],
    style.showCardBadge ? "Discount badge" : null,
    style.showPlayIcon === false ? "No play button" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const headerSummary = [style.eyebrow, style.heading, style.subheading].filter(Boolean).join(" · ") || "No header";
  const layoutName = layout === "carousel" && !isCarousel ? "Filmstrip" : LAYOUT_LABEL[layout];
  const layoutSummary =
    layout === "stack"
      ? `${layoutName} · ${stackSize === "auto" ? "Auto size" : `${stackSize[0].toUpperCase()}${stackSize.slice(1)} cards`}`
      : `${layoutName} · ${style.columns ?? 4} per row · ${style.columnsMobile ?? 2} on phones`;
  const colorsSummary = style.backgroundColor ? `Background ${style.backgroundColor}` : "Theme background";

  return (
    <div className={styles.designStack}>
      <Card title="Quick start" description="Apply a ready-made look, then fine-tune any section below.">
        <div className={styles.looks}>
          {LOOKS.map((look) => (
            <button key={look.name} type="button" className={styles.look} onClick={() => applyLook(look)}>
              <span className={styles.lookSwatch} style={{ background: look.swatch.bg }}>
                <span className={styles.lookPill} style={{ background: look.swatch.pill, borderRadius: look.swatch.radius }} />
              </span>
              <span className={styles.lookName}>{look.name}</span>
            </button>
          ))}
        </div>
      </Card>

      <DeviceBar device={device} setDevice={setDevice} />

      <Section title="Card design" icon={ICON_CARDS} summary={cardsSummary} open={open === "cards"} onToggle={() => toggle("cards")}>
        <Field label="Template">
          <div /* eslint-disable-line jsx-a11y/interactive-supports-focus -- roving tabindex: the chosen child is the tab stop */
            className={styles.templates}
            role="radiogroup"
            aria-label="Card template"
            onKeyDown={(e) =>
              handleRovingKeys(
                e,
                CARD_TEMPLATE_OPTIONS.map((t) => t.value),
                template,
                (cardTemplate) => setStyle({ cardTemplate }),
              )
            }
          >
            {CARD_TEMPLATE_OPTIONS.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={template === t.value}
                tabIndex={template === t.value ? 0 : -1}
                className={styles.template}
                onClick={() => setStyle({ cardTemplate: t.value })}
              >
                <TemplateSchematic template={t.value} />
                <span className={styles.lookName}>{t.label}</span>
              </button>
            ))}
          </div>
        </Field>
        <Segmented
          label="Corners"
          value={style.cornerStyle ?? "rounded"}
          onChange={(cornerStyle) => setStyle({ cornerStyle })}
          options={[
            { value: "sharp", label: "Square" },
            { value: "rounded", label: "Rounded" },
            { value: "soft", label: "Soft" },
          ]}
        />
        <Segmented
          label="Shadow"
          value={style.shadowPreset ?? "none"}
          onChange={(shadowPreset) => setStyle({ shadowPreset })}
          options={[
            { value: "none", label: "None" },
            { value: "soft", label: "Subtle" },
            { value: "bold", label: "Lifted" },
          ]}
        />
        <p className={styles.groupLabel}>On each card</p>
        <Toggle label="Play button" checked={style.showPlayIcon ?? true} onChange={(showPlayIcon) => setStyle({ showPlayIcon })} />
        <Toggle
          label="Discount badge"
          description="A “58% OFF” ribbon when the card's product has a compare-at price."
          checked={style.showCardBadge ?? false}
          onChange={(showCardBadge) => setStyle({ showCardBadge })}
        />
        {style.showCardBadge && (
          <ColorInput
            label="Badge color"
            value={style.badgeColor ?? ""}
            allowEmpty
            emptyLabel="Sale color"
            fallback="#c8102e"
            onChange={(badgeColor) => setStyle({ badgeColor })}
          />
        )}
        <Toggle label="Video length" checked={style.showDuration ?? true} onChange={(showDuration) => setStyle({ showDuration })} />
        {template === "title" && (
          <Toggle label="Video titles" checked={style.showCaption ?? true} onChange={(showCaption) => setStyle({ showCaption })} />
        )}
        {template === "title" && has("showProductPreview") && (
          <Toggle
            label="Featured product"
            description="The first tagged product, under each video."
            checked={style.showProductPreview ?? true}
            onChange={(showProductPreview) => setStyle({ showProductPreview })}
          />
        )}
        {fieldsIn("cards").map(sizeSlider)}
      </Section>

      <Section title="Header" icon={ICON_HEADER} summary={headerSummary} open={open === "header"} onToggle={() => toggle("header")}>
        <HeaderControls style={style} setStyle={setStyle} align={align} />
        {fieldsIn("header").map(sizeSlider)}
      </Section>

      <Section title="Layout & spacing" icon={ICON_LAYOUT} summary={layoutSummary} open={open === "layout"} onToggle={() => toggle("layout")}>
        <Segmented
          label="Arrangement"
          value={layout}
          onChange={(layoutMode) => setStyle({ layoutMode })}
          options={[
            ...(isCarousel ? [{ value: "stack" as const, label: "Stack", icon: ICON_STACK }] : []),
            { value: "carousel" as const, label: isCarousel ? "Slider" : "Filmstrip", icon: ICON_FILMSTRIP },
            { value: "grid" as const, label: "Grid", icon: ICON_GRID },
          ]}
        />
        {isCarousel && layout === "stack" && <p className={styles.hint}>The stack needs 3 or more videos; with fewer it shows as a slider.</p>}
        {layout === "stack" ? (
          <Segmented
            key={`stack-size-${device}`}
            label={mobile ? "Card size on phones" : "Card size"}
            value={stackSize}
            onChange={(size) => {
              const px = size === "auto" ? undefined : STACK_SIZES[mobile ? "mobile" : "desktop"][size];
              setStyle(mobile ? { triggerSizeMobile: px } : { triggerSize: px });
            }}
            options={[
              { value: "auto", label: "Auto" },
              { value: "small", label: "Small" },
              { value: "medium", label: "Medium" },
              { value: "large", label: "Large" },
            ]}
            hint="Auto sizes the front card to the screen."
          />
        ) : (
          <Segmented
            key={`per-row-${device}-${layout}`}
            label={mobile ? "Cards per row on phones" : "Cards per row"}
            value={String(perRow)}
            onChange={(value) => setStyle(mobile ? { columnsMobile: Number(value) } : { columns: Number(value) })}
            options={perRowOptions.map((n) => ({ value: String(n), label: n % 1 ? `${Math.floor(n)}½` : String(n) }))}
            hint={
              layout === "grid"
                ? "Cards are sized to fill the row, however wide your page is."
                : `Cards are sized to fit ${perRowLabel} across your page${perRow % 1 ? ", the half card hinting there's more to swipe" : ""}.`
            }
          />
        )}
        {fieldsIn("spacing").map(sizeSlider)}
        <button type="button" className={styles.linkButton} onClick={resetAllSizes}>
          Reset all sizes to automatic
        </button>
      </Section>

      <Section title="Colors" icon={ICON_COLORS} summary={colorsSummary} open={open === "colors"} onToggle={() => toggle("colors")}>
        <ColorInput
          label={meta.accentLabel}
          value={style.accentColor ?? ""}
          allowEmpty={meta.defaults.accentColor === ""}
          emptyLabel="Brand"
          fallback={brand.accentColor}
          onChange={(accentColor) => setStyle({ accentColor })}
        />
        <ColorInput
          label="Background"
          allowEmpty
          fallback="#f4f4f4"
          value={style.backgroundColor ?? ""}
          onChange={(backgroundColor) => setStyle({ backgroundColor })}
        />
        <ColorInput label="Text" allowEmpty fallback="#141414" value={style.textColor ?? ""} onChange={(textColor) => setStyle({ textColor })} />
      </Section>
    </div>
  );
}
