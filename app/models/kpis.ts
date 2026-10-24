// What each KPI on Home and Analytics means, computed from the rollup
// counters (analytics.server.ts). Client-safe and pure, so pages and tests
// share one definition. Every rate is per video view; a rate over zero
// views is null ("-"), never 0%, so an idle period doesn't read as a
// failing one.

export interface KpiInput {
  views: number;
  clicks: number;
  addToCarts: number;
  completions: number;
  watchSeconds: number;
  orders?: number;
  // Attributed sales in one currency.
  revenue?: number;
}

export interface Kpis {
  views: number;
  // Product taps per view, %.
  clickRate: number | null;
  addToCarts: number;
  // Adds to cart per view, %.
  addToCartRate: number | null;
  // Views watched to 95%, %.
  completionRate: number | null;
  // Seconds watched per view.
  avgWatchSeconds: number | null;
  orders: number;
  // Attributed orders per view, %.
  conversionRate: number | null;
  revenue: number;
  // Revenue per attributed order.
  averageOrderValue: number | null;
  // Revenue per 1,000 views, comparable across videos of any reach.
  revenuePerThousandViews: number | null;
}

export const percent = (part: number, whole: number): number | null => (whole > 0 ? Math.min((part / whole) * 100, 100) : null);

export function deriveKpis(input: KpiInput): Kpis {
  const { views, clicks, addToCarts, completions, watchSeconds } = input;
  const orders = input.orders ?? 0;
  const revenue = input.revenue ?? 0;
  return {
    views,
    clickRate: percent(clicks, views),
    addToCarts,
    addToCartRate: percent(addToCarts, views),
    completionRate: percent(completions, views),
    avgWatchSeconds: views > 0 ? watchSeconds / views : null,
    orders,
    conversionRate: percent(orders, views),
    revenue,
    averageOrderValue: orders > 0 ? revenue / orders : null,
    revenuePerThousandViews: views > 0 ? (revenue / views) * 1000 : null,
  };
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null ? "-" : `${value.toFixed(digits)}%`;
}

// 0:42, 3:05, 1:02:10.
export function formatWatchTime(seconds: number | null): string {
  if (seconds === null) return "-";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// A shopper's path through the videos, each step with its share of the step
// before it (so the weakest link is the lowest percentage).
export function funnel(input: Pick<KpiInput, "views" | "clicks" | "addToCarts" | "orders">): { label: string; count: number; ofPrevious: number | null; ofViews: number | null }[] {
  const steps = [
    { label: "Watched a video", count: input.views },
    { label: "Tapped a product", count: input.clicks },
    { label: "Added to cart", count: input.addToCarts },
    { label: "Ordered", count: input.orders ?? 0 },
  ];
  return steps.map((step, i) => ({
    ...step,
    ofPrevious: i === 0 ? null : percent(step.count, steps[i - 1].count),
    ofViews: percent(step.count, input.views),
  }));
}

// RFC 4180 CSV. Cells that a spreadsheet would run as a formula (= + - @,
// tab, CR) are prefixed with a quote: titles are merchant-written text.
export function toCsv(rows: (string | number | null)[][]): string {
  const cell = (value: string | number | null) => {
    if (value === null) return "";
    let text = String(value);
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
