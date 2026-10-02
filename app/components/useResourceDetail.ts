import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

type WatchedFetcher = { state: "idle" | "loading" | "submitting"; data: unknown };

// ReelDetailModal and WidgetDetailModal are each a single modal instance
// reused across every row in their list — the fetcher's `data` doesn't
// clear when `href` changes, it keeps the PREVIOUS row's data until the
// new load resolves. Without gating on a matching href, opening row B
// right after editing row A briefly renders row A's stale fields under
// row B's heading (a checkbox in particular looked "stuck" from the last
// row touched — this bit both modals independently before this hook).
//
// `watchers` are every other fetcher on the page whose successful
// completion (not every state change — only idle-with-data, i.e. the
// moment a submit resolves) should invalidate this detail view: edit,
// set-products, delete, etc.
export function useResourceDetail<T>(
  href: string | null,
  watchers: readonly WatchedFetcher[] = [],
) {
  const detailFetcher = useFetcher<T>();
  const pendingHrefRef = useRef<string | null>(null);
  const [resolvedHref, setResolvedHref] = useState<string | null>(null);

  useEffect(() => {
    if (href) {
      pendingHrefRef.current = href;
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);

  useEffect(() => {
    if (detailFetcher.state === "idle" && detailFetcher.data) {
      setResolvedHref(pendingHrefRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailFetcher.state, detailFetcher.data]);

  const reloadRef = useRef(detailFetcher.load);
  reloadRef.current = detailFetcher.load;
  const mountedRef = useRef(false);

  // One token per watcher (its data while idle, else undefined) instead of
  // a single reduced boolean — a reduced boolean would go true on the
  // first fetcher's completion and then stay true, so a second watcher
  // completing later wouldn't register as a change and would silently
  // fail to trigger a reload. `watchers` has a fixed length per call site
  // across renders, so a variable-length deps array is safe here despite
  // the lint rule being unable to verify that statically.
  const tokens = watchers.map((w) => (w.state === "idle" ? w.data : undefined));
  useEffect(() => {
    if (mountedRef.current && href && tokens.some(Boolean)) {
      reloadRef.current(href);
    }
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, tokens);

  const data = resolvedHref === href ? detailFetcher.data : undefined;
  return { data, isLoading: data === undefined };
}
