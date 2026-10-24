import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { useLoaderData, useNavigate, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import { listReels } from "../models/reel.server";
import { getDashboardStats, parseRange, reelKey } from "../models/analytics.server";
import { deriveKpis, formatWatchTime, formatPercent, funnel, percent, toCsv } from "../models/kpis";
import { log } from "../lib/logger.server";
import { ViewsChart } from "../components/ViewsChart";
import { Kpi, RangePicker, change, formatMoney, pointChange } from "../components/analytics-ui";
import styles from "../components/widget-editor/dashboard.module.css";
import own from "../components/analytics.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const days = parseRange(new URL(request.url).searchParams.get("days"));
  // Like Home: a slow Shopify API only costs the video titles, not the numbers.
  const [reelsResult, statsResult] = await Promise.allSettled([listReels(admin), getDashboardStats(shop.id, days)]);
  for (const result of [reelsResult, statsResult]) {
    if (result.status === "rejected") {
      if (result.reason instanceof Response) throw result.reason;
      log.error("analytics.load_failed", { shop: session.shop }, result.reason);
    }
  }
  const reels = reelsResult.status === "fulfilled" ? reelsResult.value : [];
  const stats = statsResult.status === "fulfilled" ? statsResult.value : null;

  // Every video in the library, with whatever it did in the period, a
  // video nobody watched is worth knowing about too.
  const perReel = new Map((stats?.reels ?? []).map((r) => [r.key, r]));
  const rows = reels.map((reel) => {
    const key = reelKey(reel.id);
    const row = perReel.get(key);
    return {
      key,
      title: reel.title,
      posterUrl: reel.config.posterUrl ?? null,
      views: row?.views ?? 0,
      clicks: row?.clicks ?? 0,
      addToCarts: row?.addToCarts ?? 0,
      completions: row?.completions ?? 0,
      watchSeconds: row?.watchSeconds ?? 0,
      unitsSold: row?.unitsSold ?? 0,
      revenue: row?.revenue ?? 0,
    };
  });

  return {
    days,
    partial: reelsResult.status === "rejected" || statsResult.status === "rejected",
    stats: stats ? { current: stats.current, previous: stats.previous, daily: stats.daily } : null,
    rows,
  };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type Row = Data["rows"][number];

export default function Analytics() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const loading = navigation.state === "loading" && navigation.location?.pathname === "/app/analytics";

  return (
    <s-page heading="Analytics" inlineSize="large">
      <div className={styles.page} data-loading={loading || undefined} aria-busy={loading}>
        {data.partial && (
          <s-banner tone="warning" heading="Some information couldn't be loaded">
            Shopify took too long to respond. Reload the page to try again.
          </s-banner>
        )}
        {data.stats ? <Overview days={data.days} stats={data.stats} loading={loading} /> : null}
        <VideoTable rows={data.rows} days={data.days} currency={data.stats?.current.revenue[0]?.currencyCode ?? null} multiCurrency={(data.stats?.current.revenue.length ?? 0) > 1} />
      </div>
    </s-page>
  );
}

function Overview({ days, stats, loading }: { days: number; stats: NonNullable<Data["stats"]>; loading: boolean }) {
  const { current, previous } = stats;
  // Money is never summed across currencies: the main one, and a note.
  const sales = current.revenue[0];
  const prevSales = previous.revenue.find((r) => r.currencyCode === sales?.currencyCode)?.amount ?? 0;
  const now = deriveKpis({ ...current, revenue: sales?.amount ?? 0 });
  const before = deriveKpis({ ...previous, revenue: prevSales });
  const others = current.revenue.length - 1;
  const steps = funnel(current);

  return (
    <>
      <section className={styles.card} data-loading={loading || undefined}>
        <header className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Last {days} days</h2>
            <span className={styles.muted}>Compared with the {days} days before</span>
          </div>
          <RangePicker days={days} />
        </header>
        <h3 className={own.groupTitle}>Engagement</h3>
        <div className={styles.kpis}>
          <Kpi label="Video views" value={current.views.toLocaleString()} delta={change(current.views, previous.views)} />
          <Kpi
            label="Avg. watch time"
            value={formatWatchTime(now.avgWatchSeconds)}
            sub="per view"
            delta={now.avgWatchSeconds !== null && before.avgWatchSeconds ? change(now.avgWatchSeconds, before.avgWatchSeconds) : null}
          />
          <Kpi label="Completion rate" value={formatPercent(now.completionRate)} sub="watched to the end" delta={pointChange(now.completionRate, before.completionRate)} />
          <Kpi label="Click rate" value={formatPercent(now.clickRate)} sub={`${current.clicks.toLocaleString()} product taps`} delta={pointChange(now.clickRate, before.clickRate)} />
        </div>
        <h3 className={own.groupTitle}>Shopping</h3>
        <div className={styles.kpis}>
          <Kpi label="Adds to cart" value={current.addToCarts.toLocaleString()} delta={change(current.addToCarts, previous.addToCarts)} />
          <Kpi label="Add-to-cart rate" value={formatPercent(now.addToCartRate)} sub="of views" delta={pointChange(now.addToCartRate, before.addToCartRate)} />
          <Kpi
            label="Sales from videos"
            value={sales ? formatMoney(sales.amount, sales.currencyCode) : "-"}
            sub={`${current.orders} order${current.orders === 1 ? "" : "s"}${others > 0 ? ` · +${others} other currenc${others === 1 ? "y" : "ies"}` : ""}`}
            delta={sales ? change(sales.amount, prevSales) : null}
          />
          <Kpi
            label="Avg. order value"
            value={sales && now.averageOrderValue !== null && others === 0 ? formatMoney(now.averageOrderValue, sales.currencyCode, 2) : "-"}
            sub={now.conversionRate === null ? undefined : `${formatPercent(now.conversionRate, 2)} conversion`}
            delta={null}
          />
        </div>
        <ViewsChart daily={stats.daily} />
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>From view to order</h2>
            <span className={styles.muted}>Where shoppers drop off. Each step shows its share of the step before.</span>
          </div>
        </header>
        <ol className={own.funnel}>
          {steps.map((step) => (
            <li key={step.label} className={own.funnelStep}>
              <span className={own.funnelLabel}>{step.label}</span>
              <span className={own.funnelTrack} aria-hidden="true">
                <span className={own.funnelBar} style={{ width: `${Math.max(step.ofViews ?? 0, step.count > 0 ? 1.5 : 0)}%` }} />
              </span>
              <span className={own.funnelCount}>{step.count.toLocaleString()}</span>
              <span className={own.funnelRate}>{step.ofPrevious === null ? "" : formatPercent(step.ofPrevious)}</span>
            </li>
          ))}
        </ol>
        <p className={styles.muted}>
          A sale counts when an order includes a product added to the cart from a video. Taps include add-to-cart attempts.
        </p>
      </section>
    </>
  );
}

