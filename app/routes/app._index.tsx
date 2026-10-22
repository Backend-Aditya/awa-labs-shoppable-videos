import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
import { useLoaderData, useNavigate, useNavigation, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { listReels } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import { listWidgetsForShop } from "../models/widget.server";
import { getKindMeta } from "../models/widget-kinds";
import { getDashboardStats, parseRange, reelKey } from "../models/analytics.server";
import prisma from "../db.server";
import { planFor, usageLevel } from "../models/plans";
import { KindSchematic } from "../components/widget-editor/KindSchematic";
import { ViewsChart } from "../components/ViewsChart";
import type { WidgetKind } from "../models/widget-kinds";
import styles from "../components/widget-editor/dashboard.module.css";
import { log } from "../lib/logger.server";
import { useThemeStatus } from "../components/useThemeStatus";
import type { ThemeStatus } from "../components/useThemeStatus";
import { themeEditorUrl } from "../components/themeEditor";
import { handleRovingKeys } from "../components/widget-editor/controls";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const days = parseRange(new URL(request.url).searchParams.get("days"));
  // Each source degrades on its own: a slow Shopify API or analytics query
  // hides that card instead of taking the whole page down.
  const now = new Date();
  const monthViews = await prisma.reelDailyStat
    .aggregate({
      where: { shopId: shop.id, day: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } },
      _sum: { views: true },
    })
    .then((r) => r._sum.views ?? 0)
    .catch(() => 0);
  const [reelsResult, widgetsResult, statsResult] = await Promise.allSettled([
    listReels(admin),
    listWidgetsForShop(shop.id),
    getDashboardStats(shop.id, days),
  ]);
  for (const result of [reelsResult, widgetsResult, statsResult]) {
    if (result.status === "rejected") {
      if (result.reason instanceof Response) throw result.reason;
      log.error("overview.load_failed", { shop: session.shop }, result.reason);
    }
  }
  const reels = reelsResult.status === "fulfilled" ? reelsResult.value : [];
  const widgets = widgetsResult.status === "fulfilled" ? widgetsResult.value : [];
  const stats = statsResult.status === "fulfilled" ? statsResult.value : null;

  const reelsByKey = new Map(reels.map((r) => [reelKey(r.id), r]));
  const topReels = (stats?.reels ?? [])
    .filter((r) => reelsByKey.has(r.key))
    .slice(0, 8)
    .map((r) => {
      const reel = reelsByKey.get(r.key)!;
      return { ...r, id: reel.id, title: reel.title, posterUrl: reel.config.posterUrl ?? null };
    });

  return {
    shopDomain: session.shop,
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    hasBrand: shop.brand != null,
    planName: planFor(shop.plan).name,
    viewUsage: usageLevel(monthViews, shop.viewCapMonthly),
    reelUsage: usageLevel(reels.length, planFor(shop.plan).reelLimit),
    monthViews,
    viewCap: shop.viewCapMonthly,
    reelLimit: planFor(shop.plan).reelLimit,
    partial: [reelsResult, widgetsResult, statsResult].some((r) => r.status === "rejected"),
    firstUntaggedKey: reels.find((r) => (r.config.productIds ?? []).length === 0) ? reelKey(reels.find((r) => (r.config.productIds ?? []).length === 0)!.id) : null,
    reelCount: reels.length,
    readyCount: reels.filter((r) => deriveReelStatus(r.config) === "ready").length,
    taggedCount: reels.filter((r) => (r.config.productIds ?? []).length > 0).length,
    widgets: widgets.map((w) => ({ id: w.id, name: w.name, type: w.type, published: w.published })),
    stats: stats ? { days: stats.days, current: stats.current, previous: stats.previous, daily: stats.daily } : null,
    topReels,
  };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;

const EMBED_KEY = "reelup-embed-opened";
const CHECKLIST_DONE_KEY = "reelup-checklist-complete";

function formatMoney(amount: number, currencyCode: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currencyCode}`;
  }
}

function change(current: number, previous: number) {
  if (previous === 0) return current === 0 ? null : { label: "New", up: true };
  const pct = ((current - previous) / previous) * 100;
  return { label: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`, up: pct >= 0 };
}

