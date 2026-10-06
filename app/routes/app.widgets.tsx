import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { createWidget, listWidgetsForShop } from "../models/widget.server";
import type { WidgetConfig, WidgetKind } from "../models/widget.server";
import type { Widget } from "@prisma/client";
import { useResourceDetail } from "../components/useResourceDetail";
import { StatTile } from "../components/StatTile";
import { EmptyState } from "../components/EmptyState";
import { ColorField, FIELD_INPUT_STYLE, NumberField, SelectField } from "../components/form-fields";
import { deriveReelStatus } from "../models/reel-status";
import { listReels } from "../models/reel.server";
import type { ReelConfig } from "../models/reel.server";

interface WidgetTemplateMeta {
  kind: WidgetKind;
  name: string;
  description: string;
  icon: "layout-rows-2" | "play-circle" | "layout-columns-3" | "images" | "layout-popup" | "cart";
}

const WIDGET_TEMPLATES: WidgetTemplateMeta[] = [
  {
    kind: "PRODUCT_PAGE_REELS",
    name: "Product page reels",
    description: "A row of tagged reels on the product page.",
    icon: "layout-rows-2",
  },
  {
    kind: "SINGLE_VIDEO",
    name: "Single video",
    description: "One featured video, no carousel.",
    icon: "play-circle",
  },
  {
    kind: "CAROUSEL",
    name: "Stacked carousel",
    description: "Tagged reels as a swipeable stacked deck.",
    icon: "layout-columns-3",
  },
  {
    kind: "STORIES",
    name: "Insta-style stories",
    description: "Circular avatars that open a full-screen story viewer.",
    icon: "images",
  },
  {
    kind: "REEL_POPS",
    name: "Reel pops",
    description: "A site-wide floating bubble that expands into a video.",
    icon: "layout-popup",
  },
  {
    kind: "ADD_TO_CART_VIDEO",
    name: "Add-to-cart video",
    description: "One featured video, inline right below the add-to-cart button.",
    icon: "cart",
  },
];

const WIDGET_KINDS: WidgetKind[] = WIDGET_TEMPLATES.map((t) => t.kind);

type StyleFieldKey =
  | "heading"
  | "watchLabel"
  | "accentColor"
  | "triggerSize"
  | "cornerStyle"
  | "ctaColor"
  | "ctaTextColor"
  | "ctaLabel"
  | "showPrice"
  | "showTitleOverlay"
  | "mutedDefault"
  | "loop"
  | "storyDuration"
  | "position"
  | "showPulse"
  | "backgroundColor"
  | "textColor"
  | "shadowPreset"
  | "layoutMode"
  | "columns"
  | "playTrigger"
  | "autoplayOnScroll"
  | "ctaStyle"
  | "showProductImage"
  | "tagRevealMode";

// Which of the full WidgetStyleConfig fields each kind actually shows, plus
// the per-kind label/range for the one generic "size" slider (thumbnail
// width, avatar size, bubble size, video width — same field, different
// meaning per kind) and defaults matching what each Liquid block used to
// hardcode in its own theme-editor schema before those settings moved here.
const WIDGET_STYLE_FIELDS: Record<
  WidgetKind,
  {
    fields: StyleFieldKey[];
    accentColorLabel: string;
    sizeLabel: string;
    sizeDefault: number;
    sizeMin: number;
    sizeMax: number;
    mutedDefault: boolean;
  }
> = {
  PRODUCT_PAGE_REELS: {
    fields: ["heading", "cornerStyle", "accentColor", "triggerSize", "ctaColor", "ctaTextColor", "ctaLabel", "showPrice", "showTitleOverlay", "mutedDefault", "loop", "backgroundColor", "textColor", "shadowPreset", "layoutMode", "columns", "playTrigger", "autoplayOnScroll", "ctaStyle", "showProductImage", "tagRevealMode"],
    accentColorLabel: "Accent color",
    sizeLabel: "Thumbnail width (px)",
    sizeDefault: 220,
    sizeMin: 120,
    sizeMax: 320,
    mutedDefault: true,
  },
  SINGLE_VIDEO: {
    fields: ["cornerStyle", "accentColor", "triggerSize", "ctaColor", "ctaTextColor", "ctaLabel", "showPrice", "showTitleOverlay", "mutedDefault", "loop", "backgroundColor", "shadowPreset", "playTrigger", "ctaStyle", "showProductImage", "tagRevealMode"],
    accentColorLabel: "Accent color",
    sizeLabel: "Video width (px)",
    sizeDefault: 320,
    sizeMin: 240,
    sizeMax: 480,
    mutedDefault: false,
  },
  CAROUSEL: {
    fields: ["heading", "cornerStyle", "accentColor", "ctaColor", "ctaTextColor", "ctaLabel", "showPrice", "showTitleOverlay", "mutedDefault", "loop", "backgroundColor", "textColor", "shadowPreset", "layoutMode", "columns", "autoplayOnScroll", "ctaStyle", "showProductImage", "tagRevealMode"],
    accentColorLabel: "Accent color",
    sizeLabel: "",
    sizeDefault: 0,
    sizeMin: 0,
    sizeMax: 0,
    mutedDefault: true,
  },
  STORIES: {
    fields: ["heading", "accentColor", "triggerSize", "storyDuration", "ctaColor", "ctaTextColor", "ctaLabel", "showPrice", "showTitleOverlay", "mutedDefault", "loop"],
    accentColorLabel: "Ring color",
    sizeLabel: "Avatar size (px)",
    sizeDefault: 64,
    sizeMin: 40,
    sizeMax: 320,
    mutedDefault: true,
  },
  REEL_POPS: {
    fields: ["position", "showPulse", "triggerSize", "ctaColor", "ctaTextColor", "ctaLabel", "showPrice", "showTitleOverlay", "mutedDefault", "loop"],
    accentColorLabel: "Accent color",
    sizeLabel: "Bubble size (px)",
    sizeDefault: 72,
    sizeMin: 40,
    sizeMax: 320,
    mutedDefault: false,
  },
  ADD_TO_CART_VIDEO: {
    fields: ["watchLabel", "accentColor", "triggerSize", "ctaColor", "ctaTextColor", "ctaLabel", "showPrice", "showTitleOverlay", "mutedDefault", "loop", "backgroundColor", "textColor", "shadowPreset", "playTrigger", "ctaStyle", "showProductImage", "tagRevealMode"],
    accentColorLabel: "Accent color",
    sizeLabel: "Thumbnail size (px)",
    sizeDefault: 72,
    sizeMin: 48,
    sizeMax: 160,
    mutedDefault: false,
  },
  GRID: {
    fields: [],
    accentColorLabel: "Accent color",
    sizeLabel: "",
    sizeDefault: 0,
    sizeMin: 0,
    sizeMax: 0,
    mutedDefault: false,
  },
};

