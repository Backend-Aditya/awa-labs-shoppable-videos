import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { createWidget, listWidgetsForShop, updateWidget } from "../models/widget.server";
import { WIDGET_KIND_ORDER, getKindMeta } from "../models/widget-kinds";
import type { WidgetConfig, WidgetKind } from "../models/widget-kinds";
import type { Widget } from "@prisma/client";
import { EmptyState } from "../components/EmptyState";
import { KindSchematic } from "../components/widget-editor/KindSchematic";
import styles from "../components/widget-editor/list.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widgets = await listWidgetsForShop(shop.id);
  return { widgets };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const type = String(formData.get("type") ?? "");
  const meta = getKindMeta(type);
  const name = String(formData.get("name") ?? "").trim() || meta?.name || "";

  if (!meta) {
    return { error: "Choose a widget type.", widgetId: null };
  }

  const config: WidgetConfig = {
    templateStyle: "classic",
    targetRule: { type: "all_products" },
  };

  try {
    const widget = await createWidget(shop.id, type as WidgetKind, name, config);
    // Created live: updateWidget (not a raw write) keeps the one-live-per-
    // kind invariant and the storefront metafield sync identical to a
    // manual publish.
    await updateWidget(admin, shop.id, widget.id, { published: true });
    return { error: null, widgetId: widget.id };
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: "Couldn't create the widget. Try again.", widgetId: null };
  }
};

function targetSummary(config: WidgetConfig) {
  const rule = config.targetRule;
  if (!rule || rule.type === "all_products") return "Everywhere";
  const n = rule.handles.length;
  return rule.type === "collections"
    ? `${n} collection${n === 1 ? "" : "s"}`
    : `${n} product${n === 1 ? "" : "s"}`;
}

function contentSummary(widget: Widget) {
  const config = widget.config as unknown as WidgetConfig;
  const meta = getKindMeta(widget.type);
  if (meta?.reelSelection === "list") {
    const n = config.reelIds?.length ?? 0;
    return n === 0 ? "No videos yet" : `${n} video${n === 1 ? "" : "s"}`;
  }
  return config.featuredReelId ? "1 video" : "No video yet";
}

function CreateWidgetModal() {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [kind, setKind] = useState<WidgetKind>("PRODUCT_PAGE_REELS");
  const [name, setName] = useState("");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.widgetId) {
      shopify.modal.hide("create-widget-modal");
      navigate(`/app/widgets/${encodeURIComponent(fetcher.data.widgetId)}`);
    }
  }, [fetcher.state, fetcher.data, shopify, navigate]);

  const meta = getKindMeta(kind)!;

  return (
    <s-modal id="create-widget-modal" heading="Create a widget" size="large">
      <div className={styles.createBody}>
        {fetcher.data?.error && <s-banner tone="critical">{fetcher.data.error}</s-banner>}
        <div className={styles.kindGrid} role="radiogroup" aria-label="Widget type">
          {WIDGET_KIND_ORDER.map((k) => {
            const m = getKindMeta(k)!;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={k === kind}
                className={styles.kindOption}
                onClick={() => setKind(k)}
              >
                <KindSchematic kind={k} />
                <span className={styles.kindName}>{m.name}</span>
                <span className={styles.kindDescription}>{m.description}</span>
              </button>
            );
          })}
        </div>
        <label className={styles.nameField}>
          <span>Name</span>
          <input
            type="text"
            value={name}
            maxLength={80}
            placeholder={meta.name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </label>
      </div>
      <s-button
        slot="primary-action"
        variant="primary"
        loading={fetcher.state !== "idle"}
        onClick={() => {
          const formData = new FormData();
          formData.set("type", kind);
          formData.set("name", name);
          fetcher.submit(formData, { method: "post" });
        }}
      >
        Create and customize
      </s-button>
      <s-button slot="secondary-actions" commandFor="create-widget-modal" command="--hide">
        Cancel
      </s-button>
    </s-modal>
  );
}

