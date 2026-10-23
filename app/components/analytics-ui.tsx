// Pieces shared by Home and Analytics: the KPI tile, the reporting-period
// picker and the money/change formatting behind them.
import { useSearchParams } from "react-router";
import styles from "./widget-editor/dashboard.module.css";
import { handleRovingKeys } from "./widget-editor/controls";

export function formatMoney(amount: number, currencyCode: string, digits = 0) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode, maximumFractionDigits: digits }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currencyCode}`;
  }
}

export type Delta = { label: string; up: boolean } | null;

export function change(current: number, previous: number): Delta {
  if (previous === 0) return current === 0 ? null : { label: "New", up: true };
  const pct = ((current - previous) / previous) * 100;
  return { label: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`, up: pct >= 0 };
}

// Rates change in percentage points, not percent of a percent (2% → 3% is
// "+1.0 pt", not "+50%").
export function pointChange(current: number | null, previous: number | null): Delta {
  if (current === null) return null;
  if (previous === null) return current === 0 ? null : { label: "New", up: true };
  const diff = current - previous;
  if (Math.abs(diff) < 0.05) return null;
  return { label: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pt`, up: diff >= 0 };
}

export function Kpi({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta: Delta }) {
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

export const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

// Switches the reporting window without leaving the page; the card dims
// while the new numbers load instead of the page jumping.
export function RangePicker({ days }: { days: number }) {
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