// s-checkbox's ElementInternals form participation doesn't reliably clear
// on uncheck (see the identical note on the Published checkbox below), so
// every boolean style field pairs a real s-checkbox with a hidden input
// this component keeps in sync imperatively via ref instead of trusting the
// checkbox's own name/value to submit correctly.
function StyleCheckboxField({
  name,
  label,
  defaultChecked,
  resetKey,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
  resetKey: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input type="hidden" name={name} ref={ref} key={`${name}-hidden-${resetKey}`} defaultValue={defaultChecked ? "true" : ""} />
      <s-checkbox
        key={`${name}-checkbox-${resetKey}`}
        label={label}
        defaultChecked={defaultChecked}
        onChange={(event: { currentTarget: { checked: boolean } | null }) => {
          if (ref.current && event.currentTarget) {
            ref.current.value = event.currentTarget.checked ? "true" : "";
          }
        }}
      ></s-checkbox>
    </>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const [widgets, reels] = await Promise.all([
    listWidgetsForShop(shop.id),
    listReels(admin, 50),
  ]);
  return { widgets, reels };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "");

  if (!name || !WIDGET_KINDS.includes(type as WidgetKind)) {
    return { error: "Name and a valid widget type are required" };
  }

  const productHandles = formData.getAll("productHandle").map(String).filter(Boolean);
  const collectionHandles = formData.getAll("collectionHandle").map(String).filter(Boolean);
  const reelIds = formData.getAll("reelId").map(String).filter(Boolean);
  const featuredReelId = String(formData.get("featuredReelId") ?? "").trim();

  const config: WidgetConfig = {
    templateStyle: "classic",
    targetRule:
      productHandles.length > 0
        ? { type: "handles", handles: productHandles }
        : collectionHandles.length > 0
          ? { type: "collections", handles: collectionHandles }
          : { type: "all_products" },
    ...(reelIds.length > 0 ? { reelIds } : {}),
    ...(featuredReelId ? { featuredReelId } : {}),
  };

  await createWidget(shop.id, type as WidgetKind, name, config);

  return { error: null };
};

function WidgetCard({
  widget,
  onOpen,
  onDeleteClick,
}: {
  widget: Widget;
  onOpen: (widget: Widget) => void;
  onDeleteClick: (widget: Widget) => void;
}) {
  const config = widget.config as unknown as WidgetConfig;
  const kind = widget.type as WidgetKind;
  const meta = WIDGET_TEMPLATES.find((t) => t.kind === kind);
  const targetRule = config.targetRule;
  const handleCount = targetRule?.type === "handles" ? targetRule.handles.length : 0;
  const targetSummary =
    targetRule?.type === "all_products"
      ? "All products"
      : `${handleCount} product${handleCount === 1 ? "" : "s"}`;
  const reelCount = config.reelIds?.length ?? 0;
  const hasFeaturedReel = Boolean(config.featuredReelId);
  const showsFeaturedReel =
    kind === "SINGLE_VIDEO" || kind === "REEL_POPS" || kind === "ADD_TO_CART_VIDEO";
  const showsReelCount = kind === "PRODUCT_PAGE_REELS" || kind === "CAROUSEL" || kind === "STORIES";

  return (
    // See ReelCard in app.reels.tsx for why the kebab button below is a DOM
    // sibling rather than nested inside this s-clickable, and why this opens
    // a popup instead of navigating.
    <div style={{ position: "relative" }}>
      <s-clickable
        padding="base"
        background="subdued"
        border="base"
        borderRadius="base"
        commandFor="widget-detail-modal"
        command="--show"
        onClick={() => onOpen(widget)}
      >
        <s-stack gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {meta && <s-icon type={meta.icon} tone="neutral"></s-icon>}
            <s-text type="strong">{widget.name}</s-text>
          </s-stack>
          <s-text color="subdued">{meta?.name ?? widget.type}</s-text>
          <s-stack direction="inline" gap="small-100">
            <s-badge tone={widget.published ? "success" : "neutral"}>
              {widget.published ? "Published" : "Draft"}
            </s-badge>
            <s-badge tone="neutral">{targetSummary}</s-badge>
          </s-stack>
          {(showsFeaturedReel || showsReelCount) && (
            <s-text color="subdued">
              {showsFeaturedReel && (hasFeaturedReel ? "Featured reel set" : "No featured reel yet")}
              {showsReelCount && `${reelCount} reel${reelCount === 1 ? "" : "s"} selected`}
            </s-text>
          )}
        </s-stack>
      </s-clickable>
      {/* Inset to match s-clickable's own padding="base" (16px), matching
          ReelCard's kebab placement for a consistent card language. */}
      <div
        style={{
          position: "absolute",
          top: "16px",
          right: "16px",
          borderRadius: "999px",
          boxShadow: "0 1px 4px rgba(0, 0, 0, 0.15)",
          overflow: "hidden",
        }}
      >
        <s-button
          icon="menu-horizontal"
          variant="secondary"
          accessibilityLabel={`More actions for ${widget.name}`}
          commandFor="widget-delete-modal"
          command="--show"
          onClick={() => onDeleteClick(widget)}
        ></s-button>
      </div>
    </div>
  );
}

