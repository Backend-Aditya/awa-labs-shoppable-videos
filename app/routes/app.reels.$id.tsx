import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs, ShouldRevalidateFunction } from "react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  generateReelHandle,
  getProductsByIds,
  getReel,
  syncProductReelMetafields,
  upsertReel,
} from "../models/reel.server";
import type { ReelConfig } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import { healProcessingReels } from "../models/reel-media.server";
import { releaseStreamAssets } from "../models/stream-assets.server";
import { deleteReelEverywhere } from "../models/reel-lifecycle.server";
import { formatDuration, isStreamThumbnail, posterAt } from "../models/reel-media";
import { getOrCreateShop } from "../models/shop.server";
import { listWidgetsForShop } from "../models/widget.server";
import { getKindMeta } from "../models/widget-kinds";
import type { WidgetConfig } from "../models/widget-kinds";
import { getReelStats } from "../models/analytics.server";
import { Card, Field, TextInput } from "../components/widget-editor/controls";
import { useEditorGuards } from "../components/useEditorGuards";
import { ViewsChart } from "../components/ViewsChart";
import { replaceReelVideo, validateVideoFile } from "../components/reels/upload";
import editorStyles from "../components/widget-editor/editor.module.css";
import styles from "../components/reels/editor.module.css";

const toGid = (numericId: string) => `gid://shopify/Metaobject/${numericId}`;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (!/^\d+$/.test(params.id ?? "")) throw new Response("Video not found", { status: 404 });
  const shop = await getOrCreateShop(session.shop);
  const found = await getReel(admin, toGid(params.id!));
  if (!found) throw new Response("Video not found", { status: 404 });
  const [reel] = await healProcessingReels(admin, [found], 1, (uids) => releaseStreamAssets(admin, shop.id, uids));

  let productsError = false;
  const [products, stats, widgets] = await Promise.all([
    getProductsByIds(admin, reel.config.productIds).catch((e) => {
      if (e instanceof Response) throw e;
      // Remembered so the editor never mistakes "couldn't load" for "none
      // tagged" and saves an empty list over the real one.
      productsError = true;
      return [];
    }),
    getReelStats(shop.id, reel.id, 30),
    listWidgetsForShop(shop.id),
  ]);

  const byId = new Map(products.map((p) => [p.id, p]));
  return {
    reel,
    productsError,
    status: deriveReelStatus(reel.config),
    products: reel.config.productIds
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ id: p.id, title: p.title, imageUrl: p.imageUrl, price: formatPrice(p.priceRange) })),
    stats,
    usedIn: widgets
      .filter((w) => {
        const config = w.config as unknown as WidgetConfig;
        return config.reelIds?.includes(reel.id) || config.featuredReelId === reel.id;
      })
      .map((w) => ({ id: w.id, name: w.name, kind: getKindMeta(w.type)?.name ?? w.type, published: w.published })),
  };
};

function formatPrice(range: { min: string; max: string; currencyCode: string } | null): string {
  if (!range) return "";
  try {
    const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency: range.currencyCode });
    return range.min === range.max ? fmt.format(Number(range.min)) : `From ${fmt.format(Number(range.min))}`;
  } catch {
    return range.min;
  }
}

type SavePayload = {
  title?: string;
  published?: boolean;
  productIds?: unknown;
  coverTimeSeconds?: number | null;
  linkLabel?: string;
  linkUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
};

type ActionResult = { ok: boolean; error: string | null; deleted?: boolean; duplicateKey?: string };

