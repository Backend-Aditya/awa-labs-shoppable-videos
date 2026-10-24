import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { isWidgetSource } from "./widget-kinds";
import type { WidgetSource } from "./widget-kinds";

// Storefront events carry the reel id exactly as Liquid printed it, which
// may be a full metaobject GID or just its numeric tail. Everything here is
// keyed by the numeric tail so both forms land on the same reel.
export const reelKey = (reelId: string) => String(reelId).split("/").pop() ?? String(reelId);

// The per-day rollup counters (ReelDailyStat), as every read returns them.
export interface Engagement {
  views: number;
  clicks: number;
  addToCarts: number;
  completions: number;
  watchSeconds: number;
}

const ENGAGEMENT_FIELDS = ["views", "clicks", "addToCarts", "completions", "watchSeconds"] as const;
const zeroEngagement = (): Engagement => ({ views: 0, clicks: 0, addToCarts: 0, completions: 0, watchSeconds: 0 });
const addEngagement = (into: Engagement, row: Engagement) => {
  for (const field of ENGAGEMENT_FIELDS) into[field] += row[field];
};

export interface PeriodTotals extends Engagement {
  orders: number;
  revenue: { currencyCode: string; amount: number }[];
}

export interface ReelPerformance extends Engagement {
  key: string;
  unitsSold: number;
  revenue: number;
}

export interface DashboardStats {
  days: number;
  current: PeriodTotals;
  previous: PeriodTotals;
  daily: { date: string; views: number; clicks: number; addToCarts: number }[];
  reels: ReelPerformance[];
}

const DAY_MS = 86_400_000;

export type TrackedEvent = "view" | "click_product" | "add_to_cart" | "complete" | "watch";

// The rollup column each storefront event adds to.
const COLUMN_FOR: Record<TrackedEvent, keyof Engagement> = {
  view: "views",
  click_product: "clicks",
  add_to_cart: "addToCarts",
  complete: "completions",
  watch: "watchSeconds",
};

// Storefront events are counted straight into one row per shop, reel and
// UTC day (ReelDailyStat) instead of one row per event. Every read below is
// then a scan of at most days × reels small rows, so dashboards stay fast no
// matter how much traffic a shop gets. One statement, atomic under
// concurrent requests thanks to ON CONFLICT. `amount` is 1 for every event
// but "watch", which carries the seconds played.
//
// `context` adds the same event to the per-widget rollup (which widget it
// happened in) and, for product taps and adds to cart, the per-product one.
// Both are optional: older storefront scripts don't send them.
export interface EventContext {
  source?: WidgetSource;
  // Numeric product id.
  productId?: string;
}

export async function recordEvent(
  shopId: string,
  reelId: string,
  eventType: TrackedEvent,
  at = new Date(),
  amount = 1,
  context: EventContext = {},
) {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const add = zeroEngagement();
  add[COLUMN_FOR[eventType]] = Math.max(0, Math.round(amount));
  const statements = [reelStatement(shopId, reelId, day, add)];
  // Watch time stays per reel: its report isn't tied to a widget.
  if (context.source && eventType !== "watch") {
    statements.push(prisma.$executeRaw`
      INSERT INTO "WidgetDailyStat" ("shopId", "source", "day", "views", "clicks", "addToCarts", "completions")
      VALUES (${shopId}, ${context.source}, ${day}::date, ${add.views}, ${add.clicks}, ${add.addToCarts}, ${add.completions})
      ON CONFLICT ("shopId", "source", "day")
      DO UPDATE SET "views" = "WidgetDailyStat"."views" + EXCLUDED."views",
                    "clicks" = "WidgetDailyStat"."clicks" + EXCLUDED."clicks",
                    "addToCarts" = "WidgetDailyStat"."addToCarts" + EXCLUDED."addToCarts",
                    "completions" = "WidgetDailyStat"."completions" + EXCLUDED."completions"`);
  }
  if (context.productId && (eventType === "click_product" || eventType === "add_to_cart")) {
    statements.push(prisma.$executeRaw`
      INSERT INTO "ProductDailyStat" ("shopId", "productId", "day", "clicks", "addToCarts")
      VALUES (${shopId}, ${context.productId}, ${day}::date, ${add.clicks}, ${add.addToCarts})
      ON CONFLICT ("shopId", "productId", "day")
      DO UPDATE SET "clicks" = "ProductDailyStat"."clicks" + EXCLUDED."clicks",
                    "addToCarts" = "ProductDailyStat"."addToCarts" + EXCLUDED."addToCarts"`);
  }
  // One transaction on one connection, so the rollups never disagree.
  if (statements.length === 1) await statements[0];
  else await prisma.$transaction(statements);
}

