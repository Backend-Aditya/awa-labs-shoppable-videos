// Client-safe widget registry: the types, per-kind metadata, style defaults
// and the style sanitizer. Lives apart from widget.server.ts (which imports
// Prisma) so the admin editor and its live preview can import the exact same
// defaults the server persists, one source of truth instead of the old
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
  ringStyle?: "gradient" | "solid" | "none";
  // Stories: round avatars, rounded squares, or tall story cards.
  storyShape?: "circle" | "rounded" | "portrait";
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
  // A "−20%" badge on products with a compare-at price.
  showSaleBadge?: boolean;
  // What a successful add to cart leads to: keep watching, the cart (the
  // theme's drawer when it has one, else the cart page), or checkout.
  afterAdd?: "stay" | "cart" | "checkout";
  // Section header around the heading (stacked carousel).
  eyebrow?: string;
  subheading?: string;
  // How each carousel card presents its lead product: "title" is the
  // original look (video title over the poster); "overlay" puts the product
  // on a frosted bar over the video; classic/modern/vibrant put it under
  // the video with no button, an outline button or a filled one.
  cardTemplate?: "title" | "classic" | "modern" | "vibrant" | "overlay";
  showPlayIcon?: boolean;
  // A "58% OFF" ribbon on cards whose lead product has a compare-at price.
  showCardBadge?: boolean;
  badgeColor?: string;
  // Viewer: product rows with a thumbnail (compact) or a big image (large),
  // and whether tapping a product opens its full details inside the viewer.
  productImageSize?: "compact" | "large";
  productDetails?: boolean;
  showDescription?: boolean;
  // Video viewer navigation: arrows either side of the video (default) or
  // the stacked up/down pair.
  viewerNav?: "sides" | "stacked";
  // Popup corners: square panel and player, or the rounded originals.
  popupCorners?: "square" | "rounded";
  // Sizing and spacing (px). Unset = the storefront's built-in responsive
  // defaults, so existing widgets don't change until the merchant adjusts.
  eyebrowSize?: number;
  headingSize?: number;
  subheadingSize?: number;
  cardTextSize?: number;
  cardGap?: number;
  sectionPaddingY?: number;
  sectionPaddingX?: number;
  // Phones (under 750px) get their own value for each size/spacing; unset =
  // the storefront's built-in mobile scaling of the desktop value.
  eyebrowSizeMobile?: number;
  headingSizeMobile?: number;
  subheadingSizeMobile?: number;
  cardTextSizeMobile?: number;
  cardGapMobile?: number;
  sectionPaddingYMobile?: number;
  sectionPaddingXMobile?: number;
  triggerSizeMobile?: number;
  columnsMobile?: number;
  // Where the eyebrow, heading and subheading sit.
  headerAlign?: "start" | "center";
}

export type StyleFieldKey = keyof WidgetStyleConfig;

// What a targeting rule picked, for display and to re-open the resource
// picker with the current selection. Liquid only ever reads `handles`.
export interface TargetItem {
  id: string;
  handle: string;
  title: string;
}

export type TargetRule =
  | { type: "all_products" }
  | { type: "handles"; handles: string[]; items?: TargetItem[] }
  | { type: "collections"; handles: string[]; items?: TargetItem[] };

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
  // Where the merchant places it in the theme editor, shown in the editor
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
  loop: false,
  showQuantity: false,
  showShare: true,
  showRecommendations: true,
  // Off until the merchant chooses it, so existing storefronts don't change.
  showSaleBadge: false,
  afterAdd: "stay",
  viewerNav: "sides",
};

const PRODUCT_TAG_FIELDS: StyleFieldKey[] = [
  "ctaColor",
  "ctaTextColor",
  "ctaStyle",
  "ctaLabel",
  "showPrice",
  "showTitleOverlay",
  "showProductImage",
  "mutedDefault",
  "loop",
  "showQuantity",
  "showShare",
  "showRecommendations",
  "showSaleBadge",
  "afterAdd",
  "viewerNav",
];

// Everything the stacked carousel and the product page reels share beyond
// the basics: card templates, the section header, card badges, the popup's
// product layout/details, and desktop + mobile sizing and spacing.
const SHOWCASE_FIELDS: StyleFieldKey[] = [
  "eyebrow",
  "subheading",
  "headerAlign",
  "cardTemplate",
  "showPlayIcon",
  "showCardBadge",
  "badgeColor",
  "productImageSize",
  "productDetails",
  "showDescription",
  "popupCorners",
  "triggerSizeMobile",
  "columnsMobile",
  "eyebrowSize",
  "headingSize",
  "subheadingSize",
  "cardTextSize",
  "cardGap",
  "sectionPaddingY",
  "sectionPaddingX",
  "eyebrowSizeMobile",
  "headingSizeMobile",
  "subheadingSizeMobile",
  "cardTextSizeMobile",
  "cardGapMobile",
  "sectionPaddingYMobile",
  "sectionPaddingXMobile",
];