function TemplatePicker({
  value,
  onChange,
}: {
  value: WidgetKind;
  onChange: (kind: WidgetKind) => void;
}) {
  return (
    <s-grid gridTemplateColumns="repeat(auto-fill, minmax(180px, 1fr))" gap="small-200">
      {WIDGET_TEMPLATES.map((template) => {
        const selected = template.kind === value;
        return (
          <s-clickable
            key={template.kind}
            padding="base"
            background={selected ? "strong" : "subdued"}
            border="base"
            borderColor={selected ? "strong" : undefined}
            borderRadius="base"
            onClick={() => onChange(template.kind)}
          >
            <s-stack gap="small-200">
              <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
                <s-icon type={template.icon} tone={selected ? "info" : "neutral"}></s-icon>
                {selected && <s-icon type="check-circle-filled" tone="info"></s-icon>}
              </s-stack>
              <s-text type="strong">{template.name}</s-text>
              <s-text color="subdued">{template.description}</s-text>
            </s-stack>
          </s-clickable>
        );
      })}
    </s-grid>
  );
}

function CreateWidgetModal({ reels }: { reels: PickableReel[] }) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedKind, setSelectedKind] = useState<WidgetKind>("PRODUCT_PAGE_REELS");
  const [targetProducts, setTargetProducts] = useState<{ id: string; title: string; handle: string }[]>([]);
  const [targetCollections, setTargetCollections] = useState<{ id: string; title: string; handle: string }[]>([]);
  const [selectedReelIds, setSelectedReelIds] = useState<Set<string>>(new Set());
  const [selectedFeaturedReelId, setSelectedFeaturedReelId] = useState<string | null>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      shopify.modal.hide("create-widget-modal");
      setTargetProducts([]);
      setTargetCollections([]);
      setSelectedReelIds(new Set());
      setSelectedFeaturedReelId(null);
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const showsFeaturedReel =
    selectedKind === "SINGLE_VIDEO" ||
    selectedKind === "REEL_POPS" ||
    selectedKind === "ADD_TO_CART_VIDEO";
  const showsReelList =
    selectedKind === "PRODUCT_PAGE_REELS" || selectedKind === "CAROUSEL" || selectedKind === "STORIES";

  const handlePickTargetProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: targetProducts.map((p) => ({ id: p.id })),
    });
    if (!selected) return;
    setTargetProducts(selected.map((p) => ({ id: p.id, title: p.title, handle: p.handle })));
    setTargetCollections([]);
  };

  const handlePickTargetCollections = async () => {
    const selected = await shopify.resourcePicker({
      type: "collection",
      multiple: true,
      selectionIds: targetCollections.map((c) => ({ id: c.id })),
    });
    if (!selected) return;
    setTargetCollections(selected.map((c) => ({ id: c.id, title: c.title, handle: c.handle })));
    setTargetProducts([]);
  };

  return (
    <s-modal
      id="create-widget-modal"
      heading="Create a widget"
      accessibilityLabel="Create a widget"
      size="large"
    >
      <fetcher.Form id="create-widget-form" ref={formRef} method="post">
        <s-stack gap="large">
          {fetcher.data?.error && (
            <s-paragraph tone="critical">{fetcher.data.error}</s-paragraph>
          )}

          <s-stack gap="base">
            <s-heading>Details</s-heading>
            <s-text-field label="Name" name="name" required></s-text-field>
            <input type="hidden" name="type" value={selectedKind} />
          </s-stack>

          <s-divider></s-divider>

          <s-stack gap="small-200">
            <s-heading>Template</s-heading>
            <s-paragraph color="subdued">Choose how this widget shows your reels.</s-paragraph>
            <TemplatePicker value={selectedKind} onChange={setSelectedKind} />
          </s-stack>

          <s-divider></s-divider>

          <s-stack gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
              <s-heading>Target (optional)</s-heading>
              <s-stack direction="inline" gap="small-200">
                <s-button type="button" variant="secondary" onClick={handlePickTargetProducts}>
                  {targetProducts.length === 0 ? "Choose products" : "Edit products"}
                </s-button>
                <s-button type="button" variant="secondary" onClick={handlePickTargetCollections}>
                  {targetCollections.length === 0 ? "Choose collections" : "Edit collections"}
                </s-button>
              </s-stack>
            </s-stack>
            {targetProducts.length === 0 && targetCollections.length === 0 ? (
              <s-paragraph color="subdued">Shows on all products by default.</s-paragraph>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--p-space-200, 8px)" }}>
                {targetProducts.map((product) => (
                  <s-badge key={product.id}>{product.title}</s-badge>
                ))}
                {targetCollections.map((collection) => (
                  <s-badge key={collection.id}>{collection.title}</s-badge>
                ))}
              </div>
            )}
            {targetProducts.map((product) => (
              <input key={product.id} type="hidden" name="productHandle" value={product.handle} />
            ))}
            {targetCollections.map((collection) => (
              <input key={collection.id} type="hidden" name="collectionHandle" value={collection.handle} />
            ))}
          </s-stack>

          {showsFeaturedReel && (
            <>
              <s-divider></s-divider>
              <s-stack gap="small-200">
                <s-heading>Featured reel (optional)</s-heading>
                <input type="hidden" name="featuredReelId" value={selectedFeaturedReelId ?? ""} />
                {reels.length === 0 ? (
                  <s-paragraph color="subdued">No reels yet — create one from the Reels library first.</s-paragraph>
                ) : (
                  <s-box padding="small-200" background="subdued" borderRadius="base">
                    <s-stack gap="small-100">
                      {reels.map((reel) => (
                        <ReelPickerRow
                          key={reel.id}
                          reel={reel}
                          selected={selectedFeaturedReelId === reel.id}
                          onToggle={() =>
                            setSelectedFeaturedReelId((prev) => (prev === reel.id ? null : reel.id))
                          }
                        />
                      ))}
                    </s-stack>
                  </s-box>
                )}
              </s-stack>
            </>
          )}

          {showsReelList && (
            <>
              <s-divider></s-divider>
              <s-stack gap="small-200">
                <s-heading>Reels ({selectedReelIds.size})</s-heading>
                <s-paragraph color="subdued">Optional — you can also pick these after creating the widget.</s-paragraph>
                {Array.from(selectedReelIds).map((id) => (
                  <input key={id} type="hidden" name="reelId" value={id} />
                ))}
                {reels.length === 0 ? (
                  <s-paragraph color="subdued">No reels yet — create one from the Reels library first.</s-paragraph>
                ) : (
                  <s-box padding="small-200" background="subdued" borderRadius="base">
                    <s-stack gap="small-100">
                      {reels.map((reel) => (
                        <ReelPickerRow
                          key={reel.id}
                          reel={reel}
                          selected={selectedReelIds.has(reel.id)}
                          onToggle={() => {
                            setSelectedReelIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(reel.id)) next.delete(reel.id);
                              else next.add(reel.id);
                              return next;
                            });
                          }}
                        />
                      ))}
                    </s-stack>
                  </s-box>
                )}
              </s-stack>
            </>
          )}
        </s-stack>
      </fetcher.Form>
      <s-button
        slot="primary-action"
        variant="primary"
        loading={fetcher.state !== "idle"}
        onClick={() => formRef.current?.requestSubmit()}
      >
        Create widget
      </s-button>
      <s-button slot="secondary-actions" commandFor="create-widget-modal" command="--hide">
        Cancel
      </s-button>
    </s-modal>
  );
}