function reelStatement(shopId: string, reelId: string, day: Date, add: Engagement) {
  return prisma.$executeRaw`
    INSERT INTO "ReelDailyStat" ("shopId", "reelId", "day", "views", "clicks", "addToCarts", "completions", "watchSeconds")
    VALUES (${shopId}, ${reelKey(reelId)}, ${day}::date, ${add.views}, ${add.clicks}, ${add.addToCarts}, ${add.completions}, ${add.watchSeconds})
    ON CONFLICT ("shopId", "reelId", "day")
    DO UPDATE SET "views" = "ReelDailyStat"."views" + EXCLUDED."views",
                  "clicks" = "ReelDailyStat"."clicks" + EXCLUDED."clicks",
                  "addToCarts" = "ReelDailyStat"."addToCarts" + EXCLUDED."addToCarts",
                  "completions" = "ReelDailyStat"."completions" + EXCLUDED."completions",
                  "watchSeconds" = "ReelDailyStat"."watchSeconds" + EXCLUDED."watchSeconds"`;
}

// [start, end) covering the last `days` whole UTC days, today included.
function windowFor(days: number, now: Date) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS);
  return { start: new Date(end.getTime() - days * DAY_MS), end };
}

function emptyDaily(start: Date, days: number) {
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10),
    views: 0,
    clicks: 0,
    addToCarts: 0,
  }));
}

async function totalsBetween(shopId: string, from: Date, to: Date): Promise<PeriodTotals> {
  const [events, revenue, orders] = await Promise.all([
    prisma.reelDailyStat.aggregate({
      where: { shopId, day: { gte: from, lt: to } },
      _sum: { views: true, clicks: true, addToCarts: true, completions: true, watchSeconds: true },
    }),
    prisma.orderAttribution.groupBy({
      by: ["currencyCode"],
      where: { shopId, createdAt: { gte: from, lt: to } },
      _sum: { revenueAmount: true },
    }),
    prisma.orderAttribution.findMany({
      where: { shopId, createdAt: { gte: from, lt: to } },
      select: { orderId: true },
      distinct: ["orderId"],
    }),
  ]);
  return {
    views: events._sum.views ?? 0,
    clicks: events._sum.clicks ?? 0,
    addToCarts: events._sum.addToCarts ?? 0,
    completions: events._sum.completions ?? 0,
    watchSeconds: events._sum.watchSeconds ?? 0,
    orders: orders.length,
    revenue: revenue.map((r) => ({
      currencyCode: r.currencyCode,
      amount: Number((r._sum.revenueAmount ?? new Prisma.Decimal(0)).toFixed(2)),
    })),
  };
}

export interface ReelStats extends Engagement {
  days: number;
  unitsSold: number;
  orders: number;
  revenue: { currencyCode: string; amount: number }[];
  daily: { date: string; views: number; clicks: number; addToCarts: number }[];
}

// One reel's last-N-days performance. Matches events stored under either
// id form (GID or numeric), see reelKey.
export async function getReelStats(shopId: string, reelGid: string, days = 30, now = new Date()): Promise<ReelStats> {
  // Orders may carry either id form (older rows kept the GID); rollups are
  // always keyed by the numeric tail.
  const ids = [...new Set([reelGid, reelKey(reelGid)])];
  const { start, end } = windowFor(days, now);

  const [rows, revenue, units, orders] = await Promise.all([
    prisma.reelDailyStat.findMany({
      where: { shopId, reelId: reelKey(reelGid), day: { gte: start, lt: end } },
      select: { day: true, views: true, clicks: true, addToCarts: true, completions: true, watchSeconds: true },
    }),
    prisma.orderAttribution.groupBy({
      by: ["currencyCode"],
      where: { shopId, reelId: { in: ids }, createdAt: { gte: start, lt: end } },
      _sum: { revenueAmount: true },
    }),
    prisma.orderAttribution.aggregate({
      where: { shopId, reelId: { in: ids }, createdAt: { gte: start, lt: end } },
      _sum: { quantity: true },
    }),
    prisma.orderAttribution.findMany({
      where: { shopId, reelId: { in: ids }, createdAt: { gte: start, lt: end } },
      select: { orderId: true },
      distinct: ["orderId"],
    }),
  ]);

  const daily = emptyDaily(start, days);
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const totals = zeroEngagement();
  for (const row of rows) {
    addEngagement(totals, row);
    const bucket = byDate.get(row.day.toISOString().slice(0, 10));
    if (bucket) {
      bucket.views += row.views;
      bucket.clicks += row.clicks;
      bucket.addToCarts += row.addToCarts;
    }
  }

  return {
    days,
    ...totals,
    unitsSold: units._sum.quantity ?? 0,
    orders: orders.length,
    revenue: revenue.map((r) => ({
      currencyCode: r.currencyCode,
      amount: Number((r._sum.revenueAmount ?? new Prisma.Decimal(0)).toFixed(2)),
    })),
    daily,
  };
}

