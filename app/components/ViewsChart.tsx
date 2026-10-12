// Thin daily-views bar chart with a per-bar hover/focus readout. Shared by
// the Overview dashboard and the reel editor.
import { useState } from "react";
import styles from "./widget-editor/dashboard.module.css";

export function ViewsChart({ daily, title = "Daily video views" }: { daily: { date: string; views: number; clicks: number }[]; title?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.views));
  const total = daily.reduce((n, d) => n + d.views, 0);
  const fmt = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const active = hover !== null ? daily[hover] : null;

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartCaption}>
        <span>{title}</span>
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
