import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { listReels } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import { listWidgetsForShop } from "../models/widget.server";
import { getKindMeta } from "../models/widget-kinds";
import { getDashboardStats, reelKey } from "../models/analytics.server";
import { KindSchematic } from "../components/widget-editor/KindSchematic";
import type { WidgetKind } from "../models/widget-kinds";
import styles from "../components/widget-editor/dashboard.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const [reels, widgets, stats] = await Promise.all([
    listReels(admin, 50),
    listWidgetsForShop(shop.id),
    getDashboardStats(shop.id, 30),
  ]);

  const reelsByKey = new Map(reels.map((r) => [reelKey(r.id), r]));
  const topReels = stats.reels
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
    plan: shop.plan,
    viewCap: shop.viewCapMonthly,
    hasBrand: shop.brand != null,
    reelCount: reels.length,
    readyCount: reels.filter((r) => deriveReelStatus(r.config) === "ready").length,
    taggedCount: reels.filter((r) => (r.config.productIds ?? []).length > 0).length,
    widgets: widgets.map((w) => ({ id: w.id, name: w.name, type: w.type, published: w.published })),
    stats: { days: stats.days, current: stats.current, previous: stats.previous, daily: stats.daily },
    topReels,
  };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;

const EMBED_KEY = "reelup-embed-opened";

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

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { current, previous } = data.stats;
  const ctr = current.views ? (current.clicks / current.views) * 100 : 0;
  const prevCtr = previous.views ? (previous.clicks / previous.views) * 100 : 0;
  const revenue = current.revenue[0];
  const prevRevenue = previous.revenue.find((r) => r.currencyCode === revenue?.currencyCode)?.amount ?? 0;

  return (
    <s-page heading="Overview" inlineSize="large">
      <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/reels")}>
        Upload video
      </s-button>
      <div className={styles.page}>
        <Checklist data={data} />

        <section className={styles.card}>
          <header className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Last {data.stats.days} days</h2>
            <span className={styles.muted}>Compared with the {data.stats.days} days before</span>
          </header>
          <div className={styles.kpis}>
            <Kpi label="Video views" value={current.views.toLocaleString()} delta={change(current.views, previous.views)} />
            <Kpi label="Product clicks" value={current.clicks.toLocaleString()} delta={change(current.clicks, previous.clicks)} />
            <Kpi label="Click rate" value={`${ctr.toFixed(1)}%`} delta={change(ctr, prevCtr)} />
            <Kpi
              label="Sales from videos"
              value={revenue ? formatMoney(revenue.amount, revenue.currencyCode) : "—"}
              sub={`${current.orders} order${current.orders === 1 ? "" : "s"}`}
              delta={revenue ? change(revenue.amount, prevRevenue) : null}
            />
          </div>
          <ViewsChart daily={data.stats.daily} />
        </section>

        <div className={styles.split}>
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
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Video</th>
                    <th scope="col">Views</th>
                    <th scope="col">Clicks</th>
                    <th scope="col">Click rate</th>
                    <th scope="col">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topReels.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">
                        <span className={styles.reelCell}>
                          <span
                            className={styles.thumb}
                            style={r.posterUrl ? { backgroundImage: `url("${r.posterUrl}")` } : undefined}
                          />
                          <span className={styles.reelTitle}>{r.title}</span>
                        </span>
                      </th>
                      <td>{r.views.toLocaleString()}</td>
                      <td>{r.clicks.toLocaleString()}</td>
                      <td>{r.views ? `${((r.clicks / r.views) * 100).toFixed(1)}%` : "—"}</td>
                      <td>
                        {r.revenue && revenue ? formatMoney(r.revenue, revenue.currencyCode) : r.unitsSold ? `${r.unitsSold} sold` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className={styles.card}>
            <header className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Widgets</h2>
              <button type="button" className={styles.link} onClick={() => navigate("/app/widgets")}>
                Manage
              </button>
            </header>
            {data.widgets.length === 0 ? (
              <p className={styles.empty}>No widgets yet. Create one to put videos on your store.</p>
            ) : (
              <ul className={styles.widgetList}>
                {data.widgets.slice(0, 6).map((w) => (
                  <li key={w.id}>
                    <button type="button" className={styles.widgetRow} onClick={() => navigate(`/app/widgets/${encodeURIComponent(w.id)}`)}>
                      <span className={styles.widgetIcon}>
                        <KindSchematic kind={w.type as WidgetKind} />
                      </span>
                      <span className={styles.widgetText}>
                        <span className={styles.widgetName}>{w.name}</span>
                        <span className={styles.muted}>{getKindMeta(w.type)?.name ?? w.type}</span>
                      </span>
                      <span className={styles.status} data-live={w.published || undefined}>
                        {w.published ? "Live" : "Draft"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className={styles.plan}>
              {data.plan.charAt(0) + data.plan.slice(1).toLowerCase()} plan · {current.views.toLocaleString()} of{" "}
              {data.viewCap.toLocaleString()} monthly views
            </p>
            <div className={styles.meter} role="meter" aria-valuemin={0} aria-valuemax={data.viewCap} aria-valuenow={current.views} aria-label="Monthly views used">
              <span style={{ width: `${Math.min(100, (current.views / Math.max(data.viewCap, 1)) * 100)}%` }} />
            </div>
          </section>
        </div>
      </div>
    </s-page>
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

function ViewsChart({ daily }: { daily: Data["stats"]["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.views));
  const total = daily.reduce((n, d) => n + d.views, 0);
  const fmt = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const active = hover !== null ? daily[hover] : null;

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartCaption}>
        <span>Daily video views</span>
        <span className={styles.muted}>
          {active ? `${fmt(active.date)}: ${active.views.toLocaleString()} views, ${active.clicks.toLocaleString()} clicks` : `Peak ${max.toLocaleString()} a day`}
        </span>
      </figcaption>
      {total === 0 ? (
        <p className={styles.chartEmpty}>No views yet in this period.</p>
      ) : (
        <div className={styles.bars} onMouseLeave={() => setHover(null)}>
          <span className={styles.gridline} style={{ bottom: "100%" }} data-label={max.toLocaleString()} />
          <span className={styles.gridline} style={{ bottom: "50%" }} data-label={Math.round(max / 2).toLocaleString()} />
          {daily.map((d, i) => (
            <button
              type="button"
              key={d.date}
              className={styles.barHit}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${fmt(d.date)}: ${d.views} views, ${d.clicks} clicks`}
              data-active={hover === i || undefined}
            >
              <span className={styles.bar} style={{ height: `${(d.views / max) * 100}%` }} />
            </button>
          ))}
        </div>
      )}
      {total > 0 && (
        <div className={styles.axis} aria-hidden="true">
          <span>{fmt(daily[0].date)}</span>
          <span>{fmt(daily[daily.length - 1].date)}</span>
        </div>
      )}
    </figure>
  );
}

function Checklist({ data }: { data: Data }) {
  const navigate = useNavigate();
  const [embedOpened, setEmbedOpened] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setEmbedOpened(localStorage.getItem(EMBED_KEY) === "1");
      setDismissed(localStorage.getItem("reelup-checklist-dismissed") === "1");
    } catch {
      // Storage blocked: checklist just doesn't remember.
    }
  }, []);

  const embedUrl = `https://${data.shopDomain}/admin/themes/current/editor?context=apps&template=index&activateAppId=${data.apiKey}/shoppable-videos`;
  const steps = [
    { done: data.reelCount > 0, title: "Upload your first video", body: "MP4 or MOV, or import from Instagram and TikTok.", action: "Upload", go: () => navigate("/app/reels") },
    { done: data.taggedCount > 0, title: "Tag products in a video", body: "Tagged products become shoppable cards in the player.", action: "Tag products", go: () => navigate("/app/reels") },
    { done: data.widgets.some((w) => w.published), title: "Create a widget", body: "Pick where and how videos appear on your store.", action: "Create", go: () => navigate("/app/widgets") },
    {
      done: embedOpened,
      title: "Turn on the app embed",
      body: "One switch in your theme editor makes every widget playable.",
      action: "Open theme editor",
      go: () => {
        window.open(embedUrl, "_blank");
        try {
          localStorage.setItem(EMBED_KEY, "1");
        } catch {
          // ignore
        }
        setEmbedOpened(true);
      },
    },
    { done: data.hasBrand, title: "Match your brand", body: "Set button and accent colours once for every widget.", action: "Brand kit", go: () => navigate("/app/settings") },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (dismissed || doneCount === steps.length) return null;
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