type PickableReel = {
  id: string;
  title: string;
  config: Pick<ReelConfig, "posterUrl" | "hlsManifestUrl" | "cloudflareStreamUid" | "uploadFailedAt">;
};

type WidgetDetailLoaderData = {
  widget: Widget;
  reels: PickableReel[];
};

const REEL_STATUS_TONE: Record<string, "success" | "critical" | "info" | "neutral"> = {
  ready: "success",
  failed: "critical",
  processing: "info",
  draft: "neutral",
};

const REEL_STATUS_LABEL: Record<string, string> = {
  ready: "Ready",
  failed: "Failed",
  processing: "Processing",
  draft: "No video",
};

// Reels aren't a real Shopify resource, so there's no native resourcePicker
// for them (unlike products, which use shopify.resourcePicker directly) —
// this is the closest equivalent: a thumbnail + title + status row that
// toggles selection on click, used for both the single-select "Featured
// reel" picker and the multi-select "Reels" picker, instead of a bare
// <select> or a plain checkbox-per-line list.
function ReelPickerRow({
  reel,
  selected,
  onToggle,
}: {
  reel: PickableReel;
  selected: boolean;
  onToggle: () => void;
}) {
  const status = deriveReelStatus(reel.config as ReelConfig);
  return (
    <s-clickable
      type="button"
      padding="small-200"
      background={selected ? "strong" : "transparent"}
      borderRadius="base"
      onClick={onToggle}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--p-space-base, 12px)" }}>
        <div style={{ width: "32px", flexShrink: 0, aspectRatio: "9 / 16" }}>
          {reel.config.posterUrl ? (
            <s-image
              src={reel.config.posterUrl}
              alt={reel.title}
              aspectRatio="9/16"
              objectFit="cover"
              inlineSize="fill"
              borderRadius="small-100"
            ></s-image>
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "4px",
                background: "var(--p-color-bg-surface-strong, #d9d9d9)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <s-icon type="play-circle" tone="neutral"></s-icon>
            </div>
          )}
        </div>
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <s-stack gap="small-100">
            <s-text type="strong">{reel.title}</s-text>
            <s-badge tone={REEL_STATUS_TONE[status]}>{REEL_STATUS_LABEL[status]}</s-badge>
          </s-stack>
        </div>
        {selected && <s-icon type="check-circle-filled" tone="info"></s-icon>}
      </div>
    </s-clickable>
  );
}