function WidgetDeleteModal({ widget, onClose }: { widget: Widget | null; onClose: () => void }) {
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();
  const submittedRef = useRef(false);

  useEffect(() => {
    if (submittedRef.current && deleteFetcher.state === "idle") {
      submittedRef.current = false;
      shopify.modal.hide("widget-delete-modal");
      shopify.toast.show("Widget deleted");
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteFetcher.state]);

  return (
    <s-modal id="widget-delete-modal" heading="Delete this widget?" onHide={onClose}>
      <s-paragraph>
        {widget ? <strong>{widget.name}</strong> : "This widget"} will be removed from your store. Your reels stay in
        the library.
      </s-paragraph>
      <s-button
        slot="primary-action"
        variant="primary"
        tone="critical"
        loading={deleteFetcher.state !== "idle"}
        onClick={() => {
          if (!widget) return;
          submittedRef.current = true;
          const formData = new FormData();
          formData.set("intent", "delete");
          deleteFetcher.submit(formData, {
            method: "post",
            action: `/app/widgets/${encodeURIComponent(widget.id)}`,
          });
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
  const { widgets } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [pendingDelete, setPendingDelete] = useState<Widget | null>(null);
  const liveCount = widgets.filter((w) => w.published).length;

  return (
    <s-page heading="Widgets" inlineSize="large">
      <s-button slot="primary-action" variant="primary" commandFor="create-widget-modal" command="--show">
        Create widget
      </s-button>

      {widgets.length === 0 ? (
        <s-section>
          <EmptyState
            icon="apps"
            heading="Put your videos on the storefront"
            body="Widgets decide where and how your reels appear — a filmstrip on product pages, stories on the home page, a floating player, and more."
            actionLabel="Create widget"
            actionCommandFor="create-widget-modal"
          />
        </s-section>
      ) : (
        <s-section>
          <div className={styles.listHeader}>
            <p>
              {liveCount} of {widgets.length} live. One widget of each type can be live at a time.
            </p>
          </div>
          <div className={styles.widgetGrid}>
            {widgets.map((widget) => {
              const meta = getKindMeta(widget.type);
              const config = widget.config as unknown as WidgetConfig;
              const href = `/app/widgets/${encodeURIComponent(widget.id)}`;
              return (
                <article key={widget.id} className={styles.widgetCard}>
                  <button type="button" className={styles.widgetOpen} onClick={() => navigate(href)}>
                    <span className={styles.widgetVisual}>
                      <KindSchematic kind={widget.type as WidgetKind} />
                    </span>
                    <span className={styles.widgetBody}>
                      <span className={styles.widgetTitleRow}>
                        <span className={styles.widgetName}>{widget.name}</span>
                        <span className={styles.status} data-live={widget.published || undefined}>
                          {widget.published ? "Live" : "Draft"}
                        </span>
                      </span>
                      <span className={styles.widgetKind}>{meta?.name ?? widget.type}</span>
                      <span className={styles.widgetFacts}>
                        <span>{contentSummary(widget)}</span>
                        <span>{targetSummary(config)}</span>
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.widgetDelete}
                    aria-label={`Delete ${widget.name}`}
                    onClick={() => {
                      setPendingDelete(widget);
                      shopify.modal.show("widget-delete-modal");
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d="M8.5 3a1 1 0 0 0-1 1v.5H5a.75.75 0 0 0 0 1.5h.3l.62 9.3A2 2 0 0 0 7.9 17h4.2a2 2 0 0 0 2-1.7l.6-9.3h.3a.75.75 0 0 0 0-1.5h-2.5V4a1 1 0 0 0-1-1h-3Zm2.5 1.5V4.5H9v0h2Zm-4.2 1.5h6.4l-.6 9.2a.5.5 0 0 1-.5.3H7.9a.5.5 0 0 1-.5-.3L6.8 6Z" />
                    </svg>
                  </button>
                </article>
              );
            })}
          </div>
        </s-section>
      )}

      <CreateWidgetModal />
      <WidgetDeleteModal widget={pendingDelete} onClose={() => setPendingDelete(null)} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
