import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
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
  const reelIds = formData.getAll("reelId").map(String).filter(Boolean);
  const featuredReelId = String(formData.get("featuredReelId") ?? "").trim();

  const config: WidgetConfig = {
    templateStyle: "classic",
    targetRule:
      productHandles.length > 0 ? { type: "handles", handles: productHandles } : { type: "all_products" },
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
  const [selectedReelIds, setSelectedReelIds] = useState<Set<string>>(new Set());
  const [selectedFeaturedReelId, setSelectedFeaturedReelId] = useState<string | null>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      shopify.modal.hide("create-widget-modal");
      setTargetProducts([]);
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
              <s-heading>Target products (optional)</s-heading>
              <s-button type="button" variant="secondary" onClick={handlePickTargetProducts}>
                {targetProducts.length === 0 ? "Choose products" : "Edit"}
              </s-button>
            </s-stack>
            {targetProducts.length === 0 ? (
              <s-paragraph color="subdued">Shows on all products by default.</s-paragraph>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--p-space-200, 8px)" }}>
                {targetProducts.map((product) => (
                  <s-badge key={product.id}>{product.title}</s-badge>
                ))}
              </div>
            )}
            {targetProducts.map((product) => (
              <input key={product.id} type="hidden" name="productHandle" value={product.handle} />
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
  const shopify = useAppBridge();
  const publishedRef = useRef<HTMLInputElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);
  const { data: detailData } = useResourceDetail<WidgetDetailLoaderData>(href, [
    editFetcher,
    targetFetcher,
    featuredReelFetcher,
    reelsFetcher,
  ]);
  const detailWidget = detailData?.widget ?? null;
  const targetRule = detailWidget
    ? (detailWidget.config as unknown as WidgetConfig).targetRule
    : null;
  const currentHandles = targetRule?.type === "handles" ? targetRule.handles : [];

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
              <s-heading>Target products</s-heading>
              <s-stack direction="inline" gap="small-200">
                <s-button
                  variant="secondary"
                  onClick={handlePickProducts}
                  loading={targetFetcher.state !== "idle"}
                >
                  Choose products
                </s-button>
                {targetRule?.type === "handles" && (
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
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--p-space-200, 8px)" }}>
                {currentHandles.map((handle) => (
                  <s-badge key={handle}>{handle}</s-badge>
                ))}
              </div>
            )}
          </s-stack>

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
        <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
          <StatTile label="Total widgets" value={widgets.length} icon="hashtag" />
          <StatTile label="Published" value={publishedCount} icon="check-circle" />
        </s-grid>
      </s-section>

      <s-section heading="All widgets">
        {widgets.length === 0 ? (
          <s-paragraph>No widgets yet. Use Create widget to add your first one.</s-paragraph>
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
