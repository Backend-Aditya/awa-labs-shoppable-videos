import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useFetchers, useLoaderData, useNavigate, useSearchParams } from "react-router";
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
import { handleRovingKeys } from "../components/widget-editor/controls";
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
    // Go live straight away, unless this type already has a live widget,
    // which publishing would silently take off the store. Then it starts as
    // a draft and the merchant decides when to switch.
    const liveSibling = (await listWidgetsForShop(shop.id)).some(
      (w) => w.type === type && w.published && w.id !== widget.id,
    );
    if (!liveSibling) {
      await updateWidget(admin, shop.id, widget.id, { published: true });
    }
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

function isEmpty(widget: Widget) {
  const config = widget.config as unknown as WidgetConfig;
  return getKindMeta(widget.type)?.reelSelection === "list" ? !config.reelIds?.length : !config.featuredReelId;
}

function CreateWidgetModal({ liveKinds }: { liveKinds: Set<string> }) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [kind, setKind] = useState<WidgetKind>("PRODUCT_PAGE_REELS");
  const [name, setName] = useState("");
  // Errors belong to the attempt that caused them, not the next opening.
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.widgetId) {
      shopify.modal.hide("create-widget-modal");
      navigate(`/app/widgets/${encodeURIComponent(fetcher.data.widgetId)}`);
    }
  }, [fetcher.state, fetcher.data, shopify, navigate]);

  const meta = getKindMeta(kind)!;

  return (
    <s-modal
      id="create-widget-modal"
      heading="Create a widget"
      size="large"
      onHide={() => {
        setKind("PRODUCT_PAGE_REELS");
        setName("");
        setShowError(false);
      }}
    >
      <div className={styles.createBody}>
        {showError && fetcher.data?.error && <s-banner tone="critical">{fetcher.data.error}</s-banner>}
        <div /* eslint-disable-line jsx-a11y/interactive-supports-focus -- roving tabindex: the chosen child is the tab stop */
          className={styles.kindGrid}
          role="radiogroup"
          aria-label="Widget type"
          onKeyDown={(e) => handleRovingKeys(e, WIDGET_KIND_ORDER, kind, setKind)}
        >
          {WIDGET_KIND_ORDER.map((k) => {
            const m = getKindMeta(k)!;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={k === kind}
                tabIndex={k === kind ? 0 : -1}
                className={styles.kindOption}
                onClick={() => setKind(k)}
              >
                <KindSchematic kind={k} />
                <span className={styles.kindName}>{m.name}</span>
                <span className={styles.kindDescription}>{m.description}</span>
                {liveKinds.has(k) && (
                  <span className={styles.kindNote}>One is already live, so this starts as a draft.</span>
                )}
              </button>
            );
          })}
        </div>
        <label className={styles.nameField}>
          <span>Name</span>
          <span className={styles.nameHint}>Only you see this. Shoppers never do.</span>
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
          setShowError(true);
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

// Puts a widget live or back to draft without opening the editor.
function LiveSwitch({
  widget,
  live,
  siblingName,
}: {
  widget: Widget;
  live: boolean;
  siblingName: string | null;
}) {
  const fetcher = useFetcher<{ ok: boolean; error: string | null }>({ key: `publish:${widget.id}` });
  const shopify = useAppBridge();
  const intended = useRef<{ published: boolean; sibling: string | null } | null>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !intended.current || !fetcher.data) return;
    const { published, sibling } = intended.current;
    intended.current = null;
    if (!fetcher.data.ok) {
      shopify.toast.show(fetcher.data.error ?? "Couldn't update the widget. Try again.", { isError: true });
      return;
    }
    shopify.toast.show(
      published ? (sibling ? `${widget.name} is live, “${sibling}” is now a draft` : `${widget.name} is live`) : `${widget.name} is now a draft`,
    );
  }, [fetcher.state, fetcher.data, shopify, widget.name]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={live}
      aria-label={`Show ${widget.name} on your store`}
      title={live ? "Live, click to switch to draft" : "Draft, click to put live"}
      className={styles.liveSwitch}
      disabled={fetcher.state !== "idle"}
      onClick={() => {
        const published = !live;
        intended.current = { published, sibling: published ? siblingName : null };
        const formData = new FormData();
        formData.set("intent", "publish");
        formData.set("published", String(published));
        fetcher.submit(formData, { method: "post", action: `/app/widgets/${encodeURIComponent(widget.id)}` });
      }}
    >
      <span className={styles.liveSwitchThumb} />
    </button>
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
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("create") === "1") {
      shopify.modal.show("create-widget-modal");
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per arrival
  }, []);
  // Optimistic Live/Draft: in-flight switches win over loader data, and a
  // widget going live takes its live sibling of the same type off with it.
  const fetchers = useFetchers();
  const pending = new Map<string, boolean>();
  for (const f of fetchers) {
    if (f.key.startsWith("publish:") && f.formData) {
      pending.set(f.key.slice("publish:".length), f.formData.get("published") === "true");
    }
  }
  const isLive = (w: (typeof widgets)[number]) => {
    if (pending.has(w.id)) return pending.get(w.id)!;
    const goingLive = widgets.some((o) => o.id !== w.id && o.type === w.type && pending.get(o.id) === true);
    return goingLive ? false : w.published;
  };
  const liveCount = widgets.filter(isLive).length;

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
            body="Widgets decide where and how your reels appear, a filmstrip on product pages, stories on the home page, a floating player, and more."
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
              const live = isLive(widget);
              const sibling = widgets.find((o) => o.id !== widget.id && o.type === widget.type && isLive(o));
              return (
                <article key={widget.id} className={styles.widgetCard}>
                  <button type="button" className={styles.widgetOpen} onClick={() => navigate(href)}>
                    <span className={styles.widgetVisual}>
                      <KindSchematic kind={widget.type as WidgetKind} />
                    </span>
                    <span className={styles.widgetBody}>
                      <span className={styles.widgetTitleRow}>
                        <span className={styles.widgetName}>{widget.name}</span>
                        <span className={styles.status} data-live={live || undefined}>
                          {live ? (isEmpty(widget) ? "Live, no videos yet" : "Live") : "Draft"}
                        </span>
                      </span>
                      <span className={styles.widgetKind}>{meta?.name ?? widget.type}</span>
                      <span className={styles.widgetFacts}>
                        <span data-warn={isEmpty(widget) || undefined}>
                          {contentSummary(widget)}
                        </span>
                        <span>{targetSummary(config)}</span>
                      </span>
                    </span>
                  </button>
                  <LiveSwitch widget={widget} live={live} siblingName={sibling?.name ?? null} />
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

      <CreateWidgetModal liveKinds={new Set(widgets.filter((w) => w.published).map((w) => w.type))} />
      <WidgetDeleteModal widget={pendingDelete} onClose={() => setPendingDelete(null)} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
