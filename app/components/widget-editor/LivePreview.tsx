// The real widget, live: the storefront block rendered on the server from
// the editor's current (unsaved) settings and run with the storefront's own
// CSS and JS in a sandboxed iframe (see models/widget-preview.server.ts).
//
// Smooth editing: the page loads once; after that each change swaps just
// the widget's markup into the running page and fires the theme editor's
// own "shopify:section:load" event, which the storefront scripts already
// listen to, so cards, decks and viewers re-bind without a reload or flash.
import { useCallback, useEffect, useRef, useState } from "react";
import type { WidgetStyleConfig } from "../../models/widget-kinds";
import type { Device, Mode, PreviewHighlight } from "./WidgetPreview";
import styles from "./preview.module.css";

export interface LiveSource {
  widgetId: string;
  reelIds?: string[];
  featuredReelId?: string;
}

type PreviewWindow = Window & {
  AwaSvLightbox?: { open: (trigger: Element, group?: Element[]) => void };
};

const DEBOUNCE_MS = 300;
const MOBILE_WIDTH = 390;

export function LivePreview({
  source,
  style,
  device,
  mode,
  highlight,
  onUnavailable,
  endpoint = "/app/widget-preview",
}: {
  source: LiveSource;
  style: WidgetStyleConfig;
  device: Device;
  mode: Mode;
  highlight: PreviewHighlight | null;
  // No preview possible (no ready videos, or the server couldn't build it):
  // the editor falls back to the drawn preview.
  onUnavailable: (unavailable: boolean) => void;
  endpoint?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [height, setHeight] = useState(420);
  const loaded = useRef(false);
  const seq = useRef(0);

  const doc = () => frame.current?.contentDocument ?? null;
  const win = () => (frame.current?.contentWindow as PreviewWindow | null) ?? null;

  const openViewer = useCallback(() => {
    const d = doc();
    const w = win();
    if (!d || !w) return;
    const trigger = d.querySelector<HTMLElement>(".is-active [data-awa-sv-trigger]") ?? d.querySelector<HTMLElement>("[data-awa-sv-trigger]");
    const pop = d.querySelector<HTMLElement>("[data-awa-sv-pop-open]");
    if (pop) {
      pop.click();
    } else if (trigger?.closest("[data-awa-sv-story-group]")) {
      trigger.querySelector<HTMLElement>(".awa-sv-trigger__button")?.click();
    } else if (trigger && w.AwaSvLightbox) {
      const group = Array.from(trigger.closest("[data-awa-sv-group]")?.querySelectorAll("[data-awa-sv-trigger]") ?? [trigger]);
      w.AwaSvLightbox.open(trigger, group);
    }
  }, []);

  const closeViewers = () => doc()?.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach((d) => d.close());

  // Fetch the rendered widget whenever what it shows changes (debounced;
  // a newer request wins over a slower older one).
  const key = JSON.stringify([source.widgetId, source.reelIds, source.featuredReelId, style]);
  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...source, style }),
        });
        const data = (await response.json()) as { html: string | null };
        if (id !== seq.current) return;
        if (!data.html) {
          onUnavailable(true);
          return;
        }
        onUnavailable(false);
        apply(data.html);
      } catch {
        if (id === seq.current) onUnavailable(true);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures source + style
  }, [key, endpoint]);

  // First render: load the page. Later: swap only the widget in place.
  const apply = (html: string) => {
    const d = doc();
    const root = d?.getElementById("awa-sv-preview-root");
    if (!loaded.current || !d || !root) {
      setSrcDoc(html);
      return;
    }
    const next = new DOMParser().parseFromString(html, "text/html").getElementById("awa-sv-preview-root");
    if (!next) {
      setSrcDoc(html);
      return;
    }
    const wasOpen = Boolean(d.querySelector("dialog[open]"));
    closeViewers();
    root.innerHTML = next.innerHTML;
    d.dispatchEvent(new CustomEvent("shopify:section:load", { bubbles: true }));
    if (wasOpen || mode === "viewer") setTimeout(openViewer, 50);
    measure();
  };

  const measure = () => {
    const d = doc();
    if (!d) return;
    // A viewer is a full-screen dialog: give it a phone-like stage to fill.
    if (mode === "viewer" || d.querySelector("dialog[open]")) {
      setHeight(device === "mobile" ? 720 : 640);
      return;
    }
    const content = d.getElementById("awa-sv-preview-root")?.getBoundingClientRect().height ?? 0;
    setHeight(Math.max(Math.ceil(content) + 40, 260));
  };

  const onLoad = () => {
    loaded.current = true;
    const d = doc();
    if (!d) return;
    if (highlight) d.documentElement.dataset.highlight = highlight;
    // Re-measure as posters load and decks lay out, and when a viewer opens
    // or closes inside the page.
    const w = win() as (Window & { ResizeObserver?: typeof ResizeObserver }) | null;
    const Observer = w?.ResizeObserver;
    const root = d.getElementById("awa-sv-preview-root");
    if (Observer && root) new Observer(() => measure()).observe(root);
    d.addEventListener("awa-sv:viewer-change", () => setTimeout(measure, 30));
    measure();
    if (mode === "viewer") setTimeout(openViewer, 150);
  };

  // Mode: open or close the real viewer.
  useEffect(() => {
    if (!loaded.current) return;
    if (mode === "viewer") openViewer();
    else closeViewers();
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measure/openViewer read current refs
  }, [mode]);

  // Device: the frame's width drives the real responsive CSS.
  useEffect(() => {
    if (loaded.current) setTimeout(measure, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measure reads current refs
  }, [device]);

  // Outline the part being edited.
  useEffect(() => {
    const d = doc();
    if (!d) return;
    if (highlight) d.documentElement.dataset.highlight = highlight;
    else delete d.documentElement.dataset.highlight;
  }, [highlight]);

  return (
    <div className={styles.live} data-device={device}>
      {srcDoc ? (
        <iframe
          ref={frame}
          className={styles.liveFrame}
          title="Live preview of your widget"
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-same-origin"
          onLoad={onLoad}
          style={{ height, width: device === "mobile" ? MOBILE_WIDTH : "100%" }}
        />
      ) : (
        <div className={styles.liveSkeleton} aria-hidden="true" />
      )}
      <span className={styles.liveStatus} data-busy={loading || undefined} role="status">
        {loading ? "Updating preview…" : "Live preview"}
      </span>
    </div>
  );
}
