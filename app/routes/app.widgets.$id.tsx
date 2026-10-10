import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { createWidget, deleteWidget, getWidget, saveWidgetSettings } from "../models/widget.server";
import {
  PAGE_TYPE_OPTIONS,
  getKindMeta,
  resolveStyle,
  sanitizeStyle,
} from "../models/widget-kinds";
import type {
  StyleFieldKey,
  TargetRule,
  WidgetConfig,
  WidgetKind,
  WidgetKindMeta,
  WidgetStyleConfig,
} from "../models/widget-kinds";
import { getProductsByIds, listReels } from "../models/reel.server";
import { getBrand } from "../models/brand.server";
import type { BrandConfig } from "../models/brand";
import type { ReelConfig } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import {
  Card,
  ChipToggleGroup,
  ColorInput,
  Field,
  Segmented,
  Slider,
  TextInput,
  Toggle,
} from "../components/widget-editor/controls";
import { WidgetPreview, formatDuration } from "../components/widget-editor/WidgetPreview";
import type { PreviewReel } from "../components/widget-editor/WidgetPreview";
import styles from "../components/widget-editor/editor.module.css";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widget = await getWidget(shop.id, params.id!);
  if (!widget) {
    throw new Response("Widget not found", { status: 404 });
  }

  const reels = await listReels(admin, 50);

  // First two tagged products per reel are enough for every preview layout
  // (filmstrip shows one, the feature/viewer panels show up to three of the
  // first reel). Bounded so a large library can't blow up the query.
  const productIds = [...new Set(reels.flatMap((r) => (r.config.productIds ?? []).slice(0, 3)))].slice(0, 100);
  let products: Awaited<ReturnType<typeof getProductsByIds>> = [];
  try {
    products = await getProductsByIds(admin, productIds);
  } catch (e) {
    if (e instanceof Response) throw e;
    // Preview-only data — the editor still works with placeholder products.
  }

  return {
    widget,
    brand: await getBrand(shop.id),
    shopDomain: session.shop,
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    reels: reels.map((reel) => ({
      id: reel.id,
      title: reel.title,
      published: reel.published,
      config: {
        posterUrl: reel.config.posterUrl,
        hlsManifestUrl: reel.config.hlsManifestUrl,
        cloudflareStreamUid: reel.config.cloudflareStreamUid,
        uploadFailedAt: reel.config.uploadFailedAt,
        durationSeconds: reel.config.durationSeconds,
        productIds: reel.config.productIds ?? [],
      },
    })),
    products,
  };
};

type ActionResult = { ok: boolean; error: string | null; duplicatedId?: string; deleted?: boolean };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widget = await getWidget(shop.id, params.id!);
  if (!widget) {
    throw new Response("Widget not found", { status: 404 });
  }

  // Response throws (session-token expiry, rate-limit) are Shopify's own
  // control flow and must keep propagating; anything else becomes an inline
  // error on the page the merchant is already looking at.
  try {
    if (request.headers.get("Content-Type")?.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      return await saveFromPayload(body);
    }

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "delete") {
      await deleteWidget(admin, shop.id, widget.id);
      return { ok: true, error: null, deleted: true };
    }

    if (intent === "duplicate") {
      // Unpublished copy — the one-live-widget-per-kind rule means a
      // published duplicate would silently take the original offline.
      const copy = await createWidget(
        shop.id,
        widget.type as WidgetKind,
        `${widget.name} (copy)`,
        widget.config as unknown as WidgetConfig,
      );
      return { ok: true, error: null, duplicatedId: copy.id };
    }

    return { ok: false, error: "Unknown action" };
  } catch (e) {
    if (e instanceof Response) throw e;
    return { ok: false, error: "Couldn't save. Check your connection and try again." };
  }

  async function saveFromPayload(body: Record<string, unknown>): Promise<ActionResult> {
    const name = String(body.name ?? "").trim().slice(0, 80);
    if (!name) return { ok: false, error: "Add a name for this widget." };

    const meta = getKindMeta(widget!.type);
    if (!meta) return { ok: false, error: "This widget type can't be edited." };

    const rawTarget = body.targetRule as { type?: string; handles?: unknown } | undefined;
    const handles = Array.isArray(rawTarget?.handles)
      ? rawTarget!.handles.map(String).filter(Boolean).slice(0, 250)
      : [];
    const targetRule: TargetRule =
      (rawTarget?.type === "handles" || rawTarget?.type === "collections") && handles.length > 0
        ? { type: rawTarget.type, handles }
        : { type: "all_products" };

    const deviceVisibility = ["all", "desktop", "mobile"].includes(String(body.deviceVisibility))
      ? (body.deviceVisibility as "all" | "desktop" | "mobile")
      : "all";

    const allowedPages = new Set(PAGE_TYPE_OPTIONS.map((o) => o.value));
    const pageTypes = Array.isArray(body.pageTypes)
      ? body.pageTypes.map(String).filter((p) => allowedPages.has(p))
      : [];

    // Only ids that still exist in the library can be persisted — a stale
    // metaobject reference would make every later metafield sync for this
    // kind fail (it's written in the same metafieldsSet call).
    const validReelIds = new Set((await listReels(admin, 50)).map((r) => r.id));
    let reelIds: string[] | undefined;
    let featuredReelId: string | undefined;
    if (meta.reelSelection === "list") {
      reelIds = Array.isArray(body.reelIds)
        ? [...new Set(body.reelIds.map(String))].filter((id) => validReelIds.has(id))
        : [];
    } else {
      const candidate = String(body.featuredReelId ?? "");
      featuredReelId = validReelIds.has(candidate) ? candidate : "";
    }

    await saveWidgetSettings(admin, shop.id, widget!.id, {
      name,
      published: body.published === true,
      targetRule,
      deviceVisibility,
      pageTypes,
      reelIds,
      featuredReelId,
      style: sanitizeStyle(widget!.type, body.style),
    });
    return { ok: true, error: null };
  }
};