// The video player's product popup: tiles or rows, product details inside
// the video, description, corners. Shared by every widget that opens the
// video viewer with the new look.
const POPUP_FIELDS: StyleFieldKey[] = ["productImageSize", "productDetails", "showDescription", "popupCorners"];
const POPUP_DEFAULTS: WidgetStyleConfig = {
  productImageSize: "large",
  productDetails: true,
  showDescription: true,
  popupCorners: "square",
};

const STORIES_SECTION_FIELDS: StyleFieldKey[] = [
  "storyShape",
  "triggerSizeMobile",
  "backgroundColor",
  "eyebrow",
  "subheading",
  "headerAlign",
  "eyebrowSize",
  "headingSize",
  "subheadingSize",
  "cardTextSize",
  "cardGap",
  "sectionPaddingY",
  "sectionPaddingX",
  "eyebrowSizeMobile",
  "headingSizeMobile",
  "subheadingSizeMobile",
  "cardTextSizeMobile",
  "cardGapMobile",
  "sectionPaddingYMobile",
  "sectionPaddingXMobile",
];

const SHOWCASE_DEFAULTS: WidgetStyleConfig = {
  eyebrow: "",
  subheading: "",
  cardTemplate: "title",
  showPlayIcon: true,
  showCardBadge: false,
  badgeColor: "",
  productImageSize: "large",
  productDetails: true,
  showDescription: true,
  popupCorners: "square",
};

export const CARD_TEMPLATES: { value: NonNullable<WidgetStyleConfig["cardTemplate"]>; label: string }[] = [
  { value: "title", label: "Only video title" },
  { value: "classic", label: "Classic" },
  { value: "modern", label: "Modern" },
  { value: "vibrant", label: "Vibrant" },
  { value: "overlay", label: "Overlay" },
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
      ...SHOWCASE_FIELDS,
    ],
    defaults: {
      ...PRODUCT_TAG_DEFAULTS,
      ...SHOWCASE_DEFAULTS,
      headerAlign: "start",
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
    description: "A fanned deck of videos with the center card in the lead.",
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
      "triggerSize",
      ...PRODUCT_TAG_FIELDS,
      ...SHOWCASE_FIELDS,
    ],
    defaults: {
      ...PRODUCT_TAG_DEFAULTS,
      ...SHOWCASE_DEFAULTS,
      headerAlign: "center",
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
    sizeLabel: "Card width",
    sizeMin: 140,
    sizeMax: 340,
    accentLabel: "Accent (arrows, dots, eyebrow)",
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
      // The section around the row, like the carousel and product page
      // reels: header, shape and sizes per device, spacing, background.
      ...STORIES_SECTION_FIELDS,
      ...PRODUCT_TAG_FIELDS.filter((f) => f !== "viewerNav"),
    ],
    defaults: {
      ...PRODUCT_TAG_DEFAULTS,
      heading: "",
      eyebrow: "",
      subheading: "",
      headerAlign: "start",
      storyShape: "circle",
      backgroundColor: "",
      triggerSize: 72,
      ringStyle: "gradient",
      accentColor: "#f58529",
      accentSecondaryColor: "#c13584",
      textColor: "",
      showCaption: true,
      storyDuration: 15,
      mutedDefault: true,
    },
    sizeLabel: "Story size",
    sizeMin: 48,
    sizeMax: 160,
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
      ...POPUP_FIELDS,
    ],
    defaults: {
      ...PRODUCT_TAG_DEFAULTS,
      ...POPUP_DEFAULTS,
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
      // One video: no next/previous to style.
      ...PRODUCT_TAG_FIELDS.filter((f) => f !== "viewerNav"),
      // The same player inside as the carousel and product page reels.
      ...POPUP_FIELDS,
    ],
    defaults: {
      ...PRODUCT_TAG_DEFAULTS,
      ...POPUP_DEFAULTS,
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
      ...POPUP_FIELDS,
    ],
    defaults: {
      ...PRODUCT_TAG_DEFAULTS,
      ...POPUP_DEFAULTS,
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

// The storefront names each widget in its events (the Liquid blocks'
// `source`, sent as data-source); per-widget analytics are keyed by it.
export const SOURCE_KIND = {
  product_page_reels: "PRODUCT_PAGE_REELS",
  carousel: "CAROUSEL",
  stories: "STORIES",
  featured_video: "SINGLE_VIDEO",
  add_to_cart_video: "ADD_TO_CART_VIDEO",
  floating_video: "REEL_POPS",
} as const satisfies Record<string, WidgetKind>;

export type WidgetSource = keyof typeof SOURCE_KIND;

export const isWidgetSource = (value: unknown): value is WidgetSource =>
  typeof value === "string" && Object.hasOwn(SOURCE_KIND, value);

// Stored style merged over the kind's defaults, what the editor starts from
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
  ringStyle: ["gradient", "solid", "none"],
  storyShape: ["circle", "rounded", "portrait"],
  popShape: ["circle", "portrait"],
  singleLayout: ["split", "poster"],
  ctaStyle: ["pill", "square", "text-link"],
  tagRevealMode: ["always", "tap"],
  afterAdd: ["stay", "cart", "checkout"],
  viewerNav: ["sides", "stacked"],
  cardTemplate: ["title", "classic", "modern", "vibrant", "overlay"],
  productImageSize: ["compact", "large"],
  popupCorners: ["square", "rounded"],
  headerAlign: ["start", "center"],
};

