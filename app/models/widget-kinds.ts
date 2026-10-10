// Client-safe widget registry: the types, per-kind metadata, style defaults
// and the style sanitizer. Lives apart from widget.server.ts (which imports
// Prisma) so the admin editor and its live preview can import the exact same
// defaults the server persists — one source of truth instead of the old
// per-component default literals that drifted from what Liquid assumed.

export type WidgetKind =
  | "PRODUCT_PAGE_REELS"
  | "CAROUSEL"
  | "GRID"
  | "STORIES"
  | "REEL_POPS"
  | "SINGLE_VIDEO"
  | "ADD_TO_CART_VIDEO";

// Every appearance/behavior field across all storefront widgets, merged into
// one bag. Each kind only shows/reads the subset relevant to it (see
// WIDGET_KIND_META[kind].fields); storing them in one shape means the
// metafield sync and the Liquid read side never need a per-kind type.
export interface WidgetStyleConfig {
  heading?: string;
  watchLabel?: string;
  bubbleLabel?: string;
  accentColor?: string;
  accentSecondaryColor?: string;
  triggerSize?: number;
  cornerStyle?: "sharp" | "rounded" | "soft";
  ctaColor?: string;
  ctaTextColor?: string;
  ctaLabel?: string;
  showPrice?: boolean;
  showTitleOverlay?: boolean;
  mutedDefault?: boolean;
  loop?: boolean;
  storyDuration?: number;
  position?: "bottom_right" | "bottom_left" | "top_right" | "top_left";
  showPulse?: boolean;
  // Theming
  backgroundColor?: string;
  textColor?: string;
  shadowPreset?: "none" | "soft" | "bold";
  // Layout
  layoutMode?: "carousel" | "grid" | "stack";
  columns?: number;
  playTrigger?: "click" | "hover";
  autoplayOnScroll?: boolean;
  // Per-kind presentation
  ringStyle?: "gradient" | "solid";
  popShape?: "circle" | "portrait";
  singleLayout?: "split" | "poster";
  showDuration?: boolean;
  showCaption?: boolean;
  showProductPreview?: boolean;
  popDelay?: number;
  // Viewer
  showQuantity?: boolean;
  showShare?: boolean;
  showRecommendations?: boolean;
  // CTA / product UI
  ctaStyle?: "pill" | "square" | "text-link";
  showProductImage?: boolean;
  tagRevealMode?: "always" | "tap";
}

export type StyleFieldKey = keyof WidgetStyleConfig;

export type TargetRule =
  | { type: "all_products" }
  | { type: "handles"; handles: string[] }
  | { type: "collections"; handles: string[] };

export interface WidgetConfig {
  templateStyle: string;
  targetRule: TargetRule;
  // Display concern, not a style sub-field, so it survives independent of
  // the style form's merge-on-save (see updateWidgetStyle).
  deviceVisibility?: "all" | "desktop" | "mobile";
  // Which page templates this widget is allowed to render on, matched
  // against Liquid's `template.name` (e.g. "index", "product", "collection",
  // "list-collections", "page", "article", "cart", "search"). Empty/unset
  // means no restriction.
  pageTypes?: string[];
  featuredReelId?: string;
  reelIds?: string[];
  style?: WidgetStyleConfig;
}

export type ReelSelection = "single" | "list";

export interface WidgetKindMeta {
  kind: WidgetKind;
  name: string;
  description: string;
  // Where the merchant places it in the theme editor — shown in the editor
  // so "published but not visible" has an obvious next step.
  placement: string;
  icon: "layout-rows-2" | "play-circle" | "layout-columns-3" | "images" | "layout-popup" | "cart";
  reelSelection: ReelSelection;
  fields: StyleFieldKey[];
  defaults: WidgetStyleConfig;
  sizeLabel: string;
  sizeMin: number;
  sizeMax: number;
  accentLabel: string;
}

