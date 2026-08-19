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

interface WidgetTemplateMeta {
  kind: WidgetKind;
  name: string;
  description: string;
}

const WIDGET_TEMPLATES: WidgetTemplateMeta[] = [
  {
    kind: "PRODUCT_PAGE_REELS",
    name: "Product page reels",
    description: "A row of tagged reels on the product page.",
  },
  {
    kind: "SINGLE_VIDEO",
    name: "Single video",
    description: "One featured video, no carousel.",
  },
  {
    kind: "CAROUSEL",
    name: "Stacked carousel",
    description: "Tagged reels as a swipeable stacked deck.",
  },
  {
    kind: "STORIES",
    name: "Insta-style stories",
    description: "Circular avatars that open a full-screen story viewer.",
  },
  {
    kind: "REEL_POPS",
    name: "Reel pops",
    description: "A site-wide floating bubble that expands into a video.",
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
      borderRadius="base"
      commandFor="widget-detail-modal"
      command="--show"
      onClick={() => onOpen(widget)}
    >
      <s-stack gap="small-200">
        <s-text>{widget.name}</s-text>
        <s-text color="subdued">{meta?.name ?? widget.type}</s-text>
        <s-stack direction="inline" gap="small-200">
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
    <s-grid gridTemplateColumns="repeat(auto-fill, minmax(160px, 1fr))" gap="small-200">
      {WIDGET_TEMPLATES.map((template) => (
        <s-clickable
          key={template.kind}
          padding="base"
          background={template.kind === value ? "strong" : "subdued"}
          borderRadius="base"
          onClick={() => onChange(template.kind)}
        >
          <s-stack gap="small-200">
            <s-text>{template.name}</s-text>
            <s-text color="subdued">{template.description}</s-text>
          </s-stack>
        </s-clickable>
      ))}
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
        <s-stack gap="base">
          {fetcher.data?.error && (
            <s-paragraph tone="critical">{fetcher.data.error}</s-paragraph>
          )}
          <s-text-field label="Name" name="name" required></s-text-field>
          <input type="hidden" name="type" value={selectedKind} />
          <TemplatePicker value={selectedKind} onChange={setSelectedKind} />
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
  const detailFetcher = useFetcher<WidgetDetailLoaderData>();
  const editFetcher = useFetcher<{ error: string | null }>();
  const targetFetcher = useFetcher<{ error: string | null }>();
  const featuredReelFetcher = useFetcher<{ error: string | null }>();
  const reelsFetcher = useFetcher<{ error: string | null }>();
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();
  const publishedRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (href) detailFetcher.load(href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);

  useEffect(() => {
    if (href && editFetcher.state === "idle" && editFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editFetcher.state, editFetcher.data]);

  useEffect(() => {
    if (href && targetFetcher.state === "idle" && targetFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFetcher.state, targetFetcher.data]);

  useEffect(() => {
    if (href && featuredReelFetcher.state === "idle" && featuredReelFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuredReelFetcher.state, featuredReelFetcher.data]);

  useEffect(() => {
    if (href && reelsFetcher.state === "idle" && reelsFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reelsFetcher.state, reelsFetcher.data]);

  const detailWidget = detailFetcher.data?.widget ?? null;
  const targetRule = detailWidget
    ? (detailWidget.config as unknown as WidgetConfig).targetRule
    : null;
  const currentHandles = targetRule?.type === "handles" ? targetRule.handles : [];

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

  return (
    <s-modal id="widget-detail-modal" heading={widget?.name ?? "Widget"} accessibilityLabel={widget?.name ?? "Widget"} onHide={onClose}>
      {!detailWidget ? (
        <s-paragraph>Loading…</s-paragraph>
      ) : (
        <s-stack gap="base">
          <s-paragraph>Type: {detailWidget.type}</s-paragraph>

          <s-divider></s-divider>

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
                onChange={(event: { currentTarget: { checked: boolean } }) => {
                  if (publishedRef.current) {
                    publishedRef.current.value = event.currentTarget.checked ? "true" : "";
                  }
                }}
              ></s-checkbox>
              <s-button type="submit" variant="primary" loading={editFetcher.state !== "idle"}>
                Save
              </s-button>
            </s-stack>
          </editFetcher.Form>

          <s-divider></s-divider>

          <s-stack gap="base">
            {targetFetcher.data?.error && (
              <s-paragraph tone="critical">{targetFetcher.data.error}</s-paragraph>
            )}
            {targetRule?.type === "all_products" ? (
              <s-paragraph>Showing on all products.</s-paragraph>
            ) : (
              <s-stack gap="small-200">
                <s-paragraph>Targeting {currentHandles.length} product(s):</s-paragraph>
                {currentHandles.map((handle) => (
                  <s-paragraph key={handle}>{handle}</s-paragraph>
                ))}
              </s-stack>
            )}
            <s-stack direction="inline" gap="small-200">
              <s-button
                variant="secondary"
                onClick={handlePickProducts}
                loading={targetFetcher.state !== "idle"}
              >
                Choose products
              </s-button>
              {targetRule?.type === "handles" && (
                <s-button variant="tertiary" onClick={handleClearTarget}>
                  Target all products instead
                </s-button>
              )}
            </s-stack>
          </s-stack>

          {(detailWidget.type === "SINGLE_VIDEO" || detailWidget.type === "REEL_POPS") && (
            <>
              <s-divider></s-divider>
              <s-stack gap="base">
                {featuredReelFetcher.data?.error && (
                  <s-paragraph tone="critical">{featuredReelFetcher.data.error}</s-paragraph>
                )}
                <s-paragraph>
                  Featured reel:{" "}
                  {(() => {
                    const featuredReelId = (detailWidget.config as unknown as WidgetConfig)
                      .featuredReelId;
                    const reels = detailFetcher.data?.reels ?? [];
                    const featured = reels.find((r) => r.id === featuredReelId);
                    return featured ? featured.title : "None chosen yet";
                  })()}
                </s-paragraph>
                <featuredReelFetcher.Form method="post" action={href ?? undefined}>
                  <input type="hidden" name="intent" value="set-featured-reel" />
                  <s-stack gap="base">
                    <s-select label="Choose reel" name="featuredReelId" required>
                      {(detailFetcher.data?.reels ?? []).map((reel) => (
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

          {(detailWidget.type === "PRODUCT_PAGE_REELS" ||
            detailWidget.type === "CAROUSEL" ||
            detailWidget.type === "STORIES") && (
            <>
              <s-divider></s-divider>
              <s-stack gap="base">
                {reelsFetcher.data?.error && (
                  <s-paragraph tone="critical">{reelsFetcher.data.error}</s-paragraph>
                )}
                <s-paragraph>
                  Reels shown by this widget (same set on every targeted product page):
                </s-paragraph>
                <reelsFetcher.Form method="post" action={href ?? undefined}>
                  <input type="hidden" name="intent" value="set-reels" />
                  <s-stack gap="small-200">
                    {(detailFetcher.data?.reels ?? []).map((reel) => (
                      <s-checkbox
                        key={reel.id}
                        label={reel.title}
                        name="reelId"
                        value={reel.id}
                        defaultChecked={(
                          (detailWidget.config as unknown as WidgetConfig).reelIds ?? []
                        ).includes(reel.id)}
                      ></s-checkbox>
                    ))}
                  </s-stack>
                  <s-button
                    type="submit"
                    variant="secondary"
                    loading={reelsFetcher.state !== "idle"}
                  >
                    Save reels
                  </s-button>
                </reelsFetcher.Form>
              </s-stack>
            </>
          )}

          <s-divider></s-divider>

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
            <s-button type="submit" variant="secondary" tone="critical" loading={deleteFetcher.state !== "idle"}>
              Delete widget
            </s-button>
          </deleteFetcher.Form>
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
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Total widgets</s-text>
              <s-heading>{widgets.length}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Published</s-text>
              <s-heading>{publishedCount}</s-heading>
            </s-stack>
          </s-box>
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