// Full styling/behavior editor for one widget — colors, sizes, labels,
// mute/loop, corner style, etc. Every field this app's 6 storefront blocks
// used to expose only in the theme editor now lives here instead, so a
// merchant customizes a widget once, in the admin, without ever opening the
// theme editor (see WIDGET_STYLE_FIELDS for which fields each kind shows).
function StyleSection({
  widget,
  href,
  styleFetcher,
  styleFormRef,
}: {
  widget: Widget;
  href: string | null;
  styleFetcher: ReturnType<typeof useFetcher<{ error: string | null }>>;
  styleFormRef: RefObject<HTMLFormElement>;
}) {
  const kind = widget.type as WidgetKind;
  const fieldConfig = WIDGET_STYLE_FIELDS[kind];
  const style = (widget.config as unknown as WidgetConfig).style ?? {};
  const has = (key: StyleFieldKey) => fieldConfig.fields.includes(key);
  const resetKey = widget.id;

  return (
    <s-stack gap="base">
      <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
        <s-heading>Appearance</s-heading>
        <s-button
          type="button"
          variant="secondary"
          loading={styleFetcher.state !== "idle"}
          onClick={() => styleFormRef.current?.requestSubmit()}
        >
          Save
        </s-button>
      </s-stack>
      {styleFetcher.data?.error && <s-paragraph tone="critical">{styleFetcher.data.error}</s-paragraph>}
      <styleFetcher.Form method="post" action={href ?? undefined} ref={styleFormRef} key={resetKey}>
        <input type="hidden" name="intent" value="set-style" />
        <s-stack gap="base">
          {has("heading") && (
            <s-text-field label="Heading" name="heading" defaultValue={style.heading ?? ""} placeholder="Leave blank to hide"></s-text-field>
          )}
          {has("watchLabel") && (
            <s-text-field label="Label text" name="watchLabel" defaultValue={style.watchLabel ?? "Watch video"}></s-text-field>
          )}
          {has("cornerStyle") && (
            <SelectField
              id={`cornerStyle-${resetKey}`}
              name="cornerStyle"
              label="Corner style"
              defaultValue={style.cornerStyle ?? "rounded"}
              options={[
                { value: "sharp", label: "Sharp" },
                { value: "rounded", label: "Rounded" },
                { value: "soft", label: "Soft" },
              ]}
            />
          )}
          {has("position") && (
            <SelectField
              id={`position-${resetKey}`}
              name="position"
              label="Bubble position"
              defaultValue={style.position ?? "bottom_right"}
              options={[
                { value: "bottom_right", label: "Bottom right" },
                { value: "bottom_left", label: "Bottom left" },
                { value: "top_right", label: "Top right" },
                { value: "top_left", label: "Top left" },
              ]}
            />
          )}
          {has("accentColor") && (
            <ColorField
              id={`accentColor-${resetKey}`}
              name="accentColor"
              label={fieldConfig.accentColorLabel}
              defaultValue={style.accentColor || "#111111"}
            />
          )}
          {has("triggerSize") && (
            <NumberField
              id={`triggerSize-${resetKey}`}
              name="triggerSize"
              label={fieldConfig.sizeLabel}
              min={fieldConfig.sizeMin}
              max={fieldConfig.sizeMax}
              defaultValue={style.triggerSize ?? fieldConfig.sizeDefault}
            />
          )}
          {has("storyDuration") && (
            <NumberField
              id={`storyDuration-${resetKey}`}
              name="storyDuration"
              label="Seconds per story"
              min={5}
              max={30}
              defaultValue={style.storyDuration ?? 15}
            />
          )}
          {has("ctaColor") && (
            <ColorField
              id={`ctaColor-${resetKey}`}
              name="ctaColor"
              label="Add to cart button color"
              defaultValue={style.ctaColor || "#111111"}
            />
          )}
          {has("ctaTextColor") && (
            <ColorField
              id={`ctaTextColor-${resetKey}`}
              name="ctaTextColor"
              label="Add to cart text color"
              defaultValue={style.ctaTextColor || "#ffffff"}
            />
          )}
          {has("ctaLabel") && (
            <s-text-field label="Add to cart button text" name="ctaLabel" defaultValue={style.ctaLabel ?? ""} placeholder="Leave blank to use the default label"></s-text-field>
          )}
          {has("showPulse") && (
            <StyleCheckboxField name="showPulse" label="Pulse to draw attention" defaultChecked={style.showPulse ?? true} resetKey={resetKey} />
          )}
          {has("showPrice") && (
            <StyleCheckboxField name="showPrice" label="Show product price" defaultChecked={style.showPrice ?? true} resetKey={resetKey} />
          )}
          {has("showTitleOverlay") && (
            <StyleCheckboxField name="showTitleOverlay" label="Show video title" defaultChecked={style.showTitleOverlay ?? true} resetKey={resetKey} />
          )}
          {has("mutedDefault") && (
            <StyleCheckboxField name="mutedDefault" label="Mute video by default" defaultChecked={style.mutedDefault ?? fieldConfig.mutedDefault} resetKey={resetKey} />
          )}
          {has("loop") && (
            <StyleCheckboxField name="loop" label="Loop video" defaultChecked={style.loop ?? false} resetKey={resetKey} />
          )}
          {has("backgroundColor") && (
            <ColorField
              id={`backgroundColor-${resetKey}`}
              name="backgroundColor"
              label="Background color"
              defaultValue={style.backgroundColor || "#ffffff"}
            />
          )}
          {has("textColor") && (
            <ColorField
              id={`textColor-${resetKey}`}
              name="textColor"
              label="Text color"
              defaultValue={style.textColor || "#111111"}
            />
          )}
          {has("shadowPreset") && (
            <SelectField
              id={`shadowPreset-${resetKey}`}
              name="shadowPreset"
              label="Shadow"
              defaultValue={style.shadowPreset ?? "none"}
              options={[
                { value: "none", label: "None" },
                { value: "soft", label: "Soft" },
                { value: "bold", label: "Bold" },
              ]}
            />
          )}
          {has("layoutMode") && (
            <SelectField
              id={`layoutMode-${resetKey}`}
              name="layoutMode"
              label="Layout"
              defaultValue={style.layoutMode ?? "carousel"}
              options={[
                { value: "carousel", label: "Carousel" },
                { value: "grid", label: "Grid" },
              ]}
            />
          )}
          {has("columns") && (
            <NumberField
              id={`columns-${resetKey}`}
              name="columns"
              label="Grid columns"
              min={2}
              max={5}
              defaultValue={style.columns ?? 3}
            />
          )}
          {has("playTrigger") && (
            <SelectField
              id={`playTrigger-${resetKey}`}
              name="playTrigger"
              label="Play on"
              defaultValue={style.playTrigger ?? "click"}
              options={[
                { value: "click", label: "Click" },
                { value: "hover", label: "Hover (desktop)" },
              ]}
            />
          )}
          {has("autoplayOnScroll") && (
            <StyleCheckboxField name="autoplayOnScroll" label="Autoplay muted when scrolled into view" defaultChecked={style.autoplayOnScroll ?? false} resetKey={resetKey} />
          )}
          {has("ctaStyle") && (
            <SelectField
              id={`ctaStyle-${resetKey}`}
              name="ctaStyle"
              label="Add to cart button style"
              defaultValue={style.ctaStyle ?? "pill"}
              options={[
                { value: "pill", label: "Pill" },
                { value: "square", label: "Square" },
                { value: "text-link", label: "Text link" },
              ]}
            />
          )}
          {has("showProductImage") && (
            <StyleCheckboxField name="showProductImage" label="Show product image in tags" defaultChecked={style.showProductImage ?? true} resetKey={resetKey} />
          )}
          {has("tagRevealMode") && (
            <SelectField
              id={`tagRevealMode-${resetKey}`}
              name="tagRevealMode"
              label="Product tags"
              defaultValue={style.tagRevealMode ?? "always"}
              options={[
                { value: "always", label: "Always visible" },
                { value: "tap", label: "Tap to reveal" },
              ]}
            />
          )}
        </s-stack>
      </styleFetcher.Form>
    </s-stack>
  );
}