const PRODUCT_TAG_DEFAULTS: WidgetStyleConfig = {
  // "" = inherit the shop's brand kit (Settings).
  ctaColor: "",
  ctaTextColor: "",
  ctaStyle: "pill",
  ctaLabel: "",
  showPrice: true,
  showTitleOverlay: true,
  showProductImage: true,
  tagRevealMode: "always",
  loop: false,
  showQuantity: false,
  showShare: true,
  showRecommendations: true,
};

const PRODUCT_TAG_FIELDS: StyleFieldKey[] = [
  "ctaColor",
  "ctaTextColor",
  "ctaStyle",
  "ctaLabel",
  "showPrice",
  "showTitleOverlay",
  "showProductImage",
  "tagRevealMode",
  "mutedDefault",
  "loop",
  "showQuantity",
  "showShare",
  "showRecommendations",
];

export const WIDGET_KIND_META: Record<Exclude<WidgetKind, "GRID">, WidgetKindMeta> = {
  PRODUCT_PAGE_REELS: {
    kind: "PRODUCT_PAGE_REELS",
    name: "Product page reels",
    description: "A filmstrip of short clips with the featured product under each.",
    placement: "Product page section",
    icon: "layout-rows-2",
    reelSelection: "list",
    fields: [
      "heading",
      "layoutMode",
      "columns",
      "triggerSize",
      "cornerStyle",
      "shadowPreset",
      "accentColor",
      "backgroundColor",
      "textColor",
      "showCaption",
      "showDuration",
      "showProductPreview",
      "playTrigger",
      "autoplayOnScroll",
      ...PRODUCT_TAG_FIELDS,
    ],
    defaults: {
      ...PRODUCT_TAG_DEFAULTS,
      heading: "See it in action",
      layoutMode: "carousel",
      columns: 4,
      triggerSize: 200,
      cornerStyle: "rounded",
      shadowPreset: "none",
      accentColor: "",
      backgroundColor: "",
      textColor: "",
      showCaption: true,
      showDuration: true,
      showProductPreview: true,
      playTrigger: "click",
      autoplayOnScroll: true,
      mutedDefault: true,
    },
    sizeLabel: "Card width",
    sizeMin: 140,
    sizeMax: 300,
    accentLabel: "Play button",
  },
  CAROUSEL: {
    kind: "CAROUSEL",
    name: "Stacked carousel",
    description: "A fanned deck of videos — the centre card plays the lead role.",
    placement: "Any page section",
    icon: "layout-columns-3",
    reelSelection: "list",
    fields: [
      "heading",
      "layoutMode",
      "columns",
      "cornerStyle",
      "shadowPreset",
      "accentColor",
      "backgroundColor",
      "textColor",
      "showCaption",
      "showDuration",
      "autoplayOnScroll",
      ...PRODUCT_TAG_FIELDS,
    ],
    defaults: {
      ...PRODUCT_TAG_DEFAULTS,
      heading: "Shop the looks",
      layoutMode: "stack",
      columns: 4,
      cornerStyle: "soft",
      shadowPreset: "bold",
      accentColor: "",
      backgroundColor: "",
      textColor: "",
      showCaption: true,
      showDuration: false,
      autoplayOnScroll: true,
      mutedDefault: true,
    },
    sizeLabel: "",
    sizeMin: 0,
    sizeMax: 0,
    accentLabel: "Arrows and dots",
  },
  STORIES: {
    kind: "STORIES",
    name: "Stories",
    description: "Ringed avatars that open a full-screen, auto-advancing story viewer.",
    placement: "Any page section",
    icon: "images",
    reelSelection: "list",
    fields: [
      "heading",
      "triggerSize",
      "ringStyle",
      "accentColor",
      "accentSecondaryColor",
      "textColor",
      "showCaption",
      "storyDuration",
      ...PRODUCT_TAG_FIELDS.filter((f) => f !== "tagRevealMode"),
    ],
    defaults: {
      ...PRODUCT_TAG_DEFAULTS,
      heading: "",
      triggerSize: 72,
      ringStyle: "gradient",
      accentColor: "#f58529",
      accentSecondaryColor: "#c13584",
      textColor: "",
      showCaption: true,
      storyDuration: 15,
      mutedDefault: true,
    },
    sizeLabel: "Avatar size",
    sizeMin: 48,
    sizeMax: 120,
    accentLabel: "Ring start",
  },
  SINGLE_VIDEO: {
    kind: "SINGLE_VIDEO",
    name: "Featured video",
    description: "One hero video with its products listed beside it, ready to add to cart.",
    placement: "Any page section",
    icon: "play-circle",
    reelSelection: "single",
    fields: [
      "heading",
      "singleLayout",
      "triggerSize",
      "cornerStyle",
      "shadowPreset",
      "accentColor",
      "backgroundColor",
      "textColor",
      "showDuration",
      "playTrigger",
      "autoplayOnScroll",
      ...PRODUCT_TAG_FIELDS,
    ],
    defaults: {
      ...PRODUCT_TAG_DEFAULTS,
      autoplayOnScroll: true,
      heading: "Shop the video",
      singleLayout: "split",
      triggerSize: 340,
      cornerStyle: "rounded",
      shadowPreset: "soft",
      accentColor: "",
      backgroundColor: "",
      textColor: "",
      showDuration: true,
      playTrigger: "click",
      mutedDefault: false,
    },
    sizeLabel: "Video width",
    sizeMin: 240,
    sizeMax: 480,
    accentLabel: "Play button",
  },
  REEL_POPS: {
    kind: "REEL_POPS",
    name: "Floating video",
    description: "A small floating player that follows shoppers around the store.",
    placement: "App embed (Theme settings › App embeds)",
    icon: "layout-popup",
    reelSelection: "single",
    fields: [
      "popShape",
      "position",
      "triggerSize",
      "bubbleLabel",
      "accentColor",
      "showPulse",
      "popDelay",
      ...PRODUCT_TAG_FIELDS.filter((f) => f !== "tagRevealMode"),
    ],
    defaults: {
      ...PRODUCT_TAG_DEFAULTS,
      popShape: "portrait",
      position: "bottom_right",
      triggerSize: 96,
      bubbleLabel: "Watch & shop",
      accentColor: "#ffffff",
      showPulse: true,
      popDelay: 2,
      mutedDefault: false,
    },
    sizeLabel: "Player size",
    sizeMin: 56,
    sizeMax: 160,
    accentLabel: "Border",
  },
  ADD_TO_CART_VIDEO: {
    kind: "ADD_TO_CART_VIDEO",
    name: "Add-to-cart video",
    description: "A compact video row that sits right under the add-to-cart button.",
    placement: "Product information section, below Buy buttons",
    icon: "cart",
    reelSelection: "single",
    fields: [
      "watchLabel",
      "triggerSize",
      "cornerStyle",
      "accentColor",
      "backgroundColor",
      "textColor",
      "showDuration",
      "playTrigger",
      ...PRODUCT_TAG_FIELDS,
    ],
    defaults: {
      ...PRODUCT_TAG_DEFAULTS,
      watchLabel: "See it in action",
      triggerSize: 56,
      cornerStyle: "rounded",
      accentColor: "",
      backgroundColor: "",
      textColor: "",
      showDuration: true,
      playTrigger: "click",
      mutedDefault: false,
    },
    sizeLabel: "Thumbnail size",
    sizeMin: 40,
    sizeMax: 96,
    accentLabel: "Play icon",
  },
};

