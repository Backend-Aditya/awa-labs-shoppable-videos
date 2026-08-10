import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { createWidget, listWidgetsForShop } from "../models/widget.server";
import type { WidgetConfig, WidgetKind } from "../models/widget.server";
import type { Widget } from "@prisma/client";

const WIDGET_KINDS: WidgetKind[] = [
  "PRODUCT_PAGE_REELS",
  "CAROUSEL",
  "GRID",
  "STORIES",
  "REEL_POPS",
];

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
  return (
    // Opens a popup instead of navigating — see ReelCard in app.reels.tsx for
    // why: full-page navigation inside the embedded admin iframe repeatedly
    // failed to reach the detail route, while fetcher requests (used here)
    // go through App Bridge's patched fetch() and carry a session token.
    <button
      type="button"
      onClick={() => onOpen(widget)}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "block",
        width: "100%",
        boxSizing: "border-box",
        textAlign: "left",
        color: "inherit",
        border: "1px solid #d9d9d9",
        borderRadius: "8px",
        padding: "12px",
        background: "#ffffff",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "6px" }}>{widget.name}</div>
      <div style={{ color: "#6b6b6b", marginBottom: "8px" }}>{widget.type}</div>
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: "999px",
          fontSize: "12px",
          fontWeight: 500,
          background: widget.published ? "#d1f7dc" : "#e5e5e5",
          color: widget.published ? "#0a6640" : "#444444",
        }}
      >
        {widget.published ? "Published" : "Draft"}
      </span>
    </button>
  );
}

const MODAL_ID = "widget-detail-modal";

type WidgetDetailLoaderData = {
  widget: Widget;
};

function WidgetDetailModal({
  widget,
  onClose,
}: {
  widget: Widget | null;
  onClose: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modalRef = useRef<any>(null);
  const detailFetcher = useFetcher<WidgetDetailLoaderData>();
  const editFetcher = useFetcher<{ error: string | null }>();
  const targetFetcher = useFetcher<{ error: string | null }>();
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();
  const href = widget ? `/app/widgets/${encodeURIComponent(widget.id)}` : null;

  useEffect(() => {
    if (href) {
      modalRef.current?.showOverlay();
      detailFetcher.load(href);
    } else {
      modalRef.current?.hideOverlay();
    }
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
    <s-modal id={MODAL_ID} heading={widget?.name ?? "Widget"} ref={modalRef} onHide={onClose}>
      {!detailWidget ? (
        <s-paragraph>Loading…</s-paragraph>
      ) : (
        <s-stack gap="base">
          <s-paragraph>
            Type: <s-text>{detailWidget.type}</s-text>
          </s-paragraph>

          {editFetcher.data?.error && (
            <s-paragraph tone="critical">{editFetcher.data.error}</s-paragraph>
          )}
          <editFetcher.Form method="post" action={href!}>
            <s-stack gap="base">
              <s-text-field
                label="Name"
                name="name"
                defaultValue={detailWidget.name}
                required
              ></s-text-field>
              <s-checkbox
                label="Published"
                name="published"
                defaultChecked={detailWidget.published}
              ></s-checkbox>
              <s-button
                type="submit"
                variant="primary"
                {...(editFetcher.state !== "idle" ? { loading: true } : {})}
              >
                Save
              </s-button>
            </s-stack>
          </editFetcher.Form>

          <s-stack gap="base">
            {targetFetcher.data?.error && (
              <s-paragraph tone="critical">{targetFetcher.data.error}</s-paragraph>
            )}
            {targetRule?.type === "all_products" ? (
              <s-paragraph>Showing on all products.</s-paragraph>
            ) : (
              <s-stack gap="small">
                <s-paragraph>Targeting {currentHandles.length} product(s):</s-paragraph>
                {currentHandles.map((handle) => (
                  <s-paragraph key={handle}>{handle}</s-paragraph>
                ))}
              </s-stack>
            )}
            <s-button
              onClick={handlePickProducts}
              {...(targetFetcher.state !== "idle" ? { loading: true } : {})}
            >
              Choose products
            </s-button>
            {targetRule?.type === "handles" && (
              <s-button onClick={handleClearTarget} variant="secondary">
                Target all products instead
              </s-button>
            )}
          </s-stack>
        </s-stack>
      )}
      <deleteFetcher.Form
        method="post"
        action={href ?? undefined}
        slot="primary-action"
        onSubmit={(e) => {
          if (!confirm("Delete this widget? This can't be undone.")) {
            e.preventDefault();
            return;
          }
          onClose();
        }}
      >
        <input type="hidden" name="intent" value="delete" />
        <s-button
          type="submit"
          variant="secondary"
          tone="critical"
          {...(deleteFetcher.state !== "idle" ? { loading: true } : {})}
        >
          Delete widget
        </s-button>
      </deleteFetcher.Form>
    </s-modal>
  );
}

export default function Widgets() {
  const { widgets } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const publishedCount = widgets.filter((w) => w.published).length;
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const selectedWidget = widgets.find((w) => w.id === selectedWidgetId) ?? null;

  return (
    <s-page heading="Widgets">
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-box padding="base" background="subdued" borderRadius="base" minInlineSize="140px">
            <s-stack gap="small-200">
              <s-text color="subdued">Total widgets</s-text>
              <s-heading>{widgets.length}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base" minInlineSize="140px">
            <s-stack gap="small-200">
              <s-text color="subdued">Published</s-text>
              <s-heading>{publishedCount}</s-heading>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
      <s-section heading="Create a widget">
        {actionData?.error && (
          <s-paragraph tone="critical">{actionData.error}</s-paragraph>
        )}
        <Form method="post">
          <s-stack gap="base">
            <s-text-field label="Name" name="name" required></s-text-field>
            <s-select
              label="Type"
              name="type"
              placeholder="Select a widget type"
              required
            >
              {WIDGET_KINDS.map((kind) => (
                <s-option key={kind} value={kind}>
                  {kind}
                </s-option>
              ))}
            </s-select>
            <s-button
              type="submit"
              variant="primary"
              {...(isSubmitting ? { loading: true } : {})}
            >
              Create widget
            </s-button>
          </s-stack>
        </Form>
      </s-section>
      <s-section heading="All widgets">
        {widgets.length === 0 ? (
          <s-paragraph>No widgets yet. Create your first one above.</s-paragraph>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: "12px",
            }}
          >
            {widgets.map((widget) => (
              <WidgetCard key={widget.id} widget={widget} onOpen={(w) => setSelectedWidgetId(w.id)} />
            ))}
          </div>
        )}
      </s-section>
      <WidgetDetailModal widget={selectedWidget} onClose={() => setSelectedWidgetId(null)} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
