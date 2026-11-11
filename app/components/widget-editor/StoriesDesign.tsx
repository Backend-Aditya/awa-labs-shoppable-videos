// Design tab for the Stories widget, laid out like the carousel's: one
// collapsible section per part (the stories themselves, header, layout and
// spacing, colors), sizes following the desktop/mobile switch.
import { useState } from "react";
import { SIZING_FIELDS } from "../../models/widget-kinds";
import type { SizingField, WidgetKindMeta, WidgetStyleConfig } from "../../models/widget-kinds";
import type { Device, PreviewHighlight } from "./WidgetPreview";
import { ColorInput, Section, Segmented, Slider, Toggle } from "./controls";
import { DESIGN_ICONS, DeviceBar, HeaderControls, sizeSliderFor } from "./ShowcaseDesign";
import styles from "./editor.module.css";

type StoriesArea = "stories" | "header" | "layout" | "colors";
const AREA_HIGHLIGHT: Record<StoriesArea, PreviewHighlight> = {
  stories: "cards",
  header: "header",
  layout: "layout",
  colors: "section",
};

const SHAPE_LABEL = { circle: "Circles", rounded: "Rounded squares", portrait: "Tall cards" } as const;
const RING_LABEL = { gradient: "Gradient ring", solid: "Solid ring", none: "No ring" } as const;

const ICON_CIRCLE = (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
    <circle cx="11" cy="11" r="9" fill="currentColor" />
  </svg>
);
const ICON_ROUNDED = (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
    <rect x="2" y="2" width="18" height="18" rx="5" fill="currentColor" />
  </svg>
);
const ICON_PORTRAIT = (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
    <rect x="5" y="1" width="12" height="20" rx="3" fill="currentColor" />
  </svg>
);

// The labels' text size: the shared "card text" size, named for stories.
const NAME_SIZE: SizingField = { ...SIZING_FIELDS.find((f) => f.key === "cardTextSize")!, label: "Name size" };
const SPACING: SizingField[] = SIZING_FIELDS.filter((f) => f.group === "spacing").map((f) =>
  f.key === "cardGap" ? { ...f, label: "Space between stories" } : f,
);
const HEADER_SIZES = SIZING_FIELDS.filter((f) => f.group === "header");

