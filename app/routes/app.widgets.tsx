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

interface WidgetTemplateMeta {
  kind: WidgetKind;
  name: string;
  description: string;
  icon: "layout-rows-2" | "play-circle" | "layout-columns-3" | "images" | "layout-popup";
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
];

const WIDGET_KINDS: WidgetKind[] = WIDGET_TEMPLATES.map((t) => t.kind);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widgets = await listWidgetsForShop(shop.id);
  return { widgets };
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

  await createWidget(shop.id, type as WidgetKind, name, {
    templateStyle: "classic",
    targetRule: { type: "all_products" },
  });

  return { error: null };
};

function WidgetCard({ widget, onOpen }: { widget: Widget; onOpen: (widget: Widget) => void }) {
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
  const showsFeaturedReel = kind === "SINGLE_VIDEO" || kind === "REEL_POPS";
  const showsReelCount = kind === "PRODUCT_PAGE_REELS" || kind === "CAROUSEL" || kind === "STORIES";

  return (
    // Opens a popup instead of navigating — see ReelCard in app.reels.tsx for
    // why: full-page navigation inside the embedded admin iframe repeatedly
    // failed to reach the detail route, while fetcher requests (used here)
    // go through App Bridge's patched fetch() and carry a session token.
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

function CreateWidgetModal() {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedKind, setSelectedKind] = useState<WidgetKind>("PRODUCT_PAGE_REELS");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      shopify.modal.hide("create-widget-modal");
    }
  }, [fetcher.state, fetcher.data, shopify]);

  return (
    <s-modal id="create-widget-modal" heading="Create a widget" accessibilityLabel="Create a widget">
      <fetcher.Form id="create-widget-form" ref={formRef} method="post">
        <s-stack gap="large">
          {fetcher.data?.error && (
            <s-paragraph tone="critical">{fetcher.data.error}</s-paragraph>
          )}
          <s-text-field label="Name" name="name" required></s-text-field>
          <input type="hidden" name="type" value={selectedKind} />

          <s-divider></s-divider>

          <s-stack gap="small-200">
            <s-heading>Template</s-heading>
            <TemplatePicker value={selectedKind} onChange={setSelectedKind} />
          </s-stack>
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

type WidgetDetailLoaderData = {
  widget: Widget;
  reels: { id: string; title: string }[];
};

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
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();
  const publishedRef = useRef<HTMLInputElement>(null);
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
  useEffect(() => {
    if (detailWidget) {
      setSelectedReelIds(
        new Set((detailWidget.config as unknown as WidgetConfig).reelIds ?? []),
      );
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
  const showsFeaturedReel = detailWidget?.type === "SINGLE_VIDEO" || detailWidget?.type === "REEL_POPS";
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
            <editFetcher.Form method="post" action={href ?? undefined}>
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
                <s-button type="submit" variant="primary" loading={editFetcher.state !== "idle"}>
                  Save
                </s-button>
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
                <s-heading>Featured reel</s-heading>
                {featuredReelFetcher.data?.error && (
                  <s-paragraph tone="critical">{featuredReelFetcher.data.error}</s-paragraph>
                )}
                <s-paragraph color="subdued">
                  {(() => {
                    const featuredReelId = (detailWidget.config as unknown as WidgetConfig)
                      .featuredReelId;
                    const reels = detailData?.reels ?? [];
                    const featured = reels.find((r) => r.id === featuredReelId);
                    return featured ? featured.title : "None chosen yet";
                  })()}
                </s-paragraph>
                <featuredReelFetcher.Form method="post" action={href ?? undefined}>
                  <input type="hidden" name="intent" value="set-featured-reel" />
                  <s-stack gap="base">
                    <s-select label="Choose reel" name="featuredReelId" required>
                      {(detailData?.reels ?? []).map((reel) => (
                        <s-option key={reel.id} value={reel.id}>
                          {reel.title}
                        </s-option>
                      ))}
                    </s-select>
                    <s-button
                      type="submit"
                      variant="secondary"
                      loading={featuredReelFetcher.state !== "idle"}
                    >
                      Save featured reel
                    </s-button>
                  </s-stack>
                </featuredReelFetcher.Form>
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
                  Shown by this widget, same set on every targeted product page.
                </s-paragraph>
                <s-box padding="base" background="subdued" borderRadius="base">
                  <s-stack gap="small-200">
                    {(detailData?.reels ?? []).map((reel) => (
                      <s-checkbox
                        key={`${detailWidget.id}-${reel.id}`}
                        label={reel.title}
                        defaultChecked={selectedReelIds.has(reel.id)}
                        onChange={(event: { currentTarget: { checked: boolean } | null }) => {
                          if (!event.currentTarget) return;
                          const checked = event.currentTarget.checked;
                          setSelectedReelIds((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(reel.id);
                            else next.delete(reel.id);
                            return next;
                          });
                        }}
                      ></s-checkbox>
                    ))}
                  </s-stack>
                </s-box>
              </s-stack>
            </>
          )}

          <s-divider></s-divider>

          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-text color="subdued">Deleting a widget can&rsquo;t be undone.</s-text>
            <deleteFetcher.Form
              method="post"
              action={href ?? undefined}
              onSubmit={(e) => {
                // Don't call onClose() here — it sets selectedWidgetId to
                // null synchronously, which can flip href to null before/while
                // the fetcher reads this form's action, sending the delete
                // POST for the wrong (or no) id and 404ing (confirmed live).
                // The modal closes naturally once the widget disappears from
                // the revalidated list after the delete redirect completes.
                if (!confirm("Delete this widget? This can't be undone.")) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <s-button type="submit" variant="tertiary" tone="critical" loading={deleteFetcher.state !== "idle"}>
                Delete widget
              </s-button>
            </deleteFetcher.Form>
          </s-stack>
        </s-stack>
      )}
    </s-modal>
  );
}

export default function Widgets() {
  const { widgets } = useLoaderData<typeof loader>();
  const publishedCount = widgets.filter((w) => w.published).length;
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
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
              <WidgetCard key={widget.id} widget={widget} onOpen={(w) => setSelectedWidgetId(w.id)} />
            ))}
          </s-grid>
        )}
      </s-section>

      <CreateWidgetModal />
      <WidgetDetailModal widget={selectedWidget} href={href} onClose={() => setSelectedWidgetId(null)} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
