// Thin daily-views bar chart. Keyboard users get ONE tab stop: focus the
// chart, then Left/Right (Home/End) move between days, with the readout
// announced. A text summary sits in the caption for screen readers.
import type { KeyboardEvent } from "react";
import { useState } from "react";
import styles from "./widget-editor/dashboard.module.css";

type Day = { date: string; views: number; clicks: number };

export function ViewsChart({ daily, title = "Daily video views" }: { daily: Day[]; title?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(0, ...daily.map((d) => d.views));
  const scale = Math.max(1, peak);
  const total = daily.reduce((n, d) => n + d.views, 0);
  const fmt = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const active = hover !== null ? daily[hover] : null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = daily.length - 1;
    const current = hover ?? last;
    const next =
      event.key === "ArrowLeft" ? Math.max(0, current - 1)
      : event.key === "ArrowRight" ? Math.min(last, current + 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    setHover(next);
  };

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartCaption}>
        <span>{title}</span>
        <span className={styles.muted} aria-live="polite">
          {active
            ? `${fmt(active.date)}: ${active.views.toLocaleString()} views, ${active.clicks.toLocaleString()} clicks`
            : total > 0
              ? `${total.toLocaleString()} views · peak ${peak.toLocaleString()} a day`
              : ""}
        </span>
      </figcaption>
      {total === 0 ? (
        <p className={styles.chartEmpty}>No views yet in this period.</p>
      ) : (
        <div
          className={styles.bars}
          role="slider"
          tabIndex={0}
          aria-label={`${title}. ${total.toLocaleString()} views over ${daily.length} days, peak ${peak.toLocaleString()}. Arrow keys read each day.`}
          aria-valuemin={1}
          aria-valuemax={daily.length}
          aria-valuenow={(hover ?? daily.length - 1) + 1}
          aria-valuetext={(() => {
            const d = daily[hover ?? daily.length - 1];
            return `${fmt(d.date)}: ${d.views} views, ${d.clicks} clicks`;
          })()}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setHover((h) => h ?? daily.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={onKeyDown}
        >
          <span className={styles.gridline} style={{ bottom: "100%" }} data-label={scale.toLocaleString()} />
          <span className={styles.gridline} style={{ bottom: "50%" }} data-label={Math.round(scale / 2).toLocaleString()} />
          {daily.map((d, i) => (
            <span
              key={d.date}
              className={styles.barHit}
              onMouseEnter={() => setHover(i)}
              data-active={hover === i || undefined}
            >
              <span className={styles.bar} style={{ height: `${(d.views / scale) * 100}%` }} />
            </span>
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