export function StoriesDesignTab({
  meta,
  style,
  setStyle,
  device,
  setDevice,
  onFocusArea,
}: {
  meta: WidgetKindMeta;
  style: WidgetStyleConfig;
  setStyle: (patch: Partial<WidgetStyleConfig>) => void;
  device: Device;
  setDevice: (device: Device) => void;
  onFocusArea: (area: PreviewHighlight | null) => void;
}) {
  const [open, setOpen] = useState<StoriesArea | null>("stories");
  const toggle = (area: StoriesArea) => {
    const next = open === area ? null : area;
    setOpen(next);
    onFocusArea(next ? AREA_HIGHLIGHT[next] : null);
  };
  const mobile = device === "mobile";
  const shape = style.storyShape ?? "circle";
  const ring = style.ringStyle ?? "gradient";
  const align = style.headerAlign ?? "start";
  const showNames = style.showCaption ?? true;
  const sizeSlider = sizeSliderFor(style, setStyle, device);

  const desktopSize = style.triggerSize ?? (meta.defaults.triggerSize as number);
  const resetAllSizes = () =>
    setStyle(
      Object.fromEntries(
        ["triggerSizeMobile", ...[NAME_SIZE, ...SPACING, ...HEADER_SIZES].flatMap((f) => [f.key, f.mobileKey])].map((k) => [k, undefined]),
      ) as Partial<WidgetStyleConfig>,
    );

  const storiesSummary = [SHAPE_LABEL[shape], RING_LABEL[ring], showNames ? "Names" : "No names"].join(" · ");
  const headerSummary = [style.eyebrow, style.heading, style.subheading].filter(Boolean).join(" · ") || "No header";
  const layoutSummary = `${align === "center" ? "Centered" : "Left aligned"} · ${desktopSize}px${style.triggerSizeMobile ? ` · ${style.triggerSizeMobile}px on phones` : ""}`;
  const colorsSummary = style.backgroundColor ? `Background ${style.backgroundColor}` : "Theme background";

  return (
    <div className={styles.designStack}>
      <DeviceBar device={device} setDevice={setDevice} />

      <Section title="Stories" icon={DESIGN_ICONS.cards} summary={storiesSummary} open={open === "stories"} onToggle={() => toggle("stories")}>
        <Segmented
          label="Shape"
          value={shape}
          onChange={(storyShape) => setStyle({ storyShape })}
          options={[
            { value: "circle", label: "Circle", icon: ICON_CIRCLE },
            { value: "rounded", label: "Rounded", icon: ICON_ROUNDED },
            { value: "portrait", label: "Tall card", icon: ICON_PORTRAIT },
          ]}
        />
        <Segmented
          label="Ring"
          value={ring}
          onChange={(ringStyle) => setStyle({ ringStyle })}
          options={[
            { value: "gradient", label: "Gradient" },
            { value: "solid", label: "Solid" },
            { value: "none", label: "None" },
          ]}
          hint={ring === "none" ? undefined : "Rings of stories a shopper has watched turn grey."}
        />
        <Slider
          key={`story-size-${device}`}
          label={shape === "portrait" ? "Card width" : "Story size"}
          unit="px"
          min={meta.sizeMin}
          max={meta.sizeMax}
          value={mobile ? (style.triggerSizeMobile ?? Math.min(desktopSize, meta.sizeMax)) : desktopSize}
          auto={mobile && style.triggerSizeMobile === undefined}
          onReset={mobile ? () => setStyle({ triggerSizeMobile: undefined }) : undefined}
          onChange={(value) => setStyle(mobile ? { triggerSizeMobile: value } : { triggerSize: value })}
        />
        <Toggle label="Names under stories" checked={showNames} onChange={(showCaption) => setStyle({ showCaption })} />
        {showNames && sizeSlider(NAME_SIZE)}
      </Section>

      <Section title="Header" icon={DESIGN_ICONS.header} summary={headerSummary} open={open === "header"} onToggle={() => toggle("header")}>
        <HeaderControls style={style} setStyle={setStyle} align={align} />
        <p className={styles.hint}>The stories row lines up with the header.</p>
        {HEADER_SIZES.map(sizeSlider)}
      </Section>

      <Section title="Layout & spacing" icon={DESIGN_ICONS.layout} summary={layoutSummary} open={open === "layout"} onToggle={() => toggle("layout")}>
        {SPACING.map(sizeSlider)}
        <button type="button" className={styles.linkButton} onClick={resetAllSizes}>
          Reset all sizes to automatic
        </button>
      </Section>

      <Section title="Colors" icon={DESIGN_ICONS.colors} summary={colorsSummary} open={open === "colors"} onToggle={() => toggle("colors")}>
        {ring !== "none" && (
          <ColorInput label={ring === "solid" ? "Ring" : "Ring start"} value={style.accentColor ?? ""} fallback="#f58529" onChange={(accentColor) => setStyle({ accentColor })} />
        )}
        {ring === "gradient" && (
          <ColorInput label="Ring end" value={style.accentSecondaryColor ?? ""} fallback="#c13584" onChange={(accentSecondaryColor) => setStyle({ accentSecondaryColor })} />
        )}
        <ColorInput label="Background" allowEmpty fallback="#f4f4f4" value={style.backgroundColor ?? ""} onChange={(backgroundColor) => setStyle({ backgroundColor })} />
        <ColorInput label="Text" allowEmpty fallback="#141414" value={style.textColor ?? ""} onChange={(textColor) => setStyle({ textColor })} />
      </Section>
    </div>
  );
}
