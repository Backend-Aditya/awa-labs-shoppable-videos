// Loads the SOURCE storefront scripts (scripts/extension-assets-src) into
// the jsdom window with markup rendered from the real Liquid blocks, and
// stubs what jsdom lacks: <dialog> modal API, media playback, matchMedia,
// IntersectionObserver, CSS.escape, the HLS bridge and the network.
import { vi } from "vitest";
import { createLiquidEngine } from "../support/liquid-engine.mjs";
import { blockContext, BLOCK_METAFIELDS } from "../support/storefront-fixtures.mjs";

const SCRIPTS = {
  lightbox: () => import("../../scripts/extension-assets-src/reel-lightbox.js"),
  story: () => import("../../scripts/extension-assets-src/reel-story.js"),
  trigger: () => import("../../scripts/extension-assets-src/reel-trigger.js"),
  pop: () => import("../../scripts/extension-assets-src/reel-pop.js"),
  hls: () => import("../../scripts/extension-assets-src/reel-hls.js"),
} as const;
export type ScriptName = keyof typeof SCRIPTS;

const engine = createLiquidEngine();
type Block = keyof typeof BLOCK_METAFIELDS;

/** Render a real theme block with fixture data. */
export function renderBlock(block: Block, input: Parameters<typeof blockContext>[1]) {
  return engine.renderFile(block, blockContext(block, input)) as Promise<string>;
}

/** The app embed's #reelup-config JSON, rendered from Liquid. */
export async function configScript(overrides: Record<string, unknown> = {}) {
  const html = (await engine.renderFile("shoppable-videos", blockContext("shoppable-videos", { widget: { published: false } }))) as string;
  const json = html.match(/<script type="application\/json" id="reelup-config">([\s\S]*?)<\/script>/)![1];
  const config = { ...JSON.parse(json), ...overrides };
  return `<script type="application/json" id="reelup-config">${JSON.stringify(config)}</script>`;
}

/* ------------------------------------------------------------ stubs */

export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observed = new Set<Element>();
  constructor(public callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
  trigger(entries: { target: Element; isIntersecting: boolean }[]) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

export const media = { mobile: false, hover: true, reducedMotion: false };

export const hls = {
  attach: vi.fn(async (_video: HTMLVideoElement, _src: string, _opts?: object) => {}),
  teardown: vi.fn((_video: HTMLVideoElement) => {}),
};

export const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Default routes: cart add/js, recommendations, analytics. */
export function defaultRoutes(url: string): Response {
  if (url.startsWith("/cart/add.js")) return json({ items: [{ id: 1, quantity: 1 }] });
  if (url.startsWith("/cart.js")) return json({ item_count: 3, items: [] });
  if (url.startsWith("/recommendations")) return json({ products: [] });
  return json({ ok: true });
}

const added: (() => void)[] = [];
let listenersPatched = false;

// Scripts register document/window listeners on every load; record them so
// each test starts from a clean slate. Patched once, delegating to the
// original (bound) methods — vitest's `window` is not itself an EventTarget.
function patchListeners() {
  if (listenersPatched) return;
  listenersPatched = true;
  for (const target of [document, window] as EventTarget[]) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (listener) added.push(() => remove(type, listener, options));
      add(type, listener, options);
    };
  }
}

function installStubs() {
  patchListeners();

  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  Object.defineProperty(HTMLDialogElement.prototype, "open", {
    configurable: true,
    get(this: HTMLDialogElement) {
      return this.hasAttribute("open");
    },
  });

  const mediaProto = HTMLMediaElement.prototype;
  Object.defineProperty(mediaProto, "paused", { configurable: true, writable: true, value: true });
  mediaProto.play = vi.fn(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { configurable: true, writable: true, value: false });
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  mediaProto.pause = vi.fn(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { configurable: true, writable: true, value: true });
    this.dispatchEvent(new Event("pause"));
  });
  mediaProto.load = vi.fn();

  window.matchMedia = vi.fn((query: string) => ({
    matches:
      (query.includes("max-width: 749px") && media.mobile) ||
      (query.includes("hover: hover") && media.hover) ||
      (query.includes("prefers-reduced-motion") && media.reducedMotion),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.stubGlobal("CSS", { escape: (s: string) => s.replace(/["\\]/g, "\\$&") });
  vi.stubGlobal("fetch", fetchMock);
  (window as unknown as { ReelupHls: typeof hls }).ReelupHls = hls;
  Element.prototype.scrollIntoView = vi.fn();
  (Element.prototype as unknown as { scrollBy: () => void }).scrollBy = vi.fn();
}

/** Reset the page, stubs and module registry; call in beforeEach. */
export function resetPage() {
  for (const remove of added.splice(0)) remove();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.className = "";
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/products/linen-shirt");
  media.mobile = false;
  media.hover = true;
  media.reducedMotion = false;
  FakeIntersectionObserver.instances = [];
  hls.attach.mockReset().mockResolvedValue(undefined);
  hls.teardown.mockReset();
  fetchMock.mockReset().mockImplementation(async (url) => defaultRoutes(String(url)));
  vi.unstubAllGlobals();
  installStubs();
  vi.resetModules();
}

/** Put markup on the page, then run the scripts in theme load order. */
export async function mount(html: string, scripts: ScriptName[] = ["lightbox", "story", "trigger", "pop"], config?: Record<string, unknown>) {
  document.body.innerHTML = (await configScript(config)) + html;
  for (const name of scripts) await SCRIPTS[name]();
}

/** Let pending promise chains (fetch → json → DOM) settle. */
export async function flush(times = 5) {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

export const viewer = () => document.getElementById("reelup-lightbox") as HTMLDialogElement | null;
export const storyViewer = () => document.getElementById("reelup-story-viewer") as HTMLDialogElement | null;

export function click(el: Element | null | undefined) {
  if (!el) throw new Error("click(): element not found");
  (el as HTMLElement).click();
}

export const fetchCalls = (prefix: string) => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(prefix));
export const fetchBody = (call: [string, RequestInit?]) => JSON.parse(String(call[1]?.body));