function WidgetDetailModal({
  widget,
  href,
  onClose,
}: {
  widget: Widget | null;
  href: string | null;
  onClose: () => void;
}) {
  const editFetcher = useFetcher<{ error: string | null }>();
  const targetFetcher = useFetcher<{ error: string | null }>();
  const featuredReelFetcher = useFetcher<{ error: string | null }>();
  const reelsFetcher = useFetcher<{ error: string | null }>();
  const styleFetcher = useFetcher<{ error: string | null }>();
  const deviceVisibilityFetcher = useFetcher<{ error: string | null }>();
  const duplicateFetcher = useFetcher();
  const shopify = useAppBridge();
  const publishedRef = useRef<HTMLInputElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);
  const styleFormRef = useRef<HTMLFormElement>(null);
  const { data: detailData } = useResourceDetail<WidgetDetailLoaderData>(href, [
    editFetcher,
    targetFetcher,
    featuredReelFetcher,
    reelsFetcher,
    styleFetcher,
    deviceVisibilityFetcher,
  ]);
  const detailWidget = detailData?.widget ?? null;

  // See the identical pattern/comment in ReelDetailModal (app.reels.tsx):
  // the duplicate action redirects to /app/widgets (the list we're already
  // on), so the fetcher returning to idle is the signal to close.
  const duplicateSubmittedRef = useRef(false);
  useEffect(() => {
    if (duplicateSubmittedRef.current && duplicateFetcher.state === "idle") {
      duplicateSubmittedRef.current = false;
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicateFetcher.state]);
  const targetRule = detailWidget
    ? (detailWidget.config as unknown as WidgetConfig).targetRule
    : null;
  const currentHandles = targetRule?.type === "handles" ? targetRule.handles : [];
  const currentCollectionHandles = targetRule?.type === "collections" ? targetRule.handles : [];
  const deviceVisibility = detailWidget
    ? ((detailWidget.config as unknown as WidgetConfig).deviceVisibility ?? "all")
    : "all";

  // Tracked in JS rather than relied on via each checkbox's native name/value
  // — s-checkbox's ElementInternals form participation doesn't reliably clear
  // on uncheck (the same bug that broke the published toggle: see reel.server.ts
  // toBool and the earlier published-checkbox fixes). Unchecking a previously
  // selected reel here would silently keep submitting it. Reset only when the
  // widget identity changes, not on every unrelated detailFetcher reload, so
  // in-progress selection edits survive an unrelated Save.
  const [selectedReelIds, setSelectedReelIds] = useState<Set<string>>(new Set());
  const [selectedFeaturedReelId, setSelectedFeaturedReelId] = useState<string | null>(null);
  useEffect(() => {
    if (detailWidget) {
      const config = detailWidget.config as unknown as WidgetConfig;
      setSelectedReelIds(new Set(config.reelIds ?? []));
      setSelectedFeaturedReelId(config.featuredReelId ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailWidget?.id]);

  const handlePickProducts = async () => {
    if (!href) return;
    const selected = await shopify.resourcePicker({ type: "product", multiple: true });
    if (!selected) return;

    const formData = new FormData();
    formData.set("intent", "set-target");
    for (const product of selected) {
      formData.append("productHandle", product.handle);
    }
    targetFetcher.submit(formData, { method: "post", action: href });
  };

  const handleClearTarget = () => {
    if (!href) return;
    const formData = new FormData();
    formData.set("intent", "clear-target");
    targetFetcher.submit(formData, { method: "post", action: href });
  };

  const handlePickCollections = async () => {
    if (!href) return;
    const selected = await shopify.resourcePicker({ type: "collection", multiple: true });
    if (!selected) return;

    const formData = new FormData();
    formData.set("intent", "set-target-collections");
    for (const collection of selected) {
      formData.append("collectionHandle", collection.handle);
    }
    targetFetcher.submit(formData, { method: "post", action: href });
  };

  const handleDeviceVisibilityChange = (value: string) => {
    if (!href) return;
    const formData = new FormData();
    formData.set("intent", "set-device-visibility");
    formData.set("deviceVisibility", value);
    deviceVisibilityFetcher.submit(formData, { method: "post", action: href });
  };

  const meta = detailWidget ? WIDGET_TEMPLATES.find((t) => t.kind === detailWidget.type) : undefined;
  const showsFeaturedReel =
    detailWidget?.type === "SINGLE_VIDEO" ||
    detailWidget?.type === "REEL_POPS" ||
    detailWidget?.type === "ADD_TO_CART_VIDEO";
  const showsReelList =
    detailWidget?.type === "PRODUCT_PAGE_REELS" ||
    detailWidget?.type === "CAROUSEL" ||
    detailWidget?.type === "STORIES";

  return (
    <s-modal
      id="widget-detail-modal"
      heading={widget?.name ?? "Widget"}
      accessibilityLabel={widget?.name ?? "Widget"}
      size="large"
      onHide={onClose}
    >
      {!detailWidget ? (
        <s-paragraph>Loading…</s-paragraph>
      ) : (
        <s-stack gap="large">
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              {meta && (
                <s-box padding="small-200" background="base" borderRadius="base">
                  <s-icon type={meta.icon} tone="info"></s-icon>
                </s-box>
              )}
              <s-stack gap="small-100">
                <s-text type="strong">{meta?.name ?? detailWidget.type}</s-text>
                <s-stack direction="inline" gap="small-100">
                  <s-badge tone={detailWidget.published ? "success" : "neutral"}>
                    {detailWidget.published ? "Published" : "Draft"}
                  </s-badge>
                  <s-badge tone="neutral">
                    {targetRule?.type === "all_products"
                      ? "All products"
                      : `${currentHandles.length} product${currentHandles.length === 1 ? "" : "s"}`}
                  </s-badge>
                </s-stack>
              </s-stack>
            </s-stack>
          </s-box>

          <s-stack gap="base">
            <s-heading>Details</s-heading>
            {editFetcher.data?.error && (
              <s-paragraph tone="critical">{editFetcher.data.error}</s-paragraph>
            )}
            <editFetcher.Form method="post" action={href ?? undefined} ref={editFormRef}>
              <s-stack gap="base">
                <s-text-field
                  label="Name"
                  name="name"
                  defaultValue={detailWidget.name}
                  required
                ></s-text-field>
                <input
                  type="hidden"
                  name="published"
                  ref={publishedRef}
                  key={`published-${detailWidget.id}`}
                  defaultValue={detailWidget.published ? "true" : ""}
                />
                <s-checkbox
                  key={`checkbox-${detailWidget.id}`}
                  label="Published"
                  defaultChecked={detailWidget.published}
                  onChange={(event: { currentTarget: { checked: boolean } | null }) => {
                    if (publishedRef.current && event.currentTarget) {
                      publishedRef.current.value = event.currentTarget.checked ? "true" : "";
                    }
                  }}
                ></s-checkbox>
              </s-stack>
            </editFetcher.Form>
          </s-stack>

          <s-divider></s-divider>

          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
              <s-heading>Target</s-heading>
              <s-stack direction="inline" gap="small-200">
                <s-button
                  variant="secondary"
                  onClick={handlePickProducts}
                  loading={targetFetcher.state !== "idle"}
                >
                  Choose products
                </s-button>
                <s-button
                  variant="secondary"
                  onClick={handlePickCollections}
                  loading={targetFetcher.state !== "idle"}
                >
                  Choose collections
                </s-button>
                {targetRule?.type !== "all_products" && (
                  <s-button type="button" variant="tertiary" onClick={handleClearTarget}>
                    Target all instead
                  </s-button>
                )}
              </s-stack>
            </s-stack>
            {targetFetcher.data?.error && (
              <s-paragraph tone="critical">{targetFetcher.data.error}</s-paragraph>
            )}
            {targetRule?.type === "all_products" ? (
              <s-paragraph color="subdued">Showing on all products.</s-paragraph>
            ) : targetRule?.type === "collections" ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--p-space-200, 8px)" }}>
                {currentCollectionHandles.map((handle) => (
                  <s-badge key={handle}>{handle}</s-badge>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--p-space-200, 8px)" }}>
                {currentHandles.map((handle) => (
                  <s-badge key={handle}>{handle}</s-badge>
                ))}
              </div>
            )}
            {/* Plain <select> with its own onChange rather than SelectField —
                this one saves immediately on change (like the button-driven
                target pickers above) instead of needing a separate submit
                step, so it doesn't fit SelectField's form-field contract. */}
            <s-stack gap="small-100">
              <label htmlFor={`deviceVisibility-${detailWidget.id}`}>
                <s-text>Show on</s-text>
              </label>
              <select
                id={`deviceVisibility-${detailWidget.id}`}
                key={`deviceVisibility-${detailWidget.id}`}
                defaultValue={deviceVisibility}
                onChange={(e) => handleDeviceVisibilityChange(e.currentTarget.value)}
                style={FIELD_INPUT_STYLE}
              >
                <option value="all">All devices</option>
                <option value="desktop">Desktop only</option>
                <option value="mobile">Mobile only</option>
              </select>
            </s-stack>
            {deviceVisibilityFetcher.data?.error && (
              <s-paragraph tone="critical">{deviceVisibilityFetcher.data.error}</s-paragraph>
            )}
          </s-stack>

          {detailWidget && WIDGET_STYLE_FIELDS[detailWidget.type as WidgetKind].fields.length > 0 && (
            <>
              <s-divider></s-divider>
              <StyleSection widget={detailWidget} href={href} styleFetcher={styleFetcher} styleFormRef={styleFormRef} />
            </>
          )}

          {showsFeaturedReel && (
            <>
              <s-divider></s-divider>
              <s-stack gap="base">
                <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
                  <s-heading>Featured reel</s-heading>
                  <featuredReelFetcher.Form method="post" action={href ?? undefined}>
                    <input type="hidden" name="intent" value="set-featured-reel" />
                    <input type="hidden" name="featuredReelId" value={selectedFeaturedReelId ?? ""} />
                    <s-button
                      type="submit"
                      variant="secondary"
                      disabled={!selectedFeaturedReelId}
                      loading={featuredReelFetcher.state !== "idle"}
                    >
                      Save
                    </s-button>
                  </featuredReelFetcher.Form>
                </s-stack>
                {featuredReelFetcher.data?.error && (
                  <s-paragraph tone="critical">{featuredReelFetcher.data.error}</s-paragraph>
                )}
                {(detailData?.reels.length ?? 0) === 0 ? (
                  <s-paragraph color="subdued">No reels yet — create one from the Reels library first.</s-paragraph>
                ) : (
                  <s-box padding="small-200" background="subdued" borderRadius="base">
                    <s-stack gap="small-100">
                      {(detailData?.reels ?? []).map((reel) => (
                        <ReelPickerRow
                          key={reel.id}
                          reel={reel}
                          selected={selectedFeaturedReelId === reel.id}
                          onToggle={() => setSelectedFeaturedReelId(reel.id)}
                        />
                      ))}
                    </s-stack>
                  </s-box>
                )}
              </s-stack>
            </>
          )}

          {showsReelList && (
            <>
              <s-divider></s-divider>
              <s-stack gap="base">
                <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
                  <s-heading>Reels ({selectedReelIds.size})</s-heading>
                  <s-button
                    variant="secondary"
                    loading={reelsFetcher.state !== "idle"}
                    onClick={() => {
                      if (!href) return;
                      const formData = new FormData();
                      formData.set("intent", "set-reels");
                      for (const id of selectedReelIds) formData.append("reelId", id);
                      reelsFetcher.submit(formData, { method: "post", action: href });
                    }}
                  >
                    Save
                  </s-button>
                </s-stack>
                {reelsFetcher.data?.error && (
                  <s-paragraph tone="critical">{reelsFetcher.data.error}</s-paragraph>
                )}
                <s-paragraph color="subdued">
                  Shown by this widget, same set on every targeted product page. Click a reel to toggle it.
                </s-paragraph>
                {(detailData?.reels.length ?? 0) === 0 ? (
                  <s-paragraph color="subdued">No reels yet — create one from the Reels library first.</s-paragraph>
                ) : (
                  <s-box padding="small-200" background="subdued" borderRadius="base">
                    <s-stack gap="small-100">
                      {(detailData?.reels ?? []).map((reel) => (
                        <ReelPickerRow
                          key={reel.id}
                          reel={reel}
                          selected={selectedReelIds.has(reel.id)}
                          onToggle={() => {
                            setSelectedReelIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(reel.id)) next.delete(reel.id);
                              else next.add(reel.id);
                              return next;
                            });
                          }}
                        />
                      ))}
                    </s-stack>
                  </s-box>
                )}
              </s-stack>
            </>
          )}

        </s-stack>
      )}
      {detailWidget && (
        <s-button
          slot="primary-action"
          variant="primary"
          loading={editFetcher.state !== "idle"}
          onClick={() => editFormRef.current?.requestSubmit()}
        >
          Save
        </s-button>
      )}
      {detailWidget && (
        <s-button
          slot="secondary-actions"
          variant="tertiary"
          loading={duplicateFetcher.state !== "idle"}
          onClick={() => {
            if (!href) return;
            duplicateSubmittedRef.current = true;
            const formData = new FormData();
            formData.set("intent", "duplicate");
            duplicateFetcher.submit(formData, { method: "post", action: href });
          }}
        >
          Duplicate
        </s-button>
      )}
      <s-button slot="secondary-actions" commandFor="widget-detail-modal" command="--hide">
        Close
      </s-button>
    </s-modal>
  );
}