/* ---------------------------------------------------------------- state */

interface EditorState {
  name: string;
  published: boolean;
  targetRule: TargetRule;
  deviceVisibility: "all" | "desktop" | "mobile";
  pageTypes: string[];
  reelIds: string[];
  featuredReelId: string;
  style: WidgetStyleConfig;
}

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;
type EditorReel = LoaderData["reels"][number];

function stateFromWidget(widget: LoaderData["widget"]): EditorState {
  const config = widget.config as unknown as WidgetConfig;
  return {
    name: widget.name,
    published: widget.published,
    targetRule: config.targetRule ?? { type: "all_products" },
    deviceVisibility: config.deviceVisibility ?? "all",
    pageTypes: config.pageTypes ?? [],
    reelIds: config.reelIds ?? [],
    featuredReelId: config.featuredReelId ?? "",
    style: resolveStyle(widget.type, config.style),
  };
}

const TABS = [
  { id: "content", label: "Content" },
  { id: "design", label: "Design" },
  { id: "viewer", label: "Shopping" },
  { id: "visibility", label: "Visibility" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function WidgetEditor() {
  const { widget, reels, products, brand, shopDomain, apiKey } = useLoaderData<typeof loader>();
  const meta = getKindMeta(widget.type);
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const saveFetcher = useFetcher<ActionResult>();
  const actionFetcher = useFetcher<ActionResult>();

  const baseline = useMemo(() => stateFromWidget(widget), [widget]);
  const [state, setState] = useState<EditorState>(baseline);
  const [tab, setTab] = useState<TabId>("content");

  // Fresh loader data (after a save or an external change) becomes the new
  // baseline. Keyed on updatedAt so typing isn't clobbered by unrelated
  // revalidations that return the same row.
  const baselineKey = `${widget.id}:${String(widget.updatedAt)}`;
  const lastKey = useRef(baselineKey);
  useEffect(() => {
    if (lastKey.current !== baselineKey) {
      lastKey.current = baselineKey;
      setState(baseline);
    }
  }, [baselineKey, baseline]);

  const dirty = JSON.stringify(state) !== JSON.stringify(baseline);
  const saving = saveFetcher.state !== "idle";

  useEffect(() => {
    if (saveFetcher.state === "idle" && saveFetcher.data) {
      if (saveFetcher.data.ok) shopify.toast.show("Widget saved");
      else if (saveFetcher.data.error) shopify.toast.show(saveFetcher.data.error, { isError: true });
    }
  }, [saveFetcher.state, saveFetcher.data, shopify]);

  useEffect(() => {
    const data = actionFetcher.data;
    if (actionFetcher.state !== "idle" || !data) return;
    if (data.deleted) {
      shopify.toast.show("Widget deleted");
      navigate("/app/widgets");
    } else if (data.duplicatedId) {
      shopify.toast.show("Copy created as a draft");
      navigate(`/app/widgets/${encodeURIComponent(data.duplicatedId)}`);
    } else if (data.error) {
      shopify.toast.show(data.error, { isError: true });
    }
  }, [actionFetcher.state, actionFetcher.data, navigate, shopify]);

  if (!meta) {
    return (
      <s-page heading={widget.name}>
        <s-section>
          <s-paragraph>This widget type is no longer supported. Delete it from the widgets list.</s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const update = (patch: Partial<EditorState>) => setState((prev) => ({ ...prev, ...patch }));
  const setStyle = (patch: Partial<WidgetStyleConfig>) =>
    setState((prev) => ({ ...prev, style: { ...prev.style, ...patch } }));

  const save = () => {
    saveFetcher.submit(JSON.stringify(state), { method: "post", encType: "application/json" });
  };

  const previewReels = buildPreviewReels(meta, state, reels, products);

  return (
    <s-page heading={state.name || widget.name} inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app/widgets">
        Widgets
      </s-link>
      <s-button
        slot="secondary-actions"
        onClick={() => {
          const formData = new FormData();
          formData.set("intent", "duplicate");
          actionFetcher.submit(formData, { method: "post" });
        }}
      >
        Duplicate
      </s-button>
      <s-button slot="secondary-actions" tone="critical" commandFor="delete-widget-modal" command="--show">
        Delete
      </s-button>

      <SaveBar id="widget-save-bar" open={dirty}>
        <button variant="primary" onClick={save} loading={saving ? "" : undefined} disabled={saving}>
          Save
        </button>
        <button onClick={() => setState(baseline)} disabled={saving}>
          Discard
        </button>
      </SaveBar>

      <div className={styles.shell}>
        <div className={styles.settingsColumn}>
          <div className={styles.statusBar}>
            <span className={styles.statusDot} data-live={state.published || undefined} />
            <div className={styles.statusText}>
              <p className={styles.statusTitle}>{state.published ? "Live on your store" : "Draft"}</p>
              <p className={styles.hint}>
                {meta.name} · {meta.placement}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.published}
              aria-label="Show on store"
              className={styles.switch}
              onClick={() => update({ published: !state.published })}
            >
              <span className={styles.switchThumb} />
            </button>
          </div>

          <div className={styles.tabs} role="tablist" aria-label="Widget settings">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                className={styles.tab}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={styles.tabPanel} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "content" && (
              <ContentTab meta={meta} state={state} reels={reels} update={update} setStyle={setStyle} />
            )}
            {tab === "design" && <DesignTab meta={meta} style={state.style} setStyle={setStyle} brand={brand} />}
            {tab === "viewer" && <ShoppingTab meta={meta} style={state.style} setStyle={setStyle} brand={brand} />}
            {tab === "visibility" && (
              <VisibilityTab meta={meta} state={state} update={update} shopDomain={shopDomain} apiKey={apiKey} />
            )}
          </div>
        </div>

        <div className={styles.previewColumn}>
          <WidgetPreview kind={widget.type as WidgetKind} style={state.style} reels={previewReels} brand={brand} />
        </div>
      </div>

      <s-modal id="delete-widget-modal" heading="Delete this widget?">
        <s-paragraph>
          {widget.name} will be removed from your store. Your reels stay in the library.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={actionFetcher.state !== "idle"}
          onClick={() => {
            const formData = new FormData();
            formData.set("intent", "delete");
            actionFetcher.submit(formData, { method: "post" });
          }}
        >
          Delete widget
        </s-button>
        <s-button slot="secondary-actions" commandFor="delete-widget-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

function buildPreviewReels(
  meta: WidgetKindMeta,
  state: EditorState,
  reels: EditorReel[],
  products: LoaderData["products"],
): PreviewReel[] {
  const ids = meta.reelSelection === "list" ? state.reelIds : state.featuredReelId ? [state.featuredReelId] : [];
  const productById = new Map(products.map((p) => [p.id, p]));
  return ids
    .map((id) => reels.find((r) => r.id === id))
    .filter((r): r is EditorReel => Boolean(r))
    .map((reel) => ({
      id: reel.id,
      title: reel.title,
      posterUrl: reel.config.posterUrl,
      durationSeconds: reel.config.durationSeconds,
      products: reel.config.productIds
        .map((pid) => productById.get(pid))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map((p) => ({
          id: p.id,
          title: p.title,
          imageUrl: p.imageUrl,
          price: p.priceRange ? formatMoney(p.priceRange.min, p.priceRange.currencyCode) : "",
        })),
    }));
}

function formatMoney(amount: string, currencyCode: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(Number(amount));
  } catch {
    return amount;
  }
}

/* ------------------------------------------------------------- content */

function reelStatusText(reel: EditorReel) {
  const status = deriveReelStatus(reel.config as ReelConfig);
  if (status === "failed") return "Upload failed";
  if (status === "processing") return "Processing";
  if (status === "draft") return "No video yet";
  if (!reel.published) return "Not published — hidden on store";
  return formatDuration(reel.config.durationSeconds) || "Ready";
}

function ReelThumb({ reel }: { reel: EditorReel }) {
  return (
    <span
      className={styles.reelThumb}
      style={reel.config.posterUrl ? { backgroundImage: `url("${reel.config.posterUrl}")` } : undefined}
    />
  );
}

function ContentTab({
  meta,
  state,
  reels,
  update,
  setStyle,
}: {
  meta: WidgetKindMeta;
  state: EditorState;
  reels: EditorReel[];
  update: (patch: Partial<EditorState>) => void;
  setStyle: (patch: Partial<WidgetStyleConfig>) => void;
}) {
  const has = (key: StyleFieldKey) => meta.fields.includes(key);
  const showText = has("heading") || has("watchLabel") || has("bubbleLabel");

  return (
    <>
      <Card title="Name" description="Only you see this — it identifies the widget in the admin.">
        <TextInput label="Widget name" value={state.name} onChange={(name) => update({ name })} />
      </Card>

      {meta.reelSelection === "list" ? (
        <ReelListPicker reels={reels} selected={state.reelIds} onChange={(reelIds) => update({ reelIds })} />
      ) : (
        <Card title="Video" description="The one video this widget plays.">
          {reels.length === 0 ? (
            <p className={styles.emptyNote}>Upload a reel in the Reels library first.</p>
          ) : (
            <div className={styles.reelList} role="radiogroup" aria-label="Video">
              {reels.map((reel) => (
                <button
                  key={reel.id}
                  type="button"
                  role="radio"
                  aria-checked={state.featuredReelId === reel.id}
                  className={styles.reelRow}
                  onClick={() => update({ featuredReelId: reel.id })}
                >
                  <ReelThumb reel={reel} />
                  <span className={styles.reelMeta}>
                    <span className={styles.reelTitle}>{reel.title}</span>
                    <span className={styles.reelSub}>{reelStatusText(reel)}</span>
                  </span>
                  <span className={styles.reelCheck}>
                    {state.featuredReelId === reel.id && <CheckIcon />}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {showText && (
        <Card title="Text">
          {has("heading") && (
            <TextInput
              label="Heading"
              value={state.style.heading ?? ""}
              placeholder="No heading"
              hint="Leave empty to hide the heading."
              onChange={(heading) => setStyle({ heading })}
            />
          )}
          {has("watchLabel") && (
            <TextInput
              label="Label"
              value={state.style.watchLabel ?? ""}
              placeholder="Watch video"
              onChange={(watchLabel) => setStyle({ watchLabel })}
            />
          )}
          {has("bubbleLabel") && (
            <TextInput
              label="Bubble label"
              value={state.style.bubbleLabel ?? ""}
              placeholder="No label"
              hint="Short text shown beside the player. Leave empty for the player alone."
              onChange={(bubbleLabel) => setStyle({ bubbleLabel })}
            />
          )}
        </Card>
      )}
    </>
  );
}

function ReelListPicker({
  reels,
  selected,
  onChange,
}: {
  reels: EditorReel[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const byId = new Map(reels.map((r) => [r.id, r]));
  const chosen = selected.map((id) => byId.get(id)).filter((r): r is EditorReel => Boolean(r));
  const available = reels.filter((r) => !selected.includes(r.id));

  const move = (index: number, delta: number) => {
    const next = [...selected];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };

  return (
    <Card
      title="Videos"
      description={chosen.length === 0 ? "Pick the videos to show, in order." : `${chosen.length} selected · shown in this order`}
    >
      {chosen.length > 0 && (
        <ol className={styles.orderList}>
          {chosen.map((reel, index) => (
            <li key={reel.id} className={styles.orderItem}>
              <span className={styles.orderIndex}>{index + 1}</span>
              <ReelThumb reel={reel} />
              <span className={styles.reelMeta}>
                <span className={styles.reelTitle}>{reel.title}</span>
                <span className={styles.reelSub}>{reelStatusText(reel)}</span>
              </span>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Move ${reel.title} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowIcon dir="up" />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Move ${reel.title} down`}
                disabled={index === chosen.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowIcon dir="down" />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Remove ${reel.title}`}
                onClick={() => onChange(selected.filter((id) => id !== reel.id))}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ol>
      )}

      {reels.length === 0 ? (
        <p className={styles.emptyNote}>Upload a reel in the Reels library first.</p>
      ) : available.length > 0 ? (
        <Field label="Add videos">
          <div className={styles.reelList}>
            {available.map((reel) => (
              <button
                key={reel.id}
                type="button"
                className={styles.reelRow}
                onClick={() => onChange([...selected, reel.id])}
              >
                <ReelThumb reel={reel} />
                <span className={styles.reelMeta}>
                  <span className={styles.reelTitle}>{reel.title}</span>
                  <span className={styles.reelSub}>{reelStatusText(reel)}</span>
                </span>
                <PlusIcon />
              </button>
            ))}
          </div>
        </Field>
      ) : (
        <p className={styles.hint}>Every video in your library is in this widget.</p>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------- design */

interface Look {
  name: string;
  style: WidgetStyleConfig;
  swatch: { bg: string; pill: string; radius: number };
}

const LOOKS: Look[] = [
  {
    name: "Brand",
    style: { cornerStyle: "rounded", shadowPreset: "none", ctaStyle: "pill", accentColor: "", ctaColor: "", ctaTextColor: "", backgroundColor: "" },
    swatch: { bg: "#f4f4f4", pill: "#141414", radius: 999 },
  },
  {
    name: "Editorial",
    style: { cornerStyle: "sharp", shadowPreset: "none", ctaStyle: "text-link", accentColor: "#1d1d1b", ctaColor: "#1d1d1b", ctaTextColor: "#ffffff", backgroundColor: "#efebe4" },
    swatch: { bg: "#efebe4", pill: "#1d1d1b", radius: 0 },
  },
  {
    name: "Vivid",
    style: { cornerStyle: "soft", shadowPreset: "bold", ctaStyle: "pill", accentColor: "#5b3df5", ctaColor: "#5b3df5", ctaTextColor: "#ffffff", backgroundColor: "" },
    swatch: { bg: "#ebe7ff", pill: "#5b3df5", radius: 999 },
  },
];

const ICON_FILMSTRIP = (
  <svg width="36" height="22" viewBox="0 0 36 22" aria-hidden="true">
    <rect x="1" y="2" width="9" height="16" rx="2" fill="currentColor" />
    <rect x="13" y="2" width="9" height="16" rx="2" fill="currentColor" opacity=".55" />
    <rect x="25" y="2" width="9" height="16" rx="2" fill="currentColor" opacity=".3" />
  </svg>
);
const ICON_GRID = (
  <svg width="36" height="22" viewBox="0 0 36 22" aria-hidden="true">
    {[0, 1, 2, 3].map((i) => (
      <rect key={i} x={2 + i * 8.5} y="2" width="7" height="8" rx="1.5" fill="currentColor" />
    ))}
    {[0, 1, 2, 3].map((i) => (
      <rect key={i} x={2 + i * 8.5} y="12" width="7" height="8" rx="1.5" fill="currentColor" opacity=".55" />
    ))}
  </svg>
);
const ICON_STACK = (
  <svg width="36" height="22" viewBox="0 0 36 22" aria-hidden="true">
    <rect x="4" y="5" width="8" height="13" rx="2" fill="currentColor" opacity=".3" />
    <rect x="24" y="5" width="8" height="13" rx="2" fill="currentColor" opacity=".3" />
    <rect x="12" y="1" width="12" height="20" rx="2" fill="currentColor" />
  </svg>
);

function DesignTab({
  meta,
  style,
  setStyle,
  brand,
}: {
  meta: WidgetKindMeta;
  style: WidgetStyleConfig;
  setStyle: (patch: Partial<WidgetStyleConfig>) => void;
  brand: BrandConfig;
}) {
  const has = (key: StyleFieldKey) => meta.fields.includes(key);
  const applyLook = (look: Look) => {
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(look.style)) {
      if (has(key as StyleFieldKey)) patch[key] = value;
    }
    setStyle(patch as Partial<WidgetStyleConfig>);
  };
  const showLooks = has("cornerStyle") || has("ctaStyle");
  const showCardDetails = has("showCaption") || has("showDuration") || has("showProductPreview");

  return (
    <>
      {showLooks && (
        <Card title="Looks" description="A starting point — fine-tune anything below.">
          <div className={styles.looks}>
            {LOOKS.map((look) => (
              <button key={look.name} type="button" className={styles.look} onClick={() => applyLook(look)}>
                <span className={styles.lookSwatch} style={{ background: look.swatch.bg }}>
                  <span
                    className={styles.lookPill}
                    style={{ background: look.swatch.pill, borderRadius: look.swatch.radius }}
                  />
                </span>
                <span className={styles.lookName}>{look.name}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card title="Layout">
        {has("layoutMode") && (
          <Segmented
            label="Arrangement"
            value={style.layoutMode ?? "carousel"}
            onChange={(layoutMode) => setStyle({ layoutMode })}
            options={[
              ...(meta.kind === "CAROUSEL" ? [{ value: "stack" as const, label: "Stack", icon: ICON_STACK }] : []),
              { value: "carousel" as const, label: meta.kind === "CAROUSEL" ? "Slider" : "Filmstrip", icon: ICON_FILMSTRIP },
              { value: "grid" as const, label: "Grid", icon: ICON_GRID },
            ]}
          />
        )}
        {has("columns") && style.layoutMode === "grid" && (
          <Slider label="Columns on desktop" unit="" min={2} max={6} value={style.columns ?? 4} onChange={(columns) => setStyle({ columns })} />
        )}
        {has("singleLayout") && (
          <Segmented
            label="Arrangement"
            value={style.singleLayout ?? "split"}
            onChange={(singleLayout) => setStyle({ singleLayout })}
            options={[
              { value: "split", label: "Video + products" },
              { value: "poster", label: "Video only" },
            ]}
          />
        )}
        {has("popShape") && (
          <Segmented
            label="Shape"
            value={style.popShape ?? "portrait"}
            onChange={(popShape) => setStyle({ popShape })}
            options={[
              { value: "portrait", label: "Portrait" },
              { value: "circle", label: "Circle" },
            ]}
          />
        )}
        {has("position") && (
          <Field label="Position">
            <div className={styles.cornerPicker} role="radiogroup" aria-label="Position">
              {(["top_left", "top_right", "bottom_left", "bottom_right"] as const).map((corner) => (
                <button
                  key={corner}
                  type="button"
                  role="radio"
                  aria-checked={(style.position ?? "bottom_right") === corner}
                  aria-label={corner.replace("_", " ")}
                  className={styles.corner}
                  onClick={() => setStyle({ position: corner })}
                >
                  <span />
                </button>
              ))}
            </div>
          </Field>
        )}
        {has("ringStyle") && (
          <Segmented
            label="Ring"
            value={style.ringStyle ?? "gradient"}
            onChange={(ringStyle) => setStyle({ ringStyle })}
            options={[
              { value: "gradient", label: "Gradient" },
              { value: "solid", label: "Solid" },
            ]}
          />
        )}
        {has("triggerSize") && (meta.kind !== "PRODUCT_PAGE_REELS" || style.layoutMode !== "grid") && (
          <Slider
            label={meta.sizeLabel}
            min={meta.sizeMin}
            max={meta.sizeMax}
            value={style.triggerSize ?? meta.defaults.triggerSize ?? meta.sizeMin}
            onChange={(triggerSize) => setStyle({ triggerSize })}
          />
        )}
      </Card>

      {(has("cornerStyle") || has("shadowPreset") || has("accentColor")) && (
        <Card title="Style">
          {has("cornerStyle") && (
            <Segmented
              label="Corners"
              value={style.cornerStyle ?? "rounded"}
              onChange={(cornerStyle) => setStyle({ cornerStyle })}
              options={[
                { value: "sharp", label: "Square" },
                { value: "rounded", label: "Rounded" },
                { value: "soft", label: "Soft" },
              ]}
            />
          )}
          {has("shadowPreset") && (
            <Segmented
              label="Shadow"
              value={style.shadowPreset ?? "none"}
              onChange={(shadowPreset) => setStyle({ shadowPreset })}
              options={[
                { value: "none", label: "None" },
                { value: "soft", label: "Subtle" },
                { value: "bold", label: "Lifted" },
              ]}
            />
          )}
          {has("accentColor") && (
            <ColorInput
              label={meta.accentLabel}
              value={style.accentColor ?? ""}
              allowEmpty={meta.defaults.accentColor === ""}
              emptyLabel="Brand"
              fallback={brand.accentColor}
              onChange={(accentColor) => setStyle({ accentColor })}
            />
          )}
          {has("accentSecondaryColor") && style.ringStyle !== "solid" && (
            <ColorInput
              label="Ring end"
              value={style.accentSecondaryColor ?? ""}
              onChange={(accentSecondaryColor) => setStyle({ accentSecondaryColor })}
            />
          )}
          {has("backgroundColor") && (
            <ColorInput
              label="Background"
              allowEmpty
              fallback="#f4f4f4"
              value={style.backgroundColor ?? ""}
              onChange={(backgroundColor) => setStyle({ backgroundColor })}
            />
          )}
          {has("textColor") && (
            <ColorInput
              label="Text"
              allowEmpty
              fallback="#141414"
              value={style.textColor ?? ""}
              onChange={(textColor) => setStyle({ textColor })}
            />
          )}
        </Card>
      )}

      {showCardDetails && (
        <Card title="Details">
          {has("showCaption") && (
            <Toggle
              label={meta.kind === "STORIES" ? "Show names under avatars" : "Show video titles"}
              checked={style.showCaption ?? true}
              onChange={(showCaption) => setStyle({ showCaption })}
            />
          )}
          {has("showDuration") && (
            <Toggle label="Show video length" checked={style.showDuration ?? true} onChange={(showDuration) => setStyle({ showDuration })} />
          )}
          {has("showProductPreview") && (
            <Toggle
              label="Show featured product"
              description="The first tagged product, under each video."
              checked={style.showProductPreview ?? true}
              onChange={(showProductPreview) => setStyle({ showProductPreview })}
            />
          )}
        </Card>
      )}
    </>
  );
}

/* ------------------------------------------------------------ shopping */

function ShoppingTab({
  meta,
  style,
  setStyle,
  brand,
}: {
  meta: WidgetKindMeta;
  style: WidgetStyleConfig;
  setStyle: (patch: Partial<WidgetStyleConfig>) => void;
  brand: BrandConfig;
}) {
  const has = (key: StyleFieldKey) => meta.fields.includes(key);
  return (
    <>
      <Card title="Product list" description="Shown beside the video when a shopper opens it.">
        {has("showProductImage") && (
          <Toggle label="Product images" checked={style.showProductImage ?? true} onChange={(showProductImage) => setStyle({ showProductImage })} />
        )}
        {has("showPrice") && (
          <Toggle label="Prices" checked={style.showPrice ?? true} onChange={(showPrice) => setStyle({ showPrice })} />
        )}
        {has("showTitleOverlay") && (
          <Toggle label="Video title on the player" checked={style.showTitleOverlay ?? true} onChange={(showTitleOverlay) => setStyle({ showTitleOverlay })} />
        )}
        {has("showQuantity") && (
          <Toggle label="Quantity selector" checked={style.showQuantity ?? false} onChange={(showQuantity) => setStyle({ showQuantity })} />
        )}
        {has("showRecommendations") && (
          <Toggle
            label="You may also like"
            description="Shopify's own recommendations for the first tagged product."
            checked={style.showRecommendations ?? true}
            onChange={(showRecommendations) => setStyle({ showRecommendations })}
          />
        )}
        {has("showShare") && (
          <Toggle
            label="Share button"
            description="Shoppers can share a link that opens this exact video."
            checked={style.showShare ?? true}
            onChange={(showShare) => setStyle({ showShare })}
          />
        )}
        {has("tagRevealMode") && (
          <Segmented
            label="Products appear"
            value={style.tagRevealMode ?? "always"}
            onChange={(tagRevealMode) => setStyle({ tagRevealMode })}
            options={[
              { value: "always", label: "Right away" },
              { value: "tap", label: "On tap" },
            ]}
          />
        )}
      </Card>

      <Card title="Add to cart button">
        <Segmented
          label="Button style"
          value={style.ctaStyle ?? "pill"}
          onChange={(ctaStyle) => setStyle({ ctaStyle })}
          options={[
            { value: "pill", label: "Pill" },
            { value: "square", label: "Square" },
            { value: "text-link", label: "Link" },
          ]}
        />
        <ColorInput
          label={style.ctaStyle === "text-link" ? "Link color" : "Button color"}
          value={style.ctaColor ?? ""}
          allowEmpty
          emptyLabel="Brand"
          fallback={brand.buttonColor}
          onChange={(ctaColor) => setStyle({ ctaColor })}
        />
        {style.ctaStyle !== "text-link" && (
          <ColorInput
            label="Button text"
            value={style.ctaTextColor ?? ""}
            allowEmpty
            emptyLabel="Brand"
            fallback={brand.buttonTextColor}
            onChange={(ctaTextColor) => setStyle({ ctaTextColor })}
          />
        )}
        <TextInput
          label="Button text"
          value={style.ctaLabel ?? ""}
          placeholder="Add to cart"
          hint="Leave empty to use your store's language setting."
          onChange={(ctaLabel) => setStyle({ ctaLabel })}
        />
      </Card>

      <Card title="Playback">
        {has("playTrigger") && (
          <Segmented
            label="Open video on"
            value={style.playTrigger ?? "click"}
            onChange={(playTrigger) => setStyle({ playTrigger })}
            options={[
              { value: "click", label: "Click" },
              { value: "hover", label: "Hover" },
            ]}
            hint="Hover applies on desktop only — touch screens always use tap."
          />
        )}
        {has("storyDuration") && (
          <Slider
            label="Time per story"
            unit="s"
            min={3}
            max={60}
            value={style.storyDuration ?? 15}
            onChange={(storyDuration) => setStyle({ storyDuration })}
          />
        )}
        {has("autoplayOnScroll") && (
          <Toggle
            label="Autoplay previews"
            description="Plays silently while on screen, lowest quality to save data. Skipped for shoppers on data saver or reduced motion."
            checked={style.autoplayOnScroll ?? false}
            onChange={(autoplayOnScroll) => setStyle({ autoplayOnScroll })}
          />
        )}
        {has("mutedDefault") && (
          <Toggle label="Start muted" checked={style.mutedDefault ?? false} onChange={(mutedDefault) => setStyle({ mutedDefault })} />
        )}
        {has("loop") && <Toggle label="Loop video" checked={style.loop ?? false} onChange={(loop) => setStyle({ loop })} />}
        {has("popDelay") && (
          <Slider
            label="Appear after"
            unit="s"
            min={0}
            max={30}
            value={style.popDelay ?? 2}
            onChange={(popDelay) => setStyle({ popDelay })}
          />
        )}
        {has("showPulse") && (
          <Toggle
            label="Pulse when it appears"
            description="Two gentle pulses to catch the eye, then it settles."
            checked={style.showPulse ?? true}
            onChange={(showPulse) => setStyle({ showPulse })}
          />
        )}
      </Card>
    </>
  );
}

/* ---------------------------------------------------------- visibility */

// Shopify theme-editor deep links: open the live theme with this app's
// block already dropped into the right template (or the embed toggled on),
// so placing a widget is one click instead of a hunt through the editor.
const THEME_PLACEMENT: Record<string, { block: string; template: string; target: string } | { embed: string }> = {
  PRODUCT_PAGE_REELS: { block: "product-page-reels", template: "product", target: "mainSection" },
  ADD_TO_CART_VIDEO: { block: "add-to-cart-video", template: "product", target: "mainSection" },
  CAROUSEL: { block: "stacked-carousel", template: "index", target: "newAppsSection" },
  STORIES: { block: "insta-stories", template: "index", target: "newAppsSection" },
  SINGLE_VIDEO: { block: "single-video", template: "index", target: "newAppsSection" },
  REEL_POPS: { embed: "shoppable-videos" },
};

function themeEditorUrl(shopDomain: string, apiKey: string, kind: string, embedOnly = false) {
  const base = `https://${shopDomain}/admin/themes/current/editor`;
  const placement = THEME_PLACEMENT[kind];
  if (embedOnly || !placement || "embed" in placement) {
    return `${base}?context=apps&template=index&activateAppId=${apiKey}/shoppable-videos`;
  }
  return `${base}?template=${placement.template}&addAppBlockId=${apiKey}/${placement.block}&target=${placement.target}`;
}

function VisibilityTab({
  meta,
  state,
  update,
  shopDomain,
  apiKey,
}: {
  meta: WidgetKindMeta;
  state: EditorState;
  update: (patch: Partial<EditorState>) => void;
  shopDomain: string;
  apiKey: string;
}) {
  const shopify = useAppBridge();
  const rule = state.targetRule;

  const pick = async (type: "product" | "collection") => {
    const selected = await shopify.resourcePicker({ type, multiple: true });
    if (!selected || selected.length === 0) return;
    const handles = selected.map((item) => (item as { handle: string }).handle).filter(Boolean);
    update({ targetRule: { type: type === "product" ? "handles" : "collections", handles } });
  };

  const removeHandle = (handle: string) => {
    if (rule.type === "all_products") return;
    const handles = rule.handles.filter((h) => h !== handle);
    update({ targetRule: handles.length ? { ...rule, handles } : { type: "all_products" } });
  };

  const options: { value: TargetRule["type"]; label: string; hint: string; action?: ReactNode }[] = [
    { value: "all_products", label: "Everywhere", hint: "Every page the widget is placed on." },
    {
      value: "handles",
      label: "Specific products",
      hint: "Only on these product pages.",
    },
    {
      value: "collections",
      label: "Products in collections",
      hint: "Product pages for anything in these collections.",
    },
  ];

  return (
    <>
      <Card
        title="Add to your theme"
        description="Opens your theme editor with everything in place — just press Save there."
      >
        <ol className={styles.steps}>
          <li>
            <span className={styles.stepText}>
              <strong>Turn on the app embed</strong>
              <span className={styles.hint}>Once per theme. It loads the player for every widget.</span>
            </span>
            <s-button href={themeEditorUrl(shopDomain, apiKey, meta.kind, true)} target="_blank">
              Turn on
            </s-button>
          </li>
          {meta.kind !== "REEL_POPS" && (
            <li>
              <span className={styles.stepText}>
                <strong>Add the {meta.name.toLowerCase()} block</strong>
                <span className={styles.hint}>{meta.placement}. Drag it anywhere you like afterwards.</span>
              </span>
              <s-button variant="primary" href={themeEditorUrl(shopDomain, apiKey, meta.kind)} target="_blank">
                Add block
              </s-button>
            </li>
          )}
        </ol>
      </Card>

      <Card title="Show on">
        <div className={styles.radioList} role="radiogroup" aria-label="Show on">
          {options.map((option) => (
            <label key={option.value} className={styles.radioOption} htmlFor={`target-${option.value}`}>
              <input
                id={`target-${option.value}`}
                aria-label={option.label}
                type="radio"
                name="target"
                checked={rule.type === option.value}
                onChange={() => {
                  if (option.value === "all_products") update({ targetRule: { type: "all_products" } });
                  else pick(option.value === "handles" ? "product" : "collection");
                }}
              />
              <span>
                <span className={styles.toggleLabel}>{option.label}</span>
                <span className={styles.hint} style={{ display: "block" }}>
                  {option.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
        {rule.type !== "all_products" && (
          <>
            <div className={styles.targetSummary}>
              {rule.handles.map((handle) => (
                <span key={handle} className={styles.tag}>
                  {handle}
                  <button type="button" aria-label={`Remove ${handle}`} onClick={() => removeHandle(handle)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div>
              <s-button onClick={() => pick(rule.type === "handles" ? "product" : "collection")}>
                {rule.type === "handles" ? "Change products" : "Change collections"}
              </s-button>
            </div>
          </>
        )}
      </Card>

      <Card title="Pages and devices">
        <ChipToggleGroup
          label="Page types"
          hint={state.pageTypes.length === 0 ? "None selected — shows on every page type." : undefined}
          options={PAGE_TYPE_OPTIONS}
          selected={state.pageTypes}
          onChange={(pageTypes) => update({ pageTypes })}
        />
        <Segmented
          label="Devices"
          value={state.deviceVisibility}
          onChange={(deviceVisibility) => update({ deviceVisibility })}
          options={[
            { value: "all", label: "All" },
            { value: "desktop", label: "Desktop" },
            { value: "mobile", label: "Mobile" },
          ]}
        />
      </Card>
    </>
  );
}

/* --------------------------------------------------------------- icons */

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 6.2 5 8.5l4.5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" style={{ color: "#616161" }}>
      <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M5.72 5.72a.75.75 0 0 1 1.06 0L10 8.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L11.06 10l3.22 3.22a.75.75 0 1 1-1.06 1.06L10 11.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L8.94 10 5.72 6.78a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}

function ArrowIcon({ dir }: { dir: "up" | "down" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" style={dir === "down" ? { transform: "rotate(180deg)" } : undefined}>
      <path d="M10 4.5a.75.75 0 0 1 .53.22l4.25 4.25a.75.75 0 1 1-1.06 1.06l-2.97-2.97v8.19a.75.75 0 0 1-1.5 0V7.06L6.28 10.03a.75.75 0 0 1-1.06-1.06l4.25-4.25A.75.75 0 0 1 10 4.5Z" />
    </svg>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