// https:// links, or paths on the store. Protocol-relative "//host" is
// rejected: it would send shoppers off-site while looking like a path.
const SAFE_LINK = /^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*)$/i;
export const MAX_PRODUCTS = 50;

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const reel = await getReel(admin, toGid(params.id ?? ""));
  if (!reel) throw new Response("Video not found", { status: 404 });

  try {
    if (request.headers.get("Content-Type")?.includes("application/json")) {
      const body = (await request.json()) as SavePayload;
      const title = String(body.title ?? "").trim().slice(0, 120);
      if (!title) return { ok: false, error: "Add a title for this video." };

      // Absent = the products weren't edited; keep what's stored.
      const productIds = Array.isArray(body.productIds)
        ? [...new Set(body.productIds.map(String).filter((id) => /^gid:\/\/shopify\/Product\/\d+$/.test(id)))].slice(0, MAX_PRODUCTS)
        : reel.config.productIds;

      const linkUrl = String(body.linkUrl ?? "").trim();
      const linkLabel = String(body.linkLabel ?? "").trim().slice(0, 40);
      if (linkUrl && !SAFE_LINK.test(linkUrl)) {
        return { ok: false, error: "Link must start with https:// or / (for a page on your store)." };
      }

      const duration = reel.config.durationSeconds ?? 0;
      const cover =
        typeof body.coverTimeSeconds === "number" && Number.isFinite(body.coverTimeSeconds)
          ? Math.min(Math.max(body.coverTimeSeconds, 0), Math.max(duration - 0.1, 0))
          : undefined;

      // Stale schedule fields from before scheduling was removed are dropped.
      const rest: ReelConfig & { publishAt?: string } = { ...reel.config };
      delete rest.publishAt;
      const config: ReelConfig = {
        ...rest,
        productIds,
        coverTimeSeconds: cover,
        posterUrl: reel.config.posterUrl && isStreamThumbnail(reel.config.posterUrl) ? posterAt(reel.config.posterUrl, cover) : reel.config.posterUrl,
        interactions: { ctaLabel: linkUrl ? linkLabel || undefined : undefined, ctaUrl: linkUrl || undefined },
        seoTitle: String(body.seoTitle ?? "").trim().slice(0, 70) || undefined,
        seoDescription: String(body.seoDescription ?? "").trim().slice(0, 160) || undefined,
      };

      await upsertReel(admin, reel.handle, title, body.published === true, config);
      const before = reel.config.productIds;
      if (before.length !== productIds.length || before.some((id, i) => id !== productIds[i])) {
        await syncProductReelMetafields(admin, reel.id, before, productIds);
      }
      return { ok: true, error: null };
    }

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "delete") {
      await deleteReelEverywhere(admin, shop.id, reel);
      return { ok: true, error: null, deleted: true };
    }

    if (intent === "duplicate") {
      // Same Stream video, separate catalogue entry; starts as a draft.
      const copyConfig: ReelConfig = { ...reel.config, replacingStreamUid: undefined, uploadFailedAt: undefined };
      const copyTitle = `${reel.title.slice(0, 112)} (copy)`;
      const copy = await upsertReel(admin, generateReelHandle(copyTitle), copyTitle, false, copyConfig);
      if (reel.config.productIds.length > 0) {
        await syncProductReelMetafields(admin, copy.id, [], reel.config.productIds);
      }
      return { ok: true, error: null, duplicateKey: copy.id.split("/").pop() };
    }

    return { ok: false, error: "Unknown request." };
  } catch (e) {
    if (e instanceof Response) throw e;
    return { ok: false, error: "Couldn't save. Check your connection and try again." };
  }
};

/* ------------------------------------------------------------------ state */

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;
type Product = LoaderData["products"][number];

interface EditorState {
  title: string;
  published: boolean;
  products: Product[];
  coverTimeSeconds: number;
  linkLabel: string;
  linkUrl: string;
  seoTitle: string;
  seoDescription: string;
}

function stateFrom(data: LoaderData): EditorState {
  const c = data.reel.config;
  return {
    title: data.reel.title,
    published: data.reel.published,
    products: data.products,
    coverTimeSeconds: c.coverTimeSeconds ?? 0,
    linkLabel: c.interactions?.ctaLabel ?? "",
    linkUrl: c.interactions?.ctaUrl ?? "",
    seoTitle: c.seoTitle ?? "",
    seoDescription: c.seoDescription ?? "",
  };
}