// Small, dedicated confirm-delete modal — separate from the (large) detail
// modal so deleting a widget doesn't require opening its full detail view
// first. Triggered from the kebab button on each WidgetCard.
function WidgetDeleteModal({
  widget,
  onClose,
}: {
  widget: Widget | null;
  onClose: () => void;
}) {
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();
  const submittedRef = useRef(false);
  const href = widget ? `/app/widgets/${encodeURIComponent(widget.id)}` : null;

  useEffect(() => {
    if (submittedRef.current && deleteFetcher.state === "idle") {
      submittedRef.current = false;
      shopify.modal.hide("widget-delete-modal");
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteFetcher.state]);

  return (
    <s-modal
      id="widget-delete-modal"
      heading="Delete widget"
      accessibilityLabel="Delete widget"
      onHide={onClose}
    >
      <s-paragraph>
        Delete {widget ? <strong>{widget.name}</strong> : "this widget"}? This can&rsquo;t be undone.
      </s-paragraph>
      <s-button
        slot="primary-action"
        variant="primary"
        tone="critical"
        loading={deleteFetcher.state !== "idle"}
        onClick={() => {
          if (!href) return;
          submittedRef.current = true;
          const formData = new FormData();
          formData.set("intent", "delete");
          deleteFetcher.submit(formData, { method: "post", action: href });
        }}
      >
        Delete widget
      </s-button>
      <s-button slot="secondary-actions" commandFor="widget-delete-modal" command="--hide">
        Cancel
      </s-button>
    </s-modal>
  );
}

export default function Widgets() {
  const { widgets, reels } = useLoaderData<typeof loader>();
  const publishedCount = widgets.filter((w) => w.published).length;
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [widgetPendingDelete, setWidgetPendingDelete] = useState<Widget | null>(null);
  const selectedWidget = widgets.find((w) => w.id === selectedWidgetId) ?? null;
  const href = selectedWidget ? `/app/widgets/${encodeURIComponent(selectedWidget.id)}` : null;

  return (
    <s-page heading="Widgets" inlineSize="large">
      <s-button slot="primary-action" variant="primary" commandFor="create-widget-modal" command="--show">
        Create widget
      </s-button>
      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(2, 1fr)" gap="base">
          <StatTile label="Total widgets" value={widgets.length} icon="apps" />
          <StatTile label="Published" value={publishedCount} icon="check-circle" />
        </s-grid>
      </s-section>

      <s-section heading="All widgets">
        {widgets.length === 0 ? (
          <EmptyState
            icon="apps"
            heading="No widgets yet"
            body="Create a widget to decide where and how your reels show up on your storefront."
            actionLabel="Create widget"
            actionCommandFor="create-widget-modal"
          />
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
            {widgets.map((widget) => (
              <WidgetCard
                key={widget.id}
                widget={widget}
                onOpen={(w) => setSelectedWidgetId(w.id)}
                onDeleteClick={(w) => setWidgetPendingDelete(w)}
              />
            ))}
          </s-grid>
        )}
      </s-section>

      <CreateWidgetModal reels={reels} />
      <WidgetDetailModal widget={selectedWidget} href={href} onClose={() => setSelectedWidgetId(null)} />
      <WidgetDeleteModal widget={widgetPendingDelete} onClose={() => setWidgetPendingDelete(null)} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
