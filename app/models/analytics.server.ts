import { Prisma } from "@prisma/client";
import prisma from "../db.server";

// Storefront events carry the reel id exactly as Liquid printed it, which
// may be a full metaobject GID or just its numeric tail. Everything here is
// keyed by the numeric tail so both forms land on the same reel.
export const reelKey = (reelId: string) => String(reelId).split("/").pop() ?? String(reelId);

export interface PeriodTotals {
  views: number;
  clicks: number;
  orders: number;
  revenue: { currencyCode: string; amount: number }[];
}

export interface ReelPerformance {
  key: string;
  views: number;
  clicks: number;
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

async function totalsBetween(shopId: string, from: Date, to: Date): Promise<PeriodTotals> {
  const [events, revenue, orders] = await Promise.all([
    prisma.reelEvent.groupBy({
      by: ["eventType"],
      where: { shopId, createdAt: { gte: from, lt: to } },
      _count: { _all: true },
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
  const count = (type: string) => events.find((e) => e.eventType === type)?._count._all ?? 0;
  return {
    views: count("view"),
    clicks: count("click_product"),
    orders: orders.length,
    revenue: revenue.map((r) => ({
      currencyCode: r.currencyCode,
      amount: Number((r._sum.revenueAmount ?? new Prisma.Decimal(0)).toFixed(2)),
    })),
  };
}

export async function getDashboardStats(shopId: string, days = 30, now = new Date()): Promise<DashboardStats> {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS);
  const start = new Date(end.getTime() - days * DAY_MS);
  const prevStart = new Date(start.getTime() - days * DAY_MS);

  const [current, previous, dailyRows, perReelEvents, perReelRevenue] = await Promise.all([
    totalsBetween(shopId, start, end),
    totalsBetween(shopId, prevStart, start),
    prisma.$queryRaw<{ day: Date; eventType: string; count: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, "eventType", COUNT(*)::bigint AS count
      FROM "ReelEvent"
      WHERE "shopId" = ${shopId} AND "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP BY 1, 2`,
    prisma.reelEvent.groupBy({
      by: ["reelId", "eventType"],
      where: { shopId, createdAt: { gte: start, lt: end } },
      _count: { _all: true },
    }),
    prisma.orderAttribution.groupBy({
      by: ["reelId"],
      where: { shopId, createdAt: { gte: start, lt: end } },
      _sum: { revenueAmount: true, quantity: true },
    }),
  ]);

  const daily = Array.from({ length: days }, (_, i) => {
    const date = new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10);
    return { date, views: 0, clicks: 0 };
  });
  const byDate = new Map(daily.map((d) => [d.date, d]));
  for (const row of dailyRows) {
    const bucket = byDate.get(new Date(row.day).toISOString().slice(0, 10));
    if (!bucket) continue;
    if (row.eventType === "view") bucket.views += Number(row.count);
    else if (row.eventType === "click_product") bucket.clicks += Number(row.count);
  }

  const reels = new Map<string, ReelPerformance>();
  const reelFor = (id: string) => {
    const key = reelKey(id);
    let entry = reels.get(key);
    if (!entry) {
      entry = { key, views: 0, clicks: 0, unitsSold: 0, revenue: 0 };
      reels.set(key, entry);
    }
    return entry;
  };
  for (const row of perReelEvents) {
    const entry = reelFor(row.reelId);
    if (row.eventType === "view") entry.views += row._count._all;
    else if (row.eventType === "click_product") entry.clicks += row._count._all;
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