const comparable = (s: EditorState) => JSON.stringify({ ...s, products: s.products.map((p) => p.id) });

const TABS = [
  { id: "details", label: "Details" },
  { id: "products", label: "Products" },
  { id: "cover", label: "Cover" },
  { id: "seo", label: "Search" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function ReelEditor() {
  const data = useLoaderData<typeof loader>();
  const { reel, status, stats, usedIn } = data;
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const { revalidate } = useRevalidator();
  const saveFetcher = useFetcher<ActionResult>();
  const actionFetcher = useFetcher<ActionResult>();
  const fileRef = useRef<HTMLInputElement>(null);

  const baseline = useMemo(() => stateFrom(data), [data]);
  const [state, setState] = useState<EditorState>(baseline);
  const [tab, setTab] = useState<TabId>("details");
  const [replaceProgress, setReplaceProgress] = useState<number | null>(null);

  const baselineKey = comparable(baseline);
  useEffect(() => setState(baseline), [baselineKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = comparable(state) !== baselineKey;
  const productsTouched =
    JSON.stringify(state.products.map((p) => p.id)) !== JSON.stringify(baseline.products.map((p) => p.id));
  const saving = saveFetcher.state !== "idle";
  const update = (patch: Partial<EditorState>) => setState((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    if (saveFetcher.state !== "idle" || !saveFetcher.data) return;
    if (saveFetcher.data.ok) shopify.toast.show("Video saved");
    else if (saveFetcher.data.error) shopify.toast.show(saveFetcher.data.error, { isError: true });
  }, [saveFetcher.state, saveFetcher.data, shopify]);

  useEffect(() => {
    const result = actionFetcher.data;
    if (actionFetcher.state !== "idle" || !result) return;
    if (result.deleted) {
      shopify.toast.show("Video deleted");
      allowNextNavigation();
      navigate("/app/reels");
    } else if (result.duplicateKey) {
      shopify.toast.show("Copy created as a draft");
      allowNextNavigation();
      navigate(`/app/reels/${result.duplicateKey}`);
    } else if (result.error) {
      shopify.toast.show(result.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- allowNextNavigation only flips a ref
  }, [actionFetcher.state, actionFetcher.data, navigate, shopify]);

  // While Stream is still processing, re-check every 10s so the page flips
  // to "Ready" on its own (the loader asks Cloudflare directly).
  const waiting = status === "processing" || Boolean(reel.config.replacingStreamUid);
  useEffect(() => {
    if (!waiting || dirty) return;
    const timer = setInterval(() => revalidate(), 10_000);
    return () => clearInterval(timer);
  }, [waiting, dirty, revalidate]);

  const save = () => {
    saveFetcher.submit(
      JSON.stringify({
        title: state.title,
        published: state.published,
        ...(productsTouched ? { productIds: state.products.map((p) => p.id) } : {}),
        coverTimeSeconds: state.coverTimeSeconds,
        linkLabel: state.linkLabel,
        linkUrl: state.linkUrl,
        seoTitle: state.seoTitle,
        seoDescription: state.seoDescription,
      }),
      { method: "post", encType: "application/json" },
    );
  };

  const { allowNextNavigation } = useEditorGuards({ dirty, onSave: save, saving });

  const submitIntent = (intent: "delete" | "duplicate") => {
    const formData = new FormData();
    formData.set("intent", intent);
    actionFetcher.submit(formData, { method: "post" });
  };

  const replace = async (file: File) => {
    const invalid = validateVideoFile(file);
    if (invalid) {
      shopify.toast.show(invalid, { isError: true });
      return;
    }
    setReplaceProgress(0);
    try {
      await replaceReelVideo(reel.id, file, setReplaceProgress);
      shopify.toast.show("New video uploaded — the current one stays live until it's ready");
      revalidate();
    } catch (e) {
      shopify.toast.show(e instanceof Error ? e.message : "Upload failed.", { isError: true });
    } finally {
      setReplaceProgress(null);
    }
  };

  const posterNow = reel.config.posterUrl
    ? isStreamThumbnail(reel.config.posterUrl)
      ? posterAt(reel.config.posterUrl, state.coverTimeSeconds)
      : reel.config.posterUrl
    : null;

  return (
    <s-page heading={state.title || reel.title} inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app/reels">
        Reels
      </s-link>
      <s-button slot="secondary-actions" onClick={() => fileRef.current?.click()} disabled={replaceProgress !== null}>
        Replace video
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() => submitIntent("duplicate")}
        disabled={actionFetcher.state !== "idle"}
        loading={actionFetcher.state !== "idle" && actionFetcher.formData?.get("intent") === "duplicate"}
      >
        Duplicate
      </s-button>
      <s-button slot="secondary-actions" tone="critical" commandFor="delete-reel-modal" command="--show">
        Delete
      </s-button>
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) replace(file);
        }}
      />

      <SaveBar id="reel-save-bar" open={dirty} discardConfirmation>
        <button variant="primary" onClick={save} loading={saving ? "" : undefined} disabled={saving}>
          Save
        </button>
        <button onClick={() => setState(baseline)} disabled={saving}>
          Discard
        </button>
      </SaveBar>

      <div className={editorStyles.shell}>
        <div className={editorStyles.settingsColumn}>
          <div className={editorStyles.statusBar}>
            <span className={editorStyles.statusDot} data-live={(state.published && status === "ready") || undefined} />
            <div className={editorStyles.statusText}>
              <p className={editorStyles.statusTitle}>
                {status !== "ready"
                  ? status === "failed"
                    ? "Upload failed"
                    : status === "processing"
                      ? "Processing video…"
                      : "No video yet"
                  : state.published
                    ? "Live on your store"
                    : "Draft"}
              </p>
              <p className={editorStyles.hint}>
                {replaceProgress !== null
                  ? `Uploading new video ${Math.round(replaceProgress * 100)}%`
                  : reel.config.replacingStreamUid
                    ? "New video processing — the current one stays live until it's ready."
                    : status === "processing"
                      ? "Usually takes under a minute. This page updates on its own."
                      : status === "failed"
                        ? "Use Replace video to try again."
                        : state.published
                          ? "Shown in every widget that includes it."
                          : "Hidden from your store until published."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.published}
              aria-label="Published"
              className={editorStyles.switch}
              onClick={() => update({ published: !state.published })}
            >
              <span className={editorStyles.switchThumb} />
            </button>
          </div>

          <div className={editorStyles.tabs} role="tablist" aria-label="Video settings">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                className={editorStyles.tab}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === "products" && state.products.length > 0 && (
                  <span className={styles.tabCount}>{state.products.length}</span>
                )}
              </button>
            ))}
          </div>

          <div className={editorStyles.tabPanel} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "details" && <DetailsTab state={state} update={update} source={reel.config.source} />}
            {tab === "products" &&
              (data.productsError ? (
                <s-banner tone="critical" heading="Couldn't load this video's products">
                  Shopify didn&rsquo;t respond in time. Reload the page to edit products — your other changes can still be
                  saved and the tags are untouched.
                </s-banner>
              ) : (
                <ProductsTab products={state.products} onChange={(products) => update({ products })} />
              ))}
            {tab === "cover" && (
              <CoverTab
                posterUrl={reel.config.posterUrl ?? null}
                duration={reel.config.durationSeconds ?? 0}
                value={state.coverTimeSeconds}
                onChange={(coverTimeSeconds) => update({ coverTimeSeconds })}
              />
            )}
            {tab === "seo" && <SeoTab state={state} update={update} />}
          </div>
        </div>

        <div className={editorStyles.previewColumn}>
          <div className={styles.side}>
            <section className={styles.playerCard}>
              <div className={styles.player}>
                {reel.config.cloudflareStreamUid && status === "ready" ? (
                  <iframe
                    src={`https://iframe.videodelivery.net/${encodeURIComponent(reel.config.cloudflareStreamUid)}?poster=${encodeURIComponent(posterNow ?? "")}`}
                    title={`Preview of ${reel.title}`}
                    allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <div className={styles.playerPlaceholder}>
                    {status === "processing" && <span className={styles.bigSpinner} aria-hidden="true" />}
                    <span>{status === "processing" ? "Processing" : status === "failed" ? "Upload failed" : "No video"}</span>
                  </div>
                )}
              </div>
              <ShopPreview state={state} />
            </section>

            <section className={styles.card}>
              <header className={styles.cardHead}>
                <h2>Last {stats.days} days</h2>
              </header>
              <div className={styles.kpis}>
                <Kpi label="Views" value={stats.views.toLocaleString()} />
                <Kpi label="Product clicks" value={stats.clicks.toLocaleString()} />
                <Kpi label="Click rate" value={stats.views ? `${((stats.clicks / stats.views) * 100).toFixed(1)}%` : "—"} />
                <Kpi
                  label="Sales"
                  value={stats.revenue[0] ? formatMoney(stats.revenue[0].amount, stats.revenue[0].currencyCode) : "—"}
                  sub={stats.unitsSold ? `${stats.unitsSold} sold` : undefined}
                />
              </div>
              <ViewsChart daily={stats.daily} title="Daily views" />
            </section>

            <section className={styles.card}>
              <header className={styles.cardHead}>
                <h2>Shown in</h2>
              </header>
              {usedIn.length === 0 ? (
                <p className={styles.muted}>
                  Not in any widget yet.{" "}
                  <button type="button" className={styles.link} onClick={() => navigate("/app/widgets")}>
                    Add it to a widget
                  </button>
                </p>
              ) : (
                <ul className={styles.usedIn}>
                  {usedIn.map((w) => (
                    <li key={w.id}>
                      <button type="button" className={styles.usedRow} onClick={() => navigate(`/app/widgets/${encodeURIComponent(w.id)}`)}>
                        <span>
                          <span className={styles.usedName}>{w.name}</span>
                          <span className={styles.muted}>{w.kind}</span>
                        </span>
                        <span className={styles.status} data-live={w.published || undefined}>
                          {w.published ? "Live" : "Draft"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>

      <s-modal id="delete-reel-modal" heading="Delete this video?">
        <s-paragraph>
          {reel.title} will be removed from your store, from {usedIn.length || "any"} widget{usedIn.length === 1 ? "" : "s"} showing
          it, and from its tagged products. This can&rsquo;t be undone.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={actionFetcher.state !== "idle"}
          onClick={() => submitIntent("delete")}
        >
          Delete video
        </s-button>
        <s-button slot="secondary-actions" commandFor="delete-reel-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

function formatMoney(amount: number, currencyCode: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${currencyCode}`;
  }
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={styles.kpi}>
      <span className={styles.muted}>{label}</span>
      <span className={styles.kpiValue}>{value}</span>
      {sub && <span className={styles.muted}>{sub}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ tabs */

function DetailsTab({
  state,
  update,
  source,
}: {
  state: EditorState;
  update: (patch: Partial<EditorState>) => void;
  source: ReelConfig["source"];
}) {
  return (
    <>
      <Card title="Title" description="Shown on the video in the player, and as the caption in widgets that show titles.">
        <TextInput label="Video title" value={state.title} maxLength={120} onChange={(title) => update({ title })} />
        {source.type !== "upload" && (
          <p className={editorStyles.hint}>
            Imported from {source.type === "instagram" ? "Instagram" : "TikTok"}
            {source.originalUrl && (
              <>
                {" · "}
                <a href={source.originalUrl} target="_blank" rel="noreferrer">
                  view original
                </a>
              </>
            )}
          </p>
        )}
      </Card>

      <Card
        title="Link button"
        description="An extra button in the player — for a collection, a lookbook or anything not tagged as a product."
      >
        <TextInput
          label="Button text"
          value={state.linkLabel}
          maxLength={40}
          placeholder="Shop the collection"
          onChange={(linkLabel) => update({ linkLabel })}
        />
        <TextInput
          label="Link"
          value={state.linkUrl}
          maxLength={500}
          placeholder="/collections/summer or https://…"
          hint="Leave empty for no button."
          onChange={(linkUrl) => update({ linkUrl })}
        />
      </Card>
    </>
  );
}

function ProductsTab({ products, onChange }: { products: Product[]; onChange: (products: Product[]) => void }) {
  const shopify = useAppBridge();

  const pick = async () => {
    const result = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: products.map((p) => ({ id: p.id })),
    });
    if (!result) return;
    // Keep the merchant's existing order; append anything new at the end.
    const picked = result.map((p) => {
      const variants = (p as { variants?: { price?: string }[] }).variants ?? [];
      return {
        id: p.id,
        title: p.title,
        imageUrl: (p as { images?: { originalSrc?: string }[] }).images?.[0]?.originalSrc ?? null,
        price: variants[0]?.price ? String(variants[0].price) : "",
      };
    });
    const pickedIds = new Set(picked.map((p) => p.id));
    const kept = products.filter((p) => pickedIds.has(p.id));
    const added = picked.filter((p) => !products.some((x) => x.id === p.id));
    onChange([...kept, ...added]);
  };

  const move = (index: number, delta: number) => {
    const next = [...products];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };

  return (
    <Card
      title="Tagged products"
      description="Shoppers can add these to their cart from the video. The first one is featured on widget cards."
      action={<s-button onClick={pick}>{products.length ? "Add or remove" : "Choose products"}</s-button>}
    >
      {products.length === 0 ? (
        <div className={styles.emptyProducts}>
          <p>No products tagged. Videos with products convert — tag what&rsquo;s shown.</p>
          <s-button variant="primary" onClick={pick}>
            Choose products
          </s-button>
        </div>
      ) : (
        <ol className={styles.productList}>
          {products.map((p, i) => (
            <li key={p.id} className={styles.productRow}>
              <span className={styles.productIndex}>{i + 1}</span>
              <span
                className={styles.productThumb}
                style={p.imageUrl ? { backgroundImage: `url("${p.imageUrl}")` } : undefined}
              />
              <span className={styles.productText}>
                <span className={styles.productTitle}>{p.title}</span>
                <span className={styles.muted}>{i === 0 ? `Featured${p.price ? ` · ${p.price}` : ""}` : p.price}</span>
              </span>
              <IconButton label={`Move ${p.title} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <path d="M10 4.5a.75.75 0 0 1 .53.22l4.25 4.25a.75.75 0 1 1-1.06 1.06l-2.97-2.97v8.19a.75.75 0 0 1-1.5 0V7.06L6.28 10.03a.75.75 0 0 1-1.06-1.06l4.25-4.25A.75.75 0 0 1 10 4.5Z" />
              </IconButton>
              <IconButton label={`Move ${p.title} down`} disabled={i === products.length - 1} onClick={() => move(i, 1)}>
                <path d="M10 15.5a.75.75 0 0 1-.53-.22l-4.25-4.25a.75.75 0 1 1 1.06-1.06l2.97 2.97V4.75a.75.75 0 0 1 1.5 0v8.19l2.97-2.97a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-.53.22Z" />
              </IconButton>
              <IconButton label={`Remove ${p.title}`} onClick={() => onChange(products.filter((x) => x.id !== p.id))}>
                <path d="M5.72 5.72a.75.75 0 0 1 1.06 0L10 8.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L11.06 10l3.22 3.22a.75.75 0 1 1-1.06 1.06L10 11.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L8.94 10 5.72 6.78a.75.75 0 0 1 0-1.06Z" />
              </IconButton>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={editorStyles.iconButton} aria-label={label} disabled={disabled} onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

function CoverTab({
  posterUrl,
  duration,
  value,
  onChange,
}: {
  posterUrl: string | null;
  duration: number;
  value: number;
  onChange: (seconds: number) => void;
}) {
  if (!posterUrl || !isStreamThumbnail(posterUrl) || duration <= 0) {
    return (
      <Card title="Cover image">
        <p className={editorStyles.hint}>You can pick a cover frame once the video has finished processing.</p>
      </Card>
    );
  }
  const frames = Array.from({ length: 6 }, (_, i) => Math.round(((i + 0.5) * duration) / 6 * 10) / 10);
  return (
    <Card title="Cover image" description="The still shown before the video plays — in widgets, search results and link previews.">
      <div className={styles.coverLayout}>
        <img className={styles.coverPreview} src={posterAt(posterUrl, value)} alt="Selected cover frame" />
        <div className={styles.coverControls}>
          <Field label={`Frame at ${formatDuration(value) || "0:00"}`} htmlFor="cover-range">
            <input
              id="cover-range"
              className={editorStyles.range}
              type="range"
              min={0}
              max={Math.max(duration - 0.1, 0)}
              step={0.5}
              value={value}
              onChange={(e) => onChange(Number(e.currentTarget.value))}
            />
          </Field>
          <span className={editorStyles.label}>Suggested frames</span>
          <div className={styles.frames}>
            {frames.map((t) => (
              <button
                key={t}
                type="button"
                className={styles.frame}
                aria-pressed={Math.abs(t - value) < 0.25}
                aria-label={`Use frame at ${formatDuration(t)}`}
                onClick={() => onChange(t)}
              >
                <img src={posterAt(posterUrl, t)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function SeoTab({ state, update }: { state: EditorState; update: (patch: Partial<EditorState>) => void }) {
  const title = state.seoTitle || state.title;
  const description = state.seoDescription || state.title;
  return (
    <Card
      title="Search appearance"
      description="Every video is marked up for Google video results. These override the title when set."
    >
      <div className={styles.serp} aria-label="Search result preview">
        <span className={styles.serpUrl}>yourstore.com › products</span>
        <span className={styles.serpTitle}>{title}</span>
        <span className={styles.serpDesc}>{description}</span>
      </div>
      <TextInput
        label="Search title"
        value={state.seoTitle}
        maxLength={70}
        placeholder={state.title}
        hint={`${state.seoTitle.length}/70`}
        onChange={(seoTitle) => update({ seoTitle })}
      />
      <Field label="Search description" htmlFor="seo-description" hint={`${state.seoDescription.length}/160`}>
        <textarea
          id="seo-description"
          className={editorStyles.input}
          rows={3}
          maxLength={160}
          value={state.seoDescription}
          placeholder="What happens in this video, in a sentence or two."
          onChange={(e) => update({ seoDescription: e.currentTarget.value })}
        />
      </Field>
    </Card>
  );
}

/* --------------------------------------------------------------- preview */

// What the shopper sees under the video in the player: tagged products and
// the optional link button. Updates live with unsaved edits.
function ShopPreview({ state }: { state: EditorState }) {
  if (state.products.length === 0 && !state.linkUrl) {
    return <p className={styles.shopEmpty}>Tag products or add a link button to make this video shoppable.</p>;
  }
  return (
    <div className={styles.shop}>
      <span className={styles.shopTitle}>In the player</span>
      {state.products.slice(0, 3).map((p) => (
        <div key={p.id} className={styles.shopRow}>
          <span className={styles.shopThumb} style={p.imageUrl ? { backgroundImage: `url("${p.imageUrl}")` } : undefined} />
          <span className={styles.shopText}>
            <span className={styles.productTitle}>{p.title}</span>
            {p.price && <span className={styles.muted}>{p.price}</span>}
          </span>
          <span className={styles.shopCta}>Add to cart</span>
        </div>
      ))}
      {state.products.length > 3 && <span className={styles.muted}>+{state.products.length - 3} more</span>}
      {state.linkUrl && <span className={styles.shopLink}>{state.linkLabel || "Learn more"} ›</span>}
    </div>
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