// Views per reel (all time) for the library cards, keyed by reelKey.
export async function getViewCountsByReel(shopId: string): Promise<Record<string, number>> {
  const rows = await prisma.reelDailyStat.groupBy({
    by: ["reelId"],
    where: { shopId },
    _sum: { views: true },
  });
  const out: Record<string, number> = {};
  for (const row of rows) out[row.reelId] = row._sum.views ?? 0;
  return out;
}

// Supported dashboard ranges. Anything else falls back to 30 days.
export const DASHBOARD_RANGES = [7, 30, 90] as const;
export function parseRange(value: string | null): number {
  const n = Number(value);
  return (DASHBOARD_RANGES as readonly number[]).includes(n) ? n : 30;
}

export async function getDashboardStats(shopId: string, days = 30, now = new Date()): Promise<DashboardStats> {
  const { start, end } = windowFor(days, now);
  const prevStart = new Date(start.getTime() - days * DAY_MS);

  const [current, previous, rows, perReelRevenue] = await Promise.all([
    totalsBetween(shopId, start, end),
    totalsBetween(shopId, prevStart, start),
    prisma.reelDailyStat.findMany({
      where: { shopId, day: { gte: start, lt: end } },
      select: { reelId: true, day: true, views: true, clicks: true, addToCarts: true, completions: true, watchSeconds: true },
    }),
    prisma.orderAttribution.groupBy({
      by: ["reelId"],
      where: { shopId, createdAt: { gte: start, lt: end } },
      _sum: { revenueAmount: true, quantity: true },
    }),
  ]);

  const daily = emptyDaily(start, days);
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const reels = new Map<string, ReelPerformance>();
  const reelFor = (id: string) => {
    const key = reelKey(id);
    let entry = reels.get(key);
    if (!entry) {
      entry = { key, ...zeroEngagement(), unitsSold: 0, revenue: 0 };
      reels.set(key, entry);
    }
    return entry;
  };
  for (const row of rows) {
    const bucket = byDate.get(row.day.toISOString().slice(0, 10));
    if (bucket) {
      bucket.views += row.views;
      bucket.clicks += row.clicks;
      bucket.addToCarts += row.addToCarts;
    }
    addEngagement(reelFor(row.reelId), row);
  }
  for (const row of perReelRevenue) {
    const entry = reelFor(row.reelId);
    entry.unitsSold += row._sum.quantity ?? 0;
    entry.revenue += Number((row._sum.revenueAmount ?? new Prisma.Decimal(0)).toFixed(2));
  }

  return {
    days,
    current,
    previous,
    daily,
    reels: [...reels.values()].sort((a, b) => b.revenue - a.revenue || b.views - a.views),
  };
}

export interface WidgetPerformance {
  source: WidgetSource;
  views: number;
  clicks: number;
  addToCarts: number;
  completions: number;
}

// Each widget's engagement over the last `days` days, busiest first.
export async function getWidgetStats(shopId: string, days = 30, now = new Date()): Promise<WidgetPerformance[]> {
  const { start, end } = windowFor(days, now);
  const rows = await prisma.widgetDailyStat.groupBy({
    by: ["source"],
    where: { shopId, day: { gte: start, lt: end } },
    _sum: { views: true, clicks: true, addToCarts: true, completions: true },
  });
  return rows
    .filter((row) => isWidgetSource(row.source))
    .map((row) => ({
      source: row.source as WidgetSource,
      views: row._sum.views ?? 0,
      clicks: row._sum.clicks ?? 0,
      addToCarts: row._sum.addToCarts ?? 0,
      completions: row._sum.completions ?? 0,
    }))
    .sort((a, b) => b.views - a.views || b.addToCarts - a.addToCarts);
}

export interface ProductPerformance {
  productId: string;
  clicks: number;
  addToCarts: number;
}

// The products shoppers acted on most from videos over the last `days`
// days: most adds to cart first, then most taps.
export async function getTopProducts(shopId: string, days = 30, now = new Date(), limit = 10): Promise<ProductPerformance[]> {
  const { start, end } = windowFor(days, now);
  const rows = await prisma.productDailyStat.groupBy({
    by: ["productId"],
    where: { shopId, day: { gte: start, lt: end } },
    _sum: { clicks: true, addToCarts: true },
    orderBy: [{ _sum: { addToCarts: "desc" } }, { _sum: { clicks: "desc" } }],
    take: limit,
  });
  return rows.map((row) => ({ productId: row.productId, clicks: row._sum.clicks ?? 0, addToCarts: row._sum.addToCarts ?? 0 }));
}
