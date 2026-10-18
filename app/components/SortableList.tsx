// Drag-to-reorder list for short admin lists (tagged products, a widget's
// videos). Each row gets a grip handle that works three ways:
// - mouse or touch: drag the row; the others slide aside to show where it
//   will land,
// - keyboard: focus the grip and press ↑/↓ (Home/End jump to the ends),
// - screen readers: every move is announced in a polite live region.
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./sortable.module.css";

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

interface Drag {
  from: number;
  to: number;
  dy: number;
  startY: number;
  // Measured once at drag start: row tops/heights and the gap between rows.
  tops: number[];
  heights: number[];
  gap: number;
}

export function SortableList<T>({
  items,
  getKey,
  getLabel,
  onReorder,
  renderItem,
  className,
  itemClassName,
}: {
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  onReorder: (items: T[]) => void;
  renderItem: (item: T, index: number, handle: ReactNode) => ReactNode;
  className?: string;
  itemClassName?: string;
}) {
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const handleRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  // One frame with transitions off after a drop, so rows that were shifted
  // aside don't animate back from their old offset once React reorders them.
  const [settling, setSettling] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const focusAfterMove = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (focusAfterMove.current === null) return;
    handleRefs.current[focusAfterMove.current]?.focus();
    focusAfterMove.current = null;
  });

  useEffect(() => {
    if (!settling) return;
    const frame = requestAnimationFrame(() => setSettling(false));
    return () => cancelAnimationFrame(frame);
  }, [settling]);

  const commit = useCallback(
    (from: number, to: number, viaKeyboard: boolean) => {
      if (from === to) return;
      const item = items[from];
      onReorder(moveItem(items, from, to));
      setAnnouncement(`${getLabel(item)} moved to position ${to + 1} of ${items.length}.`);
      if (viaKeyboard) focusAfterMove.current = to;
    },
    [items, onReorder, getLabel],
  );

  const targetIndex = (d: Drag, dy: number) => {
    const center = d.tops[d.from] + d.heights[d.from] / 2 + dy;
    let to = d.from;
    // Inclusive: the drag is clamped to the list, so at either end the row's
    // center sits exactly on the end row's center and must still count.
    for (let i = d.from + 1; i < d.tops.length; i++) {
      if (center >= d.tops[i] + d.heights[i] / 2) to = i;
    }
    for (let i = d.from - 1; i >= 0; i--) {
      if (center <= d.tops[i] + d.heights[i] / 2) to = i;
    }
    return to;
  };

  const startDrag = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    if (items.length < 2 || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rects = rowRefs.current.slice(0, items.length).map((el) => el?.getBoundingClientRect());
    if (rects.some((r) => !r)) return;
    const tops = rects.map((r) => r!.top);
    const heights = rects.map((r) => r!.height);
    const gap = tops.length > 1 ? Math.max(0, tops[1] - (tops[0] + heights[0])) : 0;
    setDrag({ from: index, to: index, dy: 0, startY: event.clientY, tops, heights, gap });
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const last = drag.tops.length - 1;
    // Keep the row inside the list.
    const minDy = drag.tops[0] - drag.tops[drag.from];
    const maxDy = drag.tops[last] + drag.heights[last] - (drag.tops[drag.from] + drag.heights[drag.from]);
    const dy = Math.min(maxDy, Math.max(minDy, event.clientY - drag.startY));
    setDrag({ ...drag, dy, to: targetIndex(drag, dy) });
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const { from, to } = drag;
    setDrag(null);
    setSettling(true);
    commit(from, to, false);
  };

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = items.length - 1;
    const to =
      event.key === "ArrowUp"
        ? index - 1
        : event.key === "ArrowDown"
          ? index + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (to === null) return;
    event.preventDefault();
    if (to < 0 || to > last) return;
    commit(index, to, true);
  };

  const rowStyle = (index: number): CSSProperties | undefined => {
    if (!drag) return undefined;
    if (index === drag.from) return { transform: `translateY(${drag.dy}px)` };
    const shift = drag.heights[drag.from] + drag.gap;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return { transform: `translateY(${-shift}px)` };
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return { transform: `translateY(${shift}px)` };
    return undefined;
  };

  return (
    <>
      <ol className={className} data-sorting={drag ? "" : undefined} data-settling={settling ? "" : undefined}>
        {items.map((item, index) => {
          const label = getLabel(item);
          const handle = (
            <button
              type="button"
              ref={(el) => {
                handleRefs.current[index] = el;
              }}
              className={styles.handle}
              aria-label={`Reorder ${label}, position ${index + 1} of ${items.length}. Use the up and down arrow keys to move.`}
              title="Drag to reorder"
              disabled={items.length < 2}
              onPointerDown={startDrag(index)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={onKeyDown(index)}
            >
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
                <circle cx="7.5" cy="5" r="1.4" />
                <circle cx="12.5" cy="5" r="1.4" />
                <circle cx="7.5" cy="10" r="1.4" />
                <circle cx="12.5" cy="10" r="1.4" />
                <circle cx="7.5" cy="15" r="1.4" />
                <circle cx="12.5" cy="15" r="1.4" />
              </svg>
            </button>
          );
          return (
            <li
              key={getKey(item)}
              ref={(el) => {
                rowRefs.current[index] = el;
              }}
              className={`${styles.row}${itemClassName ? ` ${itemClassName}` : ""}`}
              data-dragging={drag?.from === index ? "" : undefined}
              style={rowStyle(index)}
            >
              {renderItem(item, index, handle)}
            </li>
          );
        })}
      </ol>
      <span className={styles.live} aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
