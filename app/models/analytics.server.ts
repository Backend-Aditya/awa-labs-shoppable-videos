import { Prisma } from "@prisma/client";
import prisma from "../db.server";

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
  daily: { date: string; views: number; clicks: number }[];
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
export async function recordEvent(shopId: string, reelId: string, eventType: TrackedEvent, at = new Date(), amount = 1) {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const add = zeroEngagement();
  add[COLUMN_FOR[eventType]] = Math.max(0, Math.round(amount));
  await prisma.$executeRaw`
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
  daily: { date: string; views: number; clicks: number }[];
}

// One reel's last-N-days performance. Matches events stored under either
// id form (GID or numeric) — see reelKey.
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
