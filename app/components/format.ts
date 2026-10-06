// Shared display formatting — app.reels.tsx (list modal) and
// app.reels.$id.tsx (direct-navigation fallback) each reimplemented these
// identically; one copy keeps both in sync.

export function formatMoney(amount: string, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(
      Number(amount),
    );
  } catch {
    // Intl throws on an unrecognized currency code — fall back to the raw
    // string rather than crashing the page over a display formatting issue.
    return `${amount} ${currencyCode}`;
  }
}

// Multi-currency shops can have more than one entry; joins them rather
// than silently picking one, since summing across currencies would be
// meaningless.
export function formatRevenueTotals(totals: { currencyCode: string; revenue: string }[]): string {
  if (totals.length === 0) return "—";
  return totals.map((t) => formatMoney(t.revenue, t.currencyCode)).join(", ");
}

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in the browser's
// local timezone, no offset suffix — new Date(iso) already converts a
// stored UTC ISO string to local time for getHours()/getMinutes(), so this
// just needs to format it, not convert it again.
export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