const COLORS: StyleFieldKey[] = [
  "accentColor",
  "accentSecondaryColor",
  "ctaColor",
  "ctaTextColor",
  "backgroundColor",
  "textColor",
  "badgeColor",
];

const TEXTS: StyleFieldKey[] = ["heading", "watchLabel", "bubbleLabel", "ctaLabel", "eyebrow"];
// Longer free text: a one-sentence intro under the heading.
const LONG_TEXTS: StyleFieldKey[] = ["subheading"];

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
  "showSaleBadge",
  "showPlayIcon",
  "showCardBadge",
  "productDetails",
  "showDescription",
];

const NUMBER_RANGES: Partial<Record<StyleFieldKey, [number, number]>> = {
  columns: [2, 6],
  storyDuration: [3, 60],
  popDelay: [0, 30],
  eyebrowSize: [9, 20],
  headingSize: [14, 64],
  subheadingSize: [11, 28],
  cardTextSize: [10, 20],
  cardGap: [0, 48],
  sectionPaddingY: [0, 160],
  sectionPaddingX: [0, 120],
  eyebrowSizeMobile: [9, 20],
  headingSizeMobile: [14, 64],
  subheadingSizeMobile: [11, 28],
  cardTextSizeMobile: [10, 20],
  cardGapMobile: [0, 48],
  sectionPaddingYMobile: [0, 160],
  sectionPaddingXMobile: [0, 120],
  columnsMobile: [1, 3],
};

// Sizing/spacing sliders: label, range, the field holding the phone value,
// and what the slider shows while unset (the storefront's own defaults on
// desktop and on phones). `group` places it in the editor.
export interface SizingField {
  key: StyleFieldKey;
  mobileKey: StyleFieldKey;
  label: string;
  group: "header" | "cards" | "spacing";
  min: number;
  max: number;
  auto: number;
  autoMobile: number;
}
export const SIZING_FIELDS: SizingField[] = [
  { key: "eyebrowSize", mobileKey: "eyebrowSizeMobile", label: "Eyebrow size", group: "header", min: 9, max: 20, auto: 11, autoMobile: 10 },
  { key: "headingSize", mobileKey: "headingSizeMobile", label: "Heading size", group: "header", min: 14, max: 64, auto: 40, autoMobile: 28 },
  { key: "subheadingSize", mobileKey: "subheadingSizeMobile", label: "Subheading size", group: "header", min: 11, max: 28, auto: 15, autoMobile: 14 },
  { key: "cardTextSize", mobileKey: "cardTextSizeMobile", label: "Card text size", group: "cards", min: 10, max: 20, auto: 13, autoMobile: 12 },
  { key: "cardGap", mobileKey: "cardGapMobile", label: "Space between videos", group: "spacing", min: 0, max: 48, auto: 14, autoMobile: 10 },
  { key: "sectionPaddingY", mobileKey: "sectionPaddingYMobile", label: "Space above and below", group: "spacing", min: 0, max: 160, auto: 32, autoMobile: 24 },
  { key: "sectionPaddingX", mobileKey: "sectionPaddingXMobile", label: "Space at the sides", group: "spacing", min: 0, max: 120, auto: 40, autoMobile: 16 },
];

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
    } else if (LONG_TEXTS.includes(key)) {
      if (typeof value === "string") out[key] = value.trim().slice(0, 160);
    } else if (BOOLS.includes(key)) {
      if (typeof value === "boolean") out[key] = value;
    } else if (ENUMS[key]) {
      // The stacked deck only exists for the carousel widget.
      const stackElsewhere = key === "layoutMode" && value === "stack" && kind !== "CAROUSEL";
      if (typeof value === "string" && ENUMS[key]!.includes(value) && !stackElsewhere) out[key] = value;
    } else if (key === "columnsMobile") {
      // Phones may show half a card more (1.5, 2.5) so the row hints it scrolls.
      const n = Number(value);
      if (Number.isFinite(n)) out[key] = Math.min(Math.max(Math.round(n * 2) / 2, 1), 3);
    } else if (key === "triggerSize" || key === "triggerSizeMobile") {
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