// Rates change in percentage points, not percent of a percent (2% → 3% is
// "+1.0 pt", not "+50%").
function pointChange(current: number, previous: number, hadData: boolean) {
  if (!hadData) return current === 0 ? null : { label: "New", up: true };
  const diff = current - previous;
  if (Math.abs(diff) < 0.05) return null;
  return { label: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pt`, up: diff >= 0 };
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const theme = useThemeStatus();
  // Blocks load the player themselves; only the floating player needs the
  // app embed.
  const livePops = data.widgets.some((w) => w.published && w.type === "REEL_POPS");
  const embedOff = theme !== null && !theme.embedOn;

  return (
    <s-page heading="Home" inlineSize="large">
      <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/reels?upload=1")}>
        Upload videos
      </s-button>
      <div className={styles.page}>
        {data.partial && (
          <s-banner tone="warning" heading="Some information couldn't be loaded">
            Shopify took too long to respond. Reload the page to try again.
          </s-banner>
        )}
        {embedOff && livePops && (
          <s-banner tone="critical" heading="Your floating player isn't showing on your store">
            It lives in the app embed, which is turned off in your theme.{" "}
            <s-link href={themeEditorUrl(data.apiKey)} target="_top">
              Turn on the app embed
            </s-link>
          </s-banner>
        )}

        {(data.viewUsage !== "ok" || data.reelUsage !== "ok") && (
          <s-banner
            tone={data.viewUsage === "over" || data.reelUsage === "over" ? "critical" : "warning"}
            heading={
              data.reelUsage === "over"
                ? `You've used all ${data.reelLimit.toLocaleString()} videos on ${data.planName}`
                : data.viewUsage === "over"
                  ? `You've passed ${data.viewCap.toLocaleString()} views this month on ${data.planName}`
                  : `You're close to your ${data.planName} plan limit`
            }
          >
            {data.reelUsage !== "ok"
              ? `${data.reelCount.toLocaleString()} of ${data.reelLimit.toLocaleString()} videos used. `
              : ""}
            {data.viewUsage !== "ok"
              ? `${data.monthViews.toLocaleString()} of ${data.viewCap.toLocaleString()} views this month. `
              : ""}
            <s-link href="/app/pricing">See plans</s-link>
          </s-banner>
        )}

        <Checklist data={data} theme={theme} />

        {data.stats ? <Performance stats={data.stats} /> : null}

        <div className={styles.split}>
          <TopVideos data={data} />
          <section className={styles.card}>
            <header className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Widgets</h2>
              <button type="button" className={styles.link} onClick={() => navigate("/app/widgets")}>
                Manage
              </button>
            </header>
            {data.widgets.length === 0 ? (
              <div className={styles.empty}>
                <p>No widgets yet. A widget decides where and how your videos appear.</p>
                <s-button onClick={() => navigate("/app/widgets?create=1")}>Create widget</s-button>
              </div>
            ) : (
              <>
                <ul className={styles.widgetList}>
                  {data.widgets.slice(0, 6).map((w) => (
                    <li key={w.id}>
                      <button
                        type="button"
                        className={styles.widgetRow}
                        onClick={() => navigate(`/app/widgets/${encodeURIComponent(w.id)}`)}
                      >
                        <span className={styles.widgetIcon}>
                          <KindSchematic kind={w.type as WidgetKind} />
                        </span>
                        <span className={styles.widgetText}>
                          <span className={styles.widgetName}>{w.name}</span>
                          <span className={styles.muted}>{getKindMeta(w.type)?.name ?? "Unsupported widget"}</span>
                        </span>
                        <span className={styles.status} data-live={w.published || undefined}>
                          {w.published ? "Live" : "Draft"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {data.widgets.length > 6 && (
                  <button type="button" className={styles.link} onClick={() => navigate("/app/widgets")}>
                    +{data.widgets.length - 6} more
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </s-page>
  );
}

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

// Switches the reporting window without leaving Home; the card dims while
// the new numbers load instead of the page jumping.
function RangePicker({ days }: { days: number }) {
  const [, setSearchParams] = useSearchParams();
  const choose = (next: number) => {
    if (next === days) return;
    setSearchParams(next === 30 ? {} : { days: String(next) }, { preventScrollReset: true });
  };
  return (
    <div /* eslint-disable-line jsx-a11y/interactive-supports-focus -- roving tabindex: the chosen child is the tab stop */
      className={styles.range}
      role="radiogroup"
      aria-label="Reporting period"
      onKeyDown={(e) => handleRovingKeys(e, RANGES.map((r) => r.days), days, choose)}
    >
      {RANGES.map((r) => (
        <button
          key={r.days}
          type="button"
          role="radio"
          aria-checked={r.days === days}
          tabIndex={r.days === days ? 0 : -1}
          className={styles.rangeOption}
          onClick={() => choose(r.days)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function Performance({ stats }: { stats: NonNullable<Data["stats"]> }) {
  const navigation = useNavigation();
  const loading = navigation.state === "loading" && navigation.location?.pathname === "/app";
  const { current, previous } = stats;
  const ctr = current.views ? (current.clicks / current.views) * 100 : 0;
  const prevCtr = previous.views ? (previous.clicks / previous.views) * 100 : 0;
  const atc = current.views ? (current.addToCarts / current.views) * 100 : 0;
  const prevAtc = previous.views ? (previous.addToCarts / previous.views) * 100 : 0;
  // Revenue is never summed across currencies; show the main one and note
  // when there are others.
  const revenue = current.revenue[0];
  const prevRevenue = previous.revenue.find((r) => r.currencyCode === revenue?.currencyCode)?.amount ?? 0;
  const otherCurrencies = current.revenue.length - 1;

  return (
    <section className={styles.card} data-loading={loading || undefined} aria-busy={loading}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Last {stats.days} days</h2>
          <span className={styles.muted}>Compared with the {stats.days} days before</span>
        </div>
        <RangePicker days={stats.days} />
      </header>
      <div className={styles.kpis}>
        <Kpi label="Video views" value={current.views.toLocaleString()} delta={change(current.views, previous.views)} />
        <Kpi label="Product clicks" value={current.clicks.toLocaleString()} delta={change(current.clicks, previous.clicks)} />
        <Kpi label="Click rate" value={`${ctr.toFixed(1)}%`} delta={pointChange(ctr, prevCtr, previous.views > 0)} />
        <Kpi label="Add to carts" value={current.addToCarts.toLocaleString()} delta={change(current.addToCarts, previous.addToCarts)} />
        <Kpi label="Add-to-cart rate" value={`${atc.toFixed(1)}%`} delta={pointChange(atc, prevAtc, previous.views > 0)} />
        <Kpi
          label="Sales from videos"
          value={revenue ? formatMoney(revenue.amount, revenue.currencyCode) : "—"}
          sub={`${current.orders} order${current.orders === 1 ? "" : "s"}${otherCurrencies > 0 ? ` · +${otherCurrencies} other currenc${otherCurrencies === 1 ? "y" : "ies"}` : ""}`}
          delta={revenue ? change(revenue.amount, prevRevenue) : null}
        />
      </div>
      <ViewsChart daily={stats.daily} />
    </section>
  );
}

type SortKey = "views" | "clicks" | "carts" | "rate" | "sales";
const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "views", label: "Views" },
  { key: "clicks", label: "Clicks" },
  { key: "carts", label: "Add to cart" },
  { key: "rate", label: "Click rate" },
  { key: "sales", label: "Sales" },
];

function TopVideos({ data }: { data: Data }) {
  const navigate = useNavigate();
  const currency = data.stats?.current.revenue[0]?.currencyCode;
  const multiCurrency = (data.stats?.current.revenue.length ?? 0) > 1;
  // Click a column to rank by it; click again to flip the order.
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "sales", desc: true });
  const metric = (r: Data["topReels"][number]) =>
    sort.key === "views"
      ? r.views
      : sort.key === "clicks"
        ? r.clicks
        : sort.key === "carts"
          ? r.addToCarts
          : sort.key === "rate"
            ? r.views
              ? r.clicks / r.views
              : -1
            : r.revenue * 1e6 + r.unitsSold * 1e3 + r.views / 1e3;
  const rows = [...data.topReels].sort((a, b) => (sort.desc ? metric(b) - metric(a) : metric(a) - metric(b)));
  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Top videos</h2>
        <button type="button" className={styles.link} onClick={() => navigate("/app/reels")}>
          All videos
        </button>
      </header>
      {data.topReels.length === 0 ? (
        <p className={styles.empty}>Views and sales show up here once shoppers start watching.</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Video</th>
                {SORT_COLUMNS.map((col) => {
                  const active = sort.key === col.key;
                  return (
                    <th key={col.key} scope="col" aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
                      <button
                        type="button"
                        className={styles.sortButton}
                        data-active={active || undefined}
                        onClick={() => setSort(active ? { key: col.key, desc: !sort.desc } : { key: col.key, desc: true })}
                      >
                        {col.label}
                        <span className={styles.sortArrow} aria-hidden="true">
                          {active ? (sort.desc ? "↓" : "↑") : "↕"}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    <button
                      type="button"
                      className={styles.reelLink}
                      onClick={() => navigate(`/app/reels/${r.id.split("/").pop()}`)}
                    >
                      <span
                        className={styles.thumb}
                        style={r.posterUrl ? { backgroundImage: `url("${r.posterUrl}")` } : undefined}
                      />
                      <span className={styles.reelTitle}>{r.title}</span>
                    </button>
                  </th>
                  <td>{r.views.toLocaleString()}</td>
                  <td>{r.clicks.toLocaleString()}</td>
                  <td>{r.addToCarts.toLocaleString()}</td>
                  <td>{r.views ? `${((r.clicks / r.views) * 100).toFixed(1)}%` : "—"}</td>
                  <td>
                    {r.revenue && currency && !multiCurrency
                      ? formatMoney(r.revenue, currency)
                      : r.unitsSold
                        ? `${r.unitsSold} sold`
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  delta: { label: string; up: boolean } | null;
}) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>{value}</span>
      <span className={styles.kpiFoot}>
        {delta && (
          <span className={styles.delta} data-up={delta.up || undefined}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d={delta.up ? "M5 2 9 7H1z" : "M5 8 1 3h8z"} fill="currentColor" />
            </svg>
            <span className={styles.srOnly}>{delta.up ? "Up" : "Down"} </span>
            {delta.label}
          </span>
        )}
        {sub && <span className={styles.muted}>{sub}</span>}
      </span>
    </div>
  );
}

function Checklist({ data, theme }: { data: Data; theme: ThemeStatus | null }) {
  const navigate = useNavigate();
  const [embedOpened, setEmbedOpened] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // The card is hidden until the saved "hidden" flag has been read and the
  // theme has reported its state (or a short wait has passed), so it never
  // renders as "Get set up" for a moment and then disappears or recounts.
  const [storageRead, setStorageRead] = useState(false);
  const [themeWaited, setThemeWaited] = useState(false);
  useEffect(() => {
    try {
      setEmbedOpened(localStorage.getItem(EMBED_KEY) === "1");
      setDismissed(
        localStorage.getItem("reelup-checklist-dismissed") === "1" ||
          localStorage.getItem(CHECKLIST_DONE_KEY) === "1",
      );
    } catch {
      // Storage blocked: checklist just doesn't remember.
    }
    setStorageRead(true);
    const timer = setTimeout(() => setThemeWaited(true), 1500);
    return () => clearTimeout(timer);
  }, []);
  const ready = storageRead && (theme !== null || themeWaited);
  const allDone = data.reelCount > 0 &&
    data.taggedCount > 0 &&
    data.widgets.some((w) => w.published) &&
    data.hasBrand &&
    (theme ? theme.embedOn || theme.placedBlocks.size > 0 : embedOpened);
  useEffect(() => {
    if (!ready || !allDone) return;
    try {
      localStorage.setItem(CHECKLIST_DONE_KEY, "1");
    } catch {
      // ignore
    }
  }, [ready, allDone]);

  // Prefer the theme's real state; only fall back to "you opened the theme
  // editor" where the admin can't report it.
  const embedDone = theme ? theme.embedOn || theme.placedBlocks.size > 0 : embedOpened;
  const firstLive = data.widgets.find((w) => w.published)?.type;
  const steps = [
    { done: data.reelCount > 0, title: "Upload your first video", body: "MP4 or MOV, or import from Instagram and TikTok.", action: "Upload videos", go: () => navigate("/app/reels?upload=1") },
    {
      done: data.taggedCount > 0,
      title: "Tag products in a video",
      body: "Tagged products become shoppable cards in the player.",
      action: "Tag products",
      go: () => navigate(data.firstUntaggedKey ? `/app/reels/${data.firstUntaggedKey}?tab=products` : "/app/reels"),
    },
    { done: data.widgets.some((w) => w.published), title: "Put a widget live", body: "Pick where and how videos appear on your store.", action: "Create widget", go: () => navigate("/app/widgets?create=1") },
    {
      done: embedDone,
      title: "Add it to your theme",
      body:
        theme === null
          ? "Place your widget in the theme editor, then press Save there."
          : "Nothing's placed in your live theme yet — add your widget's block, then press Save.",
      action: "Open theme editor",
      go: () => {
        window.open(themeEditorUrl(data.apiKey, firstLive), "_top");
        try {
          localStorage.setItem(EMBED_KEY, "1");
        } catch {
          // ignore
        }
        setEmbedOpened(true);
      },
    },
    { done: data.hasBrand, title: "Match your brand", body: "Set button and accent colors once for every widget.", action: "Open brand kit", go: () => navigate("/app/settings") },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (!ready || dismissed || doneCount === steps.length) return null;
  const next = steps.findIndex((s) => !s.done);

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Get set up</h2>
          <span className={styles.muted}>
            {doneCount} of {steps.length} done
          </span>
        </div>
        <button
          type="button"
          className={styles.link}
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem("reelup-checklist-dismissed", "1");
            } catch {
              // ignore
            }
          }}
        >
          Hide
        </button>
      </header>
      <div className={styles.progress}>
        <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className={styles.steps}>
        {steps.map((step, i) => (
          <li key={step.title} className={styles.step} data-done={step.done || undefined} data-next={i === next || undefined}>
            <span className={styles.stepMark} aria-hidden="true">
              {step.done ? (
                <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.5l4.5-5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : null}
            </span>
            <span className={styles.stepText}>
              <span className={styles.stepTitle}>
                {step.title}
                {step.done && <span className={styles.srOnly}> (done)</span>}
              </span>
              {i === next && <span className={styles.muted}>{step.body}</span>}
            </span>
            {i === next && (
              <s-button variant="primary" onClick={step.go}>
                {step.action}
              </s-button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