export const WIDGET_KIND_ORDER: Exclude<WidgetKind, "GRID">[] = [
  "PRODUCT_PAGE_REELS",
  "CAROUSEL",
  "STORIES",
  "SINGLE_VIDEO",
  "REEL_POPS",
  "ADD_TO_CART_VIDEO",
];

export function getKindMeta(kind: string): WidgetKindMeta | undefined {
  return (WIDGET_KIND_META as Record<string, WidgetKindMeta>)[kind];
}

// Stored style merged over the kind's defaults — what the editor starts from
// and what the preview renders. Unset fields fall back to defaults; fields
// a merchant explicitly cleared (empty string) stay cleared.
export function resolveStyle(kind: string, style: WidgetStyleConfig | undefined): WidgetStyleConfig {
  const meta = getKindMeta(kind);
  const resolved: WidgetStyleConfig = { ...(meta?.defaults ?? {}) };
  for (const [key, value] of Object.entries(style ?? {})) {
    if (value !== undefined && value !== null) {
      (resolved as Record<string, unknown>)[key] = value;
    }
  }
  return resolved;
}

const ENUMS: Partial<Record<StyleFieldKey, readonly string[]>> = {
  cornerStyle: ["sharp", "rounded", "soft"],
  position: ["bottom_right", "bottom_left", "top_right", "top_left"],
  shadowPreset: ["none", "soft", "bold"],
  layoutMode: ["carousel", "grid", "stack"],
  playTrigger: ["click", "hover"],
  ringStyle: ["gradient", "solid"],
  popShape: ["circle", "portrait"],
  singleLayout: ["split", "poster"],
  ctaStyle: ["pill", "square", "text-link"],
  tagRevealMode: ["always", "tap"],
};