type SortKey = "views" | "watch" | "completion" | "clickRate" | "addToCarts" | "atcRate" | "sales";
const COLUMNS: { key: SortKey; label: string; value: (r: Row) => number }[] = [
  { key: "views", label: "Views", value: (r) => r.views },
  { key: "watch", label: "Avg. watch", value: (r) => (r.views ? r.watchSeconds / r.views : -1) },
  { key: "completion", label: "Completion", value: (r) => percent(r.completions, r.views) ?? -1 },
  { key: "clickRate", label: "Click rate", value: (r) => percent(r.clicks, r.views) ?? -1 },
  { key: "addToCarts", label: "Adds to cart", value: (r) => r.addToCarts },
  { key: "atcRate", label: "Add-to-cart rate", value: (r) => percent(r.addToCarts, r.views) ?? -1 },
  { key: "sales", label: "Sales", value: (r) => r.revenue * 1e6 + r.unitsSold * 1e3 + r.views / 1e3 },
];

function VideoTable({ rows, days, currency, multiCurrency }: { rows: Row[]; days: number; currency: string | null; multiCurrency: boolean }) {
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "views", desc: true });
  const column = COLUMNS.find((c) => c.key === sort.key)!;
  const sorted = [...rows].sort((a, b) => (sort.desc ? column.value(b) - column.value(a) : column.value(a) - column.value(b)));
  const sales = (r: Row) =>
    r.revenue && currency && !multiCurrency ? formatMoney(r.revenue, currency) : r.unitsSold ? `${r.unitsSold} sold` : "-";

  const exportCsv = () => {
    const csv = toCsv([
      ["Video", "Views", "Avg. watch (s)", "Completion %", "Product taps", "Click rate %", "Adds to cart", "Add-to-cart rate %", "Units sold", `Sales${currency && !multiCurrency ? ` (${currency})` : ""}`],
      ...sorted.map((r) => {
        const fixed = (value: number | null) => (value === null ? null : Number(value.toFixed(2)));
        return [
          r.title,
          r.views,
          r.views ? Math.round(r.watchSeconds / r.views) : null,
          fixed(percent(r.completions, r.views)),
          r.clicks,
          fixed(percent(r.clicks, r.views)),
          r.addToCarts,
          fixed(percent(r.addToCarts, r.views)),
          r.unitsSold,
          multiCurrency ? null : r.revenue,
        ];
      }),
    ]);
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `video-analytics-last-${days}-days.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    shopify.toast.show("Exported");
  };

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Videos</h2>
          <span className={styles.muted}>Last {days} days · select a column to rank by it</span>
        </div>
        {rows.length > 0 && (
          <s-button onClick={exportCsv} icon="export">
            Export CSV
          </s-button>
        )}
      </header>
      {rows.length === 0 ? (
        <div className={styles.empty}>
          <p>Upload a video and put a widget live to start collecting numbers.</p>
          <s-button onClick={() => navigate("/app/reels?upload=1")}>Upload videos</s-button>
        </div>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Video</th>
                {COLUMNS.map((col) => {
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
              {sorted.map((r) => (
                <tr key={r.key}>
                  <th scope="row">
                    <button type="button" className={styles.reelLink} onClick={() => navigate(`/app/reels/${r.key}`)}>
                      <span className={styles.thumb} style={r.posterUrl ? { backgroundImage: `url("${r.posterUrl}")` } : undefined} />
                      <span className={styles.reelTitle}>{r.title}</span>
                    </button>
                  </th>
                  <td>{r.views.toLocaleString()}</td>
                  <td>{formatWatchTime(r.views ? r.watchSeconds / r.views : null)}</td>
                  <td>{formatPercent(percent(r.completions, r.views), 0)}</td>
                  <td>{formatPercent(percent(r.clicks, r.views))}</td>
                  <td>{r.addToCarts.toLocaleString()}</td>
                  <td>{formatPercent(percent(r.addToCarts, r.views))}</td>
                  <td>{sales(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
