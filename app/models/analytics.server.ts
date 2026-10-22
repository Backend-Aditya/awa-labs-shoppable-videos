import { Prisma } from "@prisma/client";
import prisma from "../db.server";

// Storefront events carry the reel id exactly as Liquid printed it, which
// may be a full metaobject GID or just its numeric tail. Everything here is
// keyed by the numeric tail so both forms land on the same reel.
export const reelKey = (reelId: string) => String(reelId).split("/").pop() ?? String(reelId);

export interface PeriodTotals {
  views: number;
  clicks: number;
  addToCarts: number;
  orders: number;
  revenue: { currencyCode: string; amount: number }[];
}

export interface ReelPerformance {
  key: string;
  views: number;
  clicks: number;
  addToCarts: number;
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

export type TrackedEvent = "view" | "click_product" | "add_to_cart";

// Storefront events are counted straight into one row per shop, reel and
// UTC day (ReelDailyStat) instead of one row per event. Every read below is
// then a scan of at most days × reels small rows, so dashboards stay fast no
// matter how much traffic a shop gets. One statement, atomic under
// concurrent requests thanks to ON CONFLICT.
export async function recordEvent(shopId: string, reelId: string, eventType: TrackedEvent, at = new Date()) {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const views = eventType === "view" ? 1 : 0;
  const clicks = eventType === "click_product" ? 1 : 0;
  const addToCarts = eventType === "add_to_cart" ? 1 : 0;
  await prisma.$executeRaw`
    INSERT INTO "ReelDailyStat" ("shopId", "reelId", "day", "views", "clicks", "addToCarts")
    VALUES (${shopId}, ${reelKey(reelId)}, ${day}::date, ${views}, ${clicks}, ${addToCarts})
    ON CONFLICT ("shopId", "reelId", "day")
    DO UPDATE SET "views" = "ReelDailyStat"."views" + EXCLUDED."views",
                  "clicks" = "ReelDailyStat"."clicks" + EXCLUDED."clicks",
                  "addToCarts" = "ReelDailyStat"."addToCarts" + EXCLUDED."addToCarts"`;
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
      _sum: { views: true, clicks: true, addToCarts: true },
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
    orders: orders.length,
    revenue: revenue.map((r) => ({
      currencyCode: r.currencyCode,
      amount: Number((r._sum.revenueAmount ?? new Prisma.Decimal(0)).toFixed(2)),
    })),
  };
}

export interface ReelStats {
  days: number;
  views: number;
  clicks: number;
  addToCarts: number;
  unitsSold: number;
  orders: number;
  revenue: { currencyCode: string; amount: number }[];
  daily: { date: string; views: number; clicks: number; addToCarts: number }[];
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
      select: { day: true, views: true, clicks: true, addToCarts: true },
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
  let views = 0;
  let clicks = 0;
  let addToCarts = 0;
  for (const row of rows) {
    views += row.views;
    clicks += row.clicks;
    addToCarts += row.addToCarts;
    const bucket = byDate.get(row.day.toISOString().slice(0, 10));
    if (bucket) {
      bucket.views += row.views;
      bucket.clicks += row.clicks;
      bucket.addToCarts += row.addToCarts;
    }
  }

  return {
    days,
    views,
    clicks,
    addToCarts,
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
      select: { reelId: true, day: true, views: true, clicks: true, addToCarts: true },
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
      entry = { key, views: 0, clicks: 0, addToCarts: 0, unitsSold: 0, revenue: 0 };
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
    const entry = reelFor(row.reelId);
    entry.views += row.views;
    entry.clicks += row.clicks;
    entry.addToCarts += row.addToCarts;
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