const COLORS: StyleFieldKey[] = [
  "accentColor",
  "accentSecondaryColor",
  "ctaColor",
  "ctaTextColor",
  "backgroundColor",
  "textColor",
];

const TEXTS: StyleFieldKey[] = ["heading", "watchLabel", "bubbleLabel", "ctaLabel"];

const BOOLS: StyleFieldKey[] = [
  "showPrice",
  "showTitleOverlay",
  "mutedDefault",
  "loop",
  "showPulse",
  "autoplayOnScroll",
  "showDuration",
  "showCaption",
  "showProductPreview",
  "showProductImage",
  "showQuantity",
  "showShare",
  "showRecommendations",
];

const NUMBER_RANGES: Partial<Record<StyleFieldKey, [number, number]>> = {
  columns: [2, 6],
  storyDuration: [3, 60],
  popDelay: [0, 60],
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Whitelists and clamps an untrusted style payload (it arrives as JSON from
// the editor) against the kind's own field list. Values outside a field's
// allowed set are dropped rather than coerced, so a bad value falls back to
// the kind default instead of rendering something odd on the storefront.
export function sanitizeStyle(kind: string, input: unknown): WidgetStyleConfig {
  const meta = getKindMeta(kind);
  if (!meta || typeof input !== "object" || input === null) return {};
  const raw = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of meta.fields) {
    const value = raw[key];
    if (value === undefined || value === null) continue;

    if (COLORS.includes(key)) {
      if (value === "") out[key] = "";
      else if (typeof value === "string" && HEX_COLOR.test(value)) out[key] = value.toLowerCase();
    } else if (TEXTS.includes(key)) {
      if (typeof value === "string") out[key] = value.trim().slice(0, 80);
    } else if (BOOLS.includes(key)) {
      if (typeof value === "boolean") out[key] = value;
    } else if (ENUMS[key]) {
      // The stacked deck only exists for the carousel widget.
      const stackElsewhere = key === "layoutMode" && value === "stack" && kind !== "CAROUSEL";
      if (typeof value === "string" && ENUMS[key]!.includes(value) && !stackElsewhere) out[key] = value;
    } else if (key === "triggerSize") {
      const n = Number(value);
      if (Number.isFinite(n)) out[key] = Math.round(Math.min(Math.max(n, meta.sizeMin), meta.sizeMax));
    } else if (NUMBER_RANGES[key]) {
      const n = Number(value);
      const [min, max] = NUMBER_RANGES[key]!;
      if (Number.isFinite(n)) out[key] = Math.round(Math.min(Math.max(n, min), max));
    }
  }

  return out as WidgetStyleConfig;
}

// Matched against Liquid's `template.name`. Empty selection = all pages.
export const PAGE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "index", label: "Home" },
  { value: "product", label: "Products" },
  { value: "collection", label: "Collections" },
  { value: "list-collections", label: "Collection list" },
  { value: "page", label: "Pages" },
  { value: "article", label: "Blog posts" },
  { value: "cart", label: "Cart" },
  { value: "search", label: "Search" },
];
