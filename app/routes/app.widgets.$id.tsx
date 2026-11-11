import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunction,
} from "react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { createWidget, deleteWidget, getWidget, isSingleLiveKind, listWidgetsForShop, saveWidgetSettings, updateWidget } from "../models/widget.server";
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
import { healProcessingReels } from "../models/reel-media.server";
import { releaseStreamAssets } from "../models/stream-assets.server";
import { getBrand } from "../models/brand.server";
import type { BrandConfig } from "../models/brand";
import type { ReelConfig } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import {
  handleRovingKeys,
  Card,
  ChipToggleGroup,
  ColorInput,
  Field,
  Section,
  Segmented,
  Slider,
  TextInput,
  Toggle,
} from "../components/widget-editor/controls";
import { SortableList } from "../components/SortableList";
import { useEditorGuards } from "../components/useEditorGuards";
import { useThemeStatus } from "../components/useThemeStatus";
import { blockHandleFor, themeEditorUrl } from "../components/themeEditor";
import { WidgetPreview, formatDuration } from "../components/widget-editor/WidgetPreview";
import {
  ICON_FILMSTRIP,
  ICON_GRID,
  ICON_STACK,
  LOOKS,
  ShowcaseDesignTab,
} from "../components/widget-editor/ShowcaseDesign";
import { StoriesDesignTab } from "../components/widget-editor/StoriesDesign";
import type { Look } from "../components/widget-editor/ShowcaseDesign";
import type { Device, Mode, PreviewHighlight, PreviewReel } from "../components/widget-editor/WidgetPreview";
import styles from "../components/widget-editor/editor.module.css";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widget = await getWidget(shop.id, params.id!);
  if (!widget) {
    throw new Response("Widget not found", { status: 404 });
  }

  // Videos still processing are checked with Cloudflare here too, so the
  // picker doesn't show "Processing" for one that has finished.
  const reels = await healProcessingReels(admin, await listReels(admin), 12, (uids) => releaseStreamAssets(admin, shop.id, uids));

  // First two tagged products per reel are enough for every preview layout
  // (filmstrip shows one, the feature/viewer panels show up to three of the
  // first reel). Bounded so a large library can't blow up the query.
  const productIds = [...new Set(reels.flatMap((r) => (r.config.productIds ?? []).slice(0, 3)))].slice(0, 100);
  let products: Awaited<ReturnType<typeof getProductsByIds>> = [];
  try {
    products = await getProductsByIds(admin, productIds);
  } catch (e) {
    if (e instanceof Response) throw e;
    // Preview-only data, the editor still works with placeholder products.
  }

  // Only the floating video is one-live-per-store; block widgets can all be live.
  const liveSibling = isSingleLiveKind(widget.type)
    ? (await listWidgetsForShop(shop.id)).find((w) => w.type === widget.type && w.published && w.id !== widget.id)
    : undefined;

  return {
    widget,
    liveSiblingName: liveSibling?.name ?? null,
    brand: await getBrand(shop.id),
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
        coverTimeSeconds: reel.config.coverTimeSeconds,
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

    // One-click Live/Draft from the widget list. updateWidget keeps the
    // one-live floating video rule and syncs the store.
    if (intent === "publish") {
      await updateWidget(admin, shop.id, widget.id, { published: formData.get("published") === "true" });
      return { ok: true, error: null };
    }

    if (intent === "delete") {
      await deleteWidget(admin, shop.id, widget.id);
      return { ok: true, error: null, deleted: true };
    }

    if (intent === "duplicate") {
      // Unpublished copy: the merchant decides when it goes live (and a live
      // floating video copy would take the original offline).
      const copy = await createWidget(
        shop.id,
        widget.type as WidgetKind,
        `${widget.name.slice(0, 72)} (copy)`,
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

    const rawTarget = body.targetRule as { type?: string; handles?: unknown; items?: unknown } | undefined;
    const handles = Array.isArray(rawTarget?.handles)
      ? [...new Set(rawTarget!.handles.map(String).filter((h) => /^[a-z0-9][a-z0-9-]{0,254}$/i.test(h)))].slice(0, 250)
      : [];
    const items = Array.isArray(rawTarget?.items)
      ? rawTarget!.items
          .filter((i): i is { id: unknown; handle: unknown; title: unknown } => typeof i === "object" && i !== null)
          .map((i) => ({ id: String(i.id), handle: String(i.handle), title: String(i.title).slice(0, 255) }))
          .filter((i) => /^gid:\/\/shopify\/(Product|Collection)\/\d+$/.test(i.id) && handles.includes(i.handle))
          .slice(0, 250)
      : undefined;
    const targetRule: TargetRule =
      (rawTarget?.type === "handles" || rawTarget?.type === "collections") && handles.length > 0
        ? { type: rawTarget.type, handles, ...(items?.length ? { items } : {}) }
        : { type: "all_products" };

    const deviceVisibility = ["all", "desktop", "mobile"].includes(String(body.deviceVisibility))
      ? (body.deviceVisibility as "all" | "desktop" | "mobile")
      : "all";

    const allowedPages = new Set(PAGE_TYPE_OPTIONS.map((o) => o.value));
    const pageTypes = Array.isArray(body.pageTypes)
      ? body.pageTypes.map(String).filter((p) => allowedPages.has(p))
      : [];

    // Only ids that still exist in the library can be persisted, a stale
    // metaobject reference would make every later metafield sync for this
    // kind fail (it's written in the same metafieldsSet call).
    const validReelIds = new Set((await listReels(admin)).map((r) => r.id));
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
  const { widget, reels, products, brand, apiKey, liveSiblingName } = useLoaderData<typeof loader>();
  const meta = getKindMeta(widget.type);
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const saveFetcher = useFetcher<ActionResult>();
  const actionFetcher = useFetcher<ActionResult>();

  const baseline = useMemo(() => stateFromWidget(widget), [widget]);
  const [state, setState] = useState<EditorState>(baseline);
  const [tab, setTab] = useState<TabId>("content");
  // The preview's device and mode live here so the Design tab's
  // desktop/mobile size switch and the preview stay in step, and the
  // Shopping tab shows the video viewer it configures.
  const [previewDevice, setPreviewDevice] = useState<Device>("desktop");
  const [previewMode, setPreviewMode] = useState<Mode>("page");
  const [highlight, setHighlight] = useState<PreviewHighlight | null>(null);
  const openTab = (next: TabId) => {
    setTab(next);
    setHighlight(null);
    if (next === "viewer") setPreviewMode("viewer");
    else if (next === "design" || next === "content") setPreviewMode("page");
  };

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
      allowNextNavigation();
      navigate("/app/widgets");
    } else if (data.duplicatedId) {
      shopify.toast.show("Copy created as a draft");
      allowNextNavigation();
      navigate(`/app/widgets/${encodeURIComponent(data.duplicatedId)}`);
    } else if (data.error) {
      shopify.toast.show(data.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- allowNextNavigation only flips a ref
  }, [actionFetcher.state, actionFetcher.data, navigate, shopify]);

  const { allowNextNavigation } = useEditorGuards({
    dirty,
    saving,
    onSave: () => saveFetcher.submit(JSON.stringify(state), { method: "post", encType: "application/json" }),
  });

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
        disabled={actionFetcher.state !== "idle"}
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

      <SaveBar id="widget-save-bar" open={dirty} discardConfirmation>
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
              <p className={styles.statusTitle}>{state.published
                  ? (meta.reelSelection === "list" ? state.reelIds.length === 0 : !state.featuredReelId)
                    ? "Live, but it has no videos yet"
                    : "Live on your store"
                  : "Draft"}
              </p>
              <p className={styles.hint}>
                {!widget.published && state.published && liveSiblingName
                  ? `Saving takes “${liveSiblingName}” off your store because only one ${meta.name.toLowerCase()} can be live at a time.`
                  : `${meta.name} · ${meta.placement}`}
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

          <div /* eslint-disable-line jsx-a11y/interactive-supports-focus -- roving tabindex: the chosen child is the tab stop */
            className={styles.tabs}
            role="tablist"
            aria-label="Widget settings"
            onKeyDown={(e) => handleRovingKeys(e, TABS.map((t) => t.id), tab, openTab)}
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                className={styles.tab}
                onClick={() => openTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={styles.tabPanel} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "content" && (
              <ContentTab meta={meta} state={state} reels={reels} update={update} setStyle={setStyle} />
            )}
            {tab === "design" &&
              (meta.fields.includes("cardTemplate") ? (
                <ShowcaseDesignTab
                  meta={meta}
                  style={state.style}
                  setStyle={setStyle}
                  brand={brand}
                  device={previewDevice}
                  setDevice={setPreviewDevice}
                  onFocusArea={setHighlight}
                />
              ) : meta.kind === "STORIES" ? (
                <StoriesDesignTab
                  meta={meta}
                  style={state.style}
                  setStyle={setStyle}
                  device={previewDevice}
                  setDevice={setPreviewDevice}
                  onFocusArea={setHighlight}
                />
              ) : (
                <DesignTab meta={meta} style={state.style} setStyle={setStyle} brand={brand} />
              ))}
            {tab === "viewer" && <ShoppingTab meta={meta} style={state.style} setStyle={setStyle} brand={brand} />}
            {tab === "visibility" && (
              <VisibilityTab meta={meta} state={state} update={update} apiKey={apiKey} />
            )}
          </div>
        </div>

        <div className={styles.previewColumn}>
          <WidgetPreview
            kind={widget.type as WidgetKind}
            style={state.style}
            reels={previewReels}
            brand={brand}
            device={previewDevice}
            onDeviceChange={setPreviewDevice}
            mode={previewMode}
            onModeChange={setPreviewMode}
            highlight={highlight}
            live={{
              widgetId: widget.id,
              ...(meta.reelSelection === "list" ? { reelIds: state.reelIds } : { featuredReelId: state.featuredReelId || undefined }),
            }}
          />
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
      coverTime: reel.config.coverTimeSeconds,
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
  if (!reel.published) return "Not published. Hidden from your store.";
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

const isLive = (reel: EditorReel) => reel.published && deriveReelStatus(reel.config as ReelConfig) === "ready";

// Explains, in one line, why some chosen videos won't appear on the store.
function NotLiveNotice({ reels }: { reels: EditorReel[] }) {
  const navigate = useNavigate();
  const blocked = reels.filter((r) => !isLive(r));
  if (blocked.length === 0) return null;
  const drafts = blocked.filter((r) => !r.published && deriveReelStatus(r.config as ReelConfig) === "ready").length;
  const notReady = blocked.length - drafts;
  const parts = [
    drafts ? `${drafts} ${drafts === 1 ? "is a draft" : "are drafts"}` : "",
    notReady ? `${notReady} ${notReady === 1 ? "has" : "have"} no playable video yet` : "",
  ].filter(Boolean);
  return (
    <div className={styles.notice} role="status">
      <WarningIcon />
      <p>
        {blocked.length === 1 ? "1 video won't show yet" : `${blocked.length} videos won't show yet`}, {parts.join(", ")}.{" "}
        <button type="button" className={styles.noticeLink} onClick={() => navigate("/app/reels")}>
          Open Reels
        </button>
      </p>
    </div>
  );
}

function EmptyReels() {
  const navigate = useNavigate();
  return (
    <div className={styles.emptyNote}>
      <p>You haven&rsquo;t uploaded any videos yet.</p>
      <s-button variant="primary" onClick={() => navigate("/app/reels")}>
        Upload videos
      </s-button>
    </div>
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
  // The video-row widgets edit their header text in Design › Header,
  // next to its sizes and alignment.
  const headerInDesign = has("cardTemplate");
  const showText = (has("heading") && !headerInDesign) || has("watchLabel") || has("bubbleLabel");
  const [query, setQuery] = useState("");
  const featured = reels.find((r) => r.id === state.featuredReelId);

  return (
    <>
      {meta.reelSelection === "list" ? (
        <ReelListPicker reels={reels} selected={state.reelIds} onChange={(reelIds) => update({ reelIds })} />
      ) : (
        <Card title="Video" description="The one video this widget plays.">
          {reels.length === 0 ? (
            <EmptyReels />
          ) : (
            <>
              {featured && <NotLiveNotice reels={[featured]} />}
              {reels.length > 8 && <ReelSearch value={query} onChange={setQuery} />}
              <div /* eslint-disable-line jsx-a11y/interactive-supports-focus -- roving tabindex: the chosen child is the tab stop */
                className={styles.reelList}
                role="radiogroup"
                aria-label="Video"
                onKeyDown={(e) => {
                  const ids = filterReels(reels, query).map((r) => r.id);
                  handleRovingKeys(e, ids, state.featuredReelId || ids[0], (featuredReelId) => update({ featuredReelId }));
                }}
              >
                {filterReels(reels, query).map((reel) => (
                  <button
                    key={reel.id}
                    type="button"
                    role="radio"
                    aria-checked={state.featuredReelId === reel.id}
                    tabIndex={
                      state.featuredReelId === reel.id || (!state.featuredReelId && reel === filterReels(reels, query)[0]) ? 0 : -1
                    }
                    className={styles.reelRow}
                    onClick={() => update({ featuredReelId: reel.id })}
                  >
                    <ReelThumb reel={reel} />
                    <span className={styles.reelMeta}>
                      <span className={styles.reelTitle}>{reel.title}</span>
                      <span className={styles.reelSub} data-warn={!isLive(reel) || undefined}>
                        {reelStatusText(reel)}
                      </span>
                    </span>
                    <span className={styles.reelCheck}>{state.featuredReelId === reel.id && <CheckIcon />}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {showText && (
        <Card title="Text">
          {has("eyebrow") && !headerInDesign && (
            <TextInput
              label="Eyebrow"
              value={state.style.eyebrow ?? ""}
              placeholder="e.g. Shoppable reels"
              hint="A small label above the heading. Leave empty to hide it."
              onChange={(eyebrow) => setStyle({ eyebrow })}
            />
          )}
          {has("heading") && !headerInDesign && (
            <TextInput
              label="Heading"
              value={state.style.heading ?? ""}
              placeholder="No heading"
              hint="Leave empty to hide the heading."
              onChange={(heading) => setStyle({ heading })}
            />
          )}
          {has("subheading") && !headerInDesign && (
            <TextInput
              label="Subheading"
              value={state.style.subheading ?? ""}
              placeholder="e.g. Tap any reel to watch, then shop the pieces in it."
              hint="One line under the heading. Leave empty to hide it."
              maxLength={160}
              onChange={(subheading) => setStyle({ subheading })}
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

      <Card title="Admin name" description="Only you see this. It tells widgets apart in this app.">
        <TextInput label="Widget name" value={state.name} onChange={(name) => update({ name })} />
      </Card>
    </>
  );
}

function filterReels(reels: EditorReel[], query: string) {
  const q = query.trim().toLowerCase();
  return q ? reels.filter((r) => r.title.toLowerCase().includes(q)) : reels;
}

function ReelSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      className={styles.input}
      type="search"
      placeholder="Search videos"
      aria-label="Search videos"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
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
  const [query, setQuery] = useState("");
  const byId = new Map(reels.map((r) => [r.id, r]));
  const chosen = selected.map((id) => byId.get(id)).filter((r): r is EditorReel => Boolean(r));
  const available = filterReels(
    reels.filter((r) => !selected.includes(r.id)),
    query,
  );

  return (
    <Card
      title="Videos"
      description={
        chosen.length === 0 ? "Pick the videos to show, in order." : `${chosen.length} selected, shown in this order`
      }
      action={
        chosen.length > 0 ? (
          <button type="button" className={styles.noticeLink} onClick={() => onChange([])}>
            Clear
          </button>
        ) : undefined
      }
    >
      {reels.length === 0 ? (
        <EmptyReels />
      ) : (
        <>
          <NotLiveNotice reels={chosen} />
          {chosen.length > 0 && (
            <SortableList
              items={chosen}
              getKey={(reel) => reel.id}
              getLabel={(reel) => reel.title}
              onReorder={(next) => onChange(next.map((reel) => reel.id))}
              className={styles.orderList}
              itemClassName={styles.orderItem}
              renderItem={(reel, index, handle) => (
                <>
                  {handle}
                  <span className={styles.orderIndex}>{index + 1}</span>
                  <ReelThumb reel={reel} />
                  <span className={styles.reelMeta}>
                    <span className={styles.reelTitle}>{reel.title}</span>
                    <span className={styles.reelSub} data-warn={!isLive(reel) || undefined}>
                      {reelStatusText(reel)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Remove ${reel.title}`}
                    onClick={() => onChange(selected.filter((id) => id !== reel.id))}
                  >
                    <CloseIcon />
                  </button>
                </>
              )}
            />
          )}

          {reels.length > selected.length ? (
            <Field label="Add videos">
              <div className={styles.addRow}>
                {reels.length > 8 && <ReelSearch value={query} onChange={setQuery} />}
                {available.length > 1 && (
                  <button
                    type="button"
                    className={styles.noticeLink}
                    onClick={() => onChange([...selected, ...available.map((r) => r.id)])}
                  >
                    Add all {available.length}
                  </button>
                )}
              </div>
              <div className={styles.reelList}>
                {available.length === 0 ? (
                  <p className={styles.hint}>No videos match.</p>
                ) : (
                  available.map((reel) => (
                    <button
                      key={reel.id}
                      type="button"
                      className={styles.reelRow}
                      onClick={() => onChange([...selected, reel.id])}
                    >
                      <ReelThumb reel={reel} />
                      <span className={styles.reelMeta}>
                        <span className={styles.reelTitle}>{reel.title}</span>
                        <span className={styles.reelSub} data-warn={!isLive(reel) || undefined}>
                          {reelStatusText(reel)}
                        </span>
                      </span>
                      <PlusIcon />
                    </button>
                  ))
                )}
              </div>
            </Field>
          ) : (
            <p className={styles.hint}>Every video in your library is in this widget.</p>
          )}
        </>
      )}
    </Card>
  );
}

function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
      <path d="M10 6.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5a.75.75 0 0 1 .75-.75Zm0 7.25a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
      <path fillRule="evenodd" d="M8.27 3.5a2 2 0 0 1 3.46 0l5.4 9.35A2 2 0 0 1 15.4 15.85H4.6a2 2 0 0 1-1.73-3l5.4-9.35Zm1.3.75a.5.5 0 0 1 .86 0l5.4 9.35a.5.5 0 0 1-.43.75H4.6a.5.5 0 0 1-.43-.75l5.4-9.35Z" />
    </svg>
  );
}

/* -------------------------------------------------------------- design */

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
  const showCardDetails =
    has("showCaption") || has("showDuration") || has("showProductPreview") || has("showPlayIcon") || has("showCardBadge");
  const template = style.cardTemplate ?? "title";

  return (
    <>
      {showLooks && (
        <Card title="Looks" description="A starting point. Fine-tune anything below.">
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
        {meta.kind === "CAROUSEL" && (style.layoutMode ?? "stack") === "stack" && (
          <p className={styles.hint}>The stack needs 3 or more videos; with fewer it shows as a slider.</p>
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
            <div /* eslint-disable-line jsx-a11y/interactive-supports-focus -- roving tabindex: the chosen child is the tab stop */
              className={styles.cornerPicker}
              role="radiogroup"
              aria-label="Position"
              onKeyDown={(e) =>
                handleRovingKeys(
                  e,
                  ["top_left", "top_right", "bottom_left", "bottom_right"] as const,
                  style.position ?? "bottom_right",
                  (position) => setStyle({ position }),
                )
              }
            >
              {(["top_left", "top_right", "bottom_left", "bottom_right"] as const).map((corner) => (
                <button
                  key={corner}
                  type="button"
                  role="radio"
                  aria-checked={(style.position ?? "bottom_right") === corner}
                  tabIndex={(style.position ?? "bottom_right") === corner ? 0 : -1}
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
        {has("triggerSize") && meta.kind !== "CAROUSEL" && (meta.kind !== "PRODUCT_PAGE_REELS" || style.layoutMode !== "grid") && (
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
          {has("showCaption") && (!has("cardTemplate") || template === "title") && (
            <Toggle
              label="Show video titles"
              checked={style.showCaption ?? true}
              onChange={(showCaption) => setStyle({ showCaption })}
            />
          )}
          {has("showDuration") && (
            <Toggle label="Show video length" checked={style.showDuration ?? true} onChange={(showDuration) => setStyle({ showDuration })} />
          )}
          {has("showPlayIcon") && (
            <Toggle label="Play button on cards" checked={style.showPlayIcon ?? true} onChange={(showPlayIcon) => setStyle({ showPlayIcon })} />
          )}
          {has("showCardBadge") && (
            <Toggle
              label="Discount badge on cards"
              description="A “58% OFF” ribbon when the card's product has a compare-at price."
              checked={style.showCardBadge ?? false}
              onChange={(showCardBadge) => setStyle({ showCardBadge })}
            />
          )}
          {has("badgeColor") && style.showCardBadge && (
            <ColorInput
              label="Badge color"
              value={style.badgeColor ?? ""}
              allowEmpty
              emptyLabel="Sale color"
              fallback="#c8102e"
              onChange={(badgeColor) => setStyle({ badgeColor })}
            />
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

const AFTER_ADD_HINTS: Record<NonNullable<WidgetStyleConfig["afterAdd"]>, string> = {
  stay: "Shoppers see a confirmation and can keep browsing videos.",
  cart: "Opens your theme's cart drawer, or the cart page if your theme has none.",
  checkout: "Goes straight to checkout. Fastest for single-product videos.",
};

// The Shopping tab, in the same collapsible sections as Design: what's in
// the video popup and how it behaves. Opening this tab shows the popup in
// the preview (see openTab), so each change is visible as it's made.
type ShoppingArea = "products" | "details" | "cart" | "player" | "playback";

const ICON_BAG = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M7 6V5a3 3 0 1 1 6 0v1h2.25A1.75 1.75 0 0 1 17 7.75l-.62 8.06A2.4 2.4 0 0 1 14 18H6a2.4 2.4 0 0 1-2.38-2.19L3 7.75A1.75 1.75 0 0 1 4.75 6H7Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v1Z" />
  </svg>
);
const ICON_DETAILS = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M4.5 3A1.5 1.5 0 0 0 3 4.5v11A1.5 1.5 0 0 0 4.5 17h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 15.5 3h-11Zm0 1.5h11v5h-11v-5Zm1 7a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75Zm.75 2.25a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5Z" />
  </svg>
);
const ICON_CART = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M2.75 3a.75.75 0 0 0 0 1.5h1.12l1.6 7.48A2 2 0 0 0 7.43 13.5h7.3a2 2 0 0 0 1.95-1.57l1.06-4.77A1 1 0 0 0 16.77 6H6.02l-.48-2.24A1 1 0 0 0 4.56 3H2.75Zm5 13.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm8 0a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z" />
  </svg>
);
const ICON_PLAYER = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M5.5 2A1.5 1.5 0 0 0 4 3.5v13A1.5 1.5 0 0 0 5.5 18h9a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 14.5 2h-9Zm3 5.13a.5.5 0 0 1 .76-.43l3.6 2.43a.5.5 0 0 1 0 .84l-3.6 2.43a.5.5 0 0 1-.76-.43V7.13Z" />
  </svg>
);
const ICON_PLAYBACK = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-1.5 5.13a.5.5 0 0 1 .76-.43l3.6 2.43a.5.5 0 0 1 0 .84l-3.6 2.43a.5.5 0 0 1-.76-.43V7.13Z" />
  </svg>
);

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
  const [open, setOpen] = useState<ShoppingArea | null>("products");
  const toggle = (area: ShoppingArea) => setOpen(open === area ? null : area);
  const on = (value: boolean | undefined, fallback: boolean) => value ?? fallback;
  const large = (style.productImageSize ?? "compact") === "large";

  const productsSummary = [
    has("productImageSize") ? (large ? "Large images" : "Thumbnails") : null,
    on(style.showPrice, true) ? "Prices" : "No prices",
    on(style.showSaleBadge, false) ? "Sale badge" : null,
    on(style.showRecommendations, true) ? "You may also like" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const cartSummary = [
    { pill: "Pill", square: "Square", "text-link": "Link" }[style.ctaStyle ?? "pill"],
    style.ctaLabel || "Add to cart",
    { stay: "Keep watching", cart: "Show cart", checkout: "Checkout" }[style.afterAdd ?? "stay"],
  ].join(" · ");
  const playerSummary = [
    on(style.showTitleOverlay, true) ? "Title" : "No title",
    has("viewerNav") ? ((style.viewerNav ?? "sides") === "sides" ? "Side arrows" : "Up/down arrows") : null,
    on(style.mutedDefault, false) ? "Starts muted" : "Sound on",
    on(style.loop, false) ? "Loops" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const playbackSummary = [
    has("autoplayOnScroll") ? (on(style.autoplayOnScroll, false) ? "Autoplay on" : "Autoplay off") : null,
    has("playTrigger") ? `Opens on ${style.playTrigger === "hover" ? "hover" : "click"}` : null,
    has("storyDuration") ? `${style.storyDuration ?? 15}s per story` : null,
    has("popDelay") ? `Appears after ${style.popDelay ?? 2}s` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={styles.designStack}>
      <Section title="Products in the video" icon={ICON_BAG} summary={productsSummary} open={open === "products"} onToggle={() => toggle("products")}>
        {has("productImageSize") && style.showProductImage !== false && (
          <Segmented
            label="Product layout"
            value={style.productImageSize ?? "compact"}
            onChange={(productImageSize) => setStyle({ productImageSize })}
            options={[
              { value: "large", label: "Tiles" },
              { value: "compact", label: "Rows" },
            ]}
            hint={
              large
                ? "Two products per row with a big image and a Shop now button."
                : "A compact row per product: image, name, options and Add to cart."
            }
          />
        )}
        {has("showProductImage") && (
          <Toggle label="Product images" checked={on(style.showProductImage, true)} onChange={(showProductImage) => setStyle({ showProductImage })} />
        )}
        {has("showPrice") && <Toggle label="Prices" checked={on(style.showPrice, true)} onChange={(showPrice) => setStyle({ showPrice })} />}
        {has("showSaleBadge") && style.showPrice !== false && (
          <Toggle
            label="Sale badge"
            description="Shows the saving, like −20%, on products with a compare-at price. Follows the chosen variant."
            checked={on(style.showSaleBadge, false)}
            onChange={(showSaleBadge) => setStyle({ showSaleBadge })}
          />
        )}
        {has("showQuantity") && (
          <Toggle label="Quantity selector" checked={on(style.showQuantity, false)} onChange={(showQuantity) => setStyle({ showQuantity })} />
        )}
        {has("showRecommendations") && (
          <Toggle
            label="You may also like"
            description="Shopify's own recommendations for the first tagged product."
            checked={on(style.showRecommendations, true)}
            onChange={(showRecommendations) => setStyle({ showRecommendations })}
          />
        )}
      </Section>

      {has("productDetails") && (
        <Section
          title="Product details"
          icon={ICON_DETAILS}
          summary={on(style.productDetails, true) ? `Opens inside the video${on(style.showDescription, true) ? " · Description" : ""}` : "Links to the product page"}
          open={open === "details"}
          onToggle={() => toggle("details")}
        >
          <Toggle
            label="Open products inside the video"
            description="Tapping a product shows its photos, price, options, add to cart and description next to the video, so shoppers never leave it."
            checked={on(style.productDetails, true)}
            onChange={(productDetails) => setStyle({ productDetails })}
          />
          {has("showDescription") && style.productDetails !== false && (
            <Toggle
              label="Product description"
              description="Your product's description, with its tables and images."
              checked={on(style.showDescription, true)}
              onChange={(showDescription) => setStyle({ showDescription })}
            />
          )}
        </Section>
      )}

      <Section title="Add to cart" icon={ICON_CART} summary={cartSummary} open={open === "cart"} onToggle={() => toggle("cart")}>
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
            label="Button text color"
            value={style.ctaTextColor ?? ""}
            allowEmpty
            emptyLabel="Brand"
            fallback={brand.buttonTextColor}
            onChange={(ctaTextColor) => setStyle({ ctaTextColor })}
          />
        )}
        <TextInput
          label="Button label"
          value={style.ctaLabel ?? ""}
          placeholder="Add to cart"
          hint="Leave empty to use your store's language setting."
          onChange={(ctaLabel) => setStyle({ ctaLabel })}
        />
        {has("afterAdd") && (
          <Segmented
            label="After adding to cart"
            value={style.afterAdd ?? "stay"}
            onChange={(afterAdd) => setStyle({ afterAdd })}
            options={[
              { value: "stay", label: "Keep watching" },
              { value: "cart", label: "Show cart" },
              { value: "checkout", label: "Checkout" },
            ]}
            hint={AFTER_ADD_HINTS[style.afterAdd ?? "stay"]}
          />
        )}
      </Section>

      <Section title="Video player" icon={ICON_PLAYER} summary={playerSummary} open={open === "player"} onToggle={() => toggle("player")}>
        {has("viewerNav") && (
          <Segmented
            label="Next / previous video"
            value={style.viewerNav ?? "sides"}
            onChange={(viewerNav) => setStyle({ viewerNav })}
            options={[
              { value: "sides", label: "Side arrows" },
              { value: "stacked", label: "Up / down" },
            ]}
            hint={
              (style.viewerNav ?? "sides") === "sides"
                ? "Arrows either side of the video, like a slider. Phones swipe sideways."
                : "A stacked pair at the edge of the screen. Phones swipe up and down."
            }
          />
        )}
        {has("popupCorners") && (
          <Segmented
            label="Popup corners"
            value={style.popupCorners ?? "rounded"}
            onChange={(popupCorners) => setStyle({ popupCorners })}
            options={[
              { value: "square", label: "Square" },
              { value: "rounded", label: "Rounded" },
            ]}
          />
        )}
        {has("showTitleOverlay") && (
          <Toggle
            label="Video title on the player"
            checked={on(style.showTitleOverlay, true)}
            onChange={(showTitleOverlay) => setStyle({ showTitleOverlay })}
          />
        )}
        {has("showShare") && (
          <Toggle
            label="Share button"
            description="Shoppers can share a link that opens this exact video."
            checked={on(style.showShare, true)}
            onChange={(showShare) => setStyle({ showShare })}
          />
        )}
        {has("mutedDefault") && (
          <Toggle label="Start muted" checked={on(style.mutedDefault, false)} onChange={(mutedDefault) => setStyle({ mutedDefault })} />
        )}
        {has("loop") && <Toggle label="Loop video" checked={on(style.loop, false)} onChange={(loop) => setStyle({ loop })} />}
      </Section>

      <Section title="Autoplay & opening" icon={ICON_PLAYBACK} summary={playbackSummary} open={open === "playback"} onToggle={() => toggle("playback")}>
        {has("autoplayOnScroll") && (
          <Toggle
            label="Autoplay videos"
            description="Every video on screen plays silently, looping, at low quality to save data. Skipped for shoppers using Data Saver or reduced motion."
            checked={on(style.autoplayOnScroll, false)}
            onChange={(autoplayOnScroll) => setStyle({ autoplayOnScroll })}
          />
        )}
        {has("playTrigger") && (
          <Segmented
            label="Open video on"
            value={style.playTrigger ?? "click"}
            onChange={(playTrigger) => setStyle({ playTrigger })}
            options={[
              { value: "click", label: "Click" },
              { value: "hover", label: "Hover" },
            ]}
            hint="Hover plays a preview on desktop; a click opens the player. Touch screens always use tap."
          />
        )}
        {has("storyDuration") && (
          <Slider label="Time per story" unit="s" min={3} max={60} value={style.storyDuration ?? 15} onChange={(storyDuration) => setStyle({ storyDuration })} />
        )}
        {has("popDelay") && (
          <Slider label="Appear after" unit="s" min={0} max={30} value={style.popDelay ?? 2} onChange={(popDelay) => setStyle({ popDelay })} />
        )}
        {has("showPulse") && (
          <Toggle
            label="Pulse when it appears"
            description="Two gentle pulses to catch the eye, then it settles."
            checked={on(style.showPulse, true)}
            onChange={(showPulse) => setStyle({ showPulse })}
          />
        )}
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------- visibility */

function VisibilityTab({
  meta,
  state,
  update,
  apiKey,
}: {
  meta: WidgetKindMeta;
  state: EditorState;
  update: (patch: Partial<EditorState>) => void;
  apiKey: string;
}) {
  const shopify = useAppBridge();
  const theme = useThemeStatus();
  const blockHandle = blockHandleFor(meta.kind);
  const placed = Boolean(theme && blockHandle && theme.placedBlocks.has(blockHandle));
  const rule = state.targetRule;

  const pick = async (type: "product" | "collection") => {
    const ruleType = type === "product" ? "handles" : "collections";
    // Re-open with what's already chosen, so "Change" edits the list
    // instead of starting over.
    const current = rule.type === ruleType ? (rule.items ?? []) : [];
    const selected = await shopify.resourcePicker({
      type,
      multiple: true,
      selectionIds: current.map((i) => ({ id: i.id })),
    });
    if (!selected) return;
    const items = selected
      .map((item) => {
        const r = item as { id: string; handle?: string; title?: string };
        return { id: r.id, handle: r.handle ?? "", title: r.title ?? r.handle ?? "" };
      })
      .filter((i) => i.handle);
    if (items.length === 0) {
      update({ targetRule: { type: "all_products" } });
      return;
    }
    update({ targetRule: { type: ruleType, handles: items.map((i) => i.handle), items } });
  };

  const removeHandle = (handle: string) => {
    if (rule.type === "all_products") return;
    const handles = rule.handles.filter((h) => h !== handle);
    const items = rule.items?.filter((i) => i.handle !== handle);
    update({ targetRule: handles.length ? { ...rule, handles, items } : { type: "all_products" } });
  };

  // Widgets usually placed on the home page disappear there when limited to
  // products, say so instead of silently showing nothing.
  const homeKind = meta.kind === "CAROUSEL" || meta.kind === "STORIES" || meta.kind === "SINGLE_VIDEO";
  const productOnlyConflict =
    rule.type !== "all_products" && state.pageTypes.length > 0 && !state.pageTypes.includes("product");

  const options: { value: TargetRule["type"]; label: string; hint: string; action?: ReactNode }[] = [
    { value: "all_products", label: "Everywhere", hint: "Shows everywhere you place it in your theme." },
    {
      value: "handles",
      label: "Specific products",
      hint: homeKind
        ? "Shows only on the pages of these products."
        : "Shows only on these product pages.",
    },
    {
      value: "collections",
      label: "Products in collections",
      hint: homeKind
        ? "Shows only on product pages in these collections."
        : "Shows on the product pages of everything in these collections.",
    },
  ];

  return (
    <>
      <Card
        title="Add to your theme"
        description="Opens your theme editor with the widget ready to place. Select Save when you're done."
      >
        <ol className={styles.steps}>
          {meta.kind === "REEL_POPS" && (
            <li data-done={theme?.embedOn || undefined}>
              <span className={styles.stepText}>
                <strong>Turn on the app embed</strong>
                <span className={styles.hint}>
                  {theme === null
                    ? "The floating player lives in the app embed. Turn it on in your theme editor."
                    : theme.embedOn
                      ? "On in your live theme."
                      : "The app embed is off in your live theme, so the floating player can't appear yet."}
                </span>
              </span>
              {!theme?.embedOn && (
                <s-button variant="primary" href={themeEditorUrl(apiKey)} target="_top">
                  Turn on
                </s-button>
              )}
            </li>
          )}
          {meta.kind !== "REEL_POPS" && (
            <li data-done={placed || undefined}>
              <span className={styles.stepText}>
                <strong>Add the {meta.name.toLowerCase()} block</strong>
                <span className={styles.hint}>
                  {placed ? "Placed in your live theme." : `${meta.placement}. Drag it anywhere you like afterwards.`}
                </span>
                <span className={styles.hint}>
                  In the block’s <strong>Widget</strong> setting, pick “{state.name}”. With nothing picked, the
                  block shows your most recently saved live {meta.name.toLowerCase()}.
                </span>
              </span>
              <s-button variant={placed ? "secondary" : "primary"} href={themeEditorUrl(apiKey, meta.kind)} target="_top">
                {placed ? "Add another" : "Add block"}
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
                  {rule.items?.find((i) => i.handle === handle)?.title ?? handle}
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

      {productOnlyConflict && (
        <div className={styles.notice} role="status">
          <p>
            This widget only shows on product pages for the products you picked, but Products isn&rsquo;t one of
            the page types below, so it won&rsquo;t show anywhere. Add Products, or show it everywhere.
          </p>
        </div>
      )}

      <Card title="Pages and devices">
        <ChipToggleGroup
          label="Page types"
          hint={state.pageTypes.length === 0 ? "None selected. Shows on every page type." : undefined}
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

// After a delete the page navigates away itself; re-running this loader
// first would 404 and replace the page with the error screen.
export const shouldRevalidate: ShouldRevalidateFunction = ({ actionResult, defaultShouldRevalidate }) => {
  if (actionResult && typeof actionResult === "object" && "deleted" in actionResult && actionResult.deleted) {
    return false;
  }
  return defaultShouldRevalidate;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
