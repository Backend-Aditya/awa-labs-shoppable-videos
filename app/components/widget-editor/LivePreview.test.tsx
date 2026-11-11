// The live preview: fetches the real widget for the editor's settings,
// loads it once, then swaps updates into the running page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LivePreview } from "./LivePreview";
import { WidgetPreview } from "./WidgetPreview";
import type { WidgetStyleConfig } from "../../models/widget-kinds";

const page = (body: string) => `<!doctype html><html><body><div id="awa-sv-preview-root">${body}</div></body></html>`;

let responses: Array<{ html: string | null } | Error>;
const fetchMock = vi.fn(async () => {
  const next = responses.shift() ?? { html: null };
  if (next instanceof Error) throw next;
  return new Response(JSON.stringify(next));
});

beforeEach(() => {
  responses = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

// jsdom doesn't run srcdoc: write the page into the frame by hand, then
// fire the load the browser would.
function loadFrame(frame: HTMLIFrameElement, body: string) {
  frame.contentDocument!.body.innerHTML = `<div id="awa-sv-preview-root">${body}</div>`;
  fireEvent.load(frame);
}

function setup(props: Partial<Parameters<typeof LivePreview>[0]> = {}) {
  const onUnavailable = vi.fn();
  const base = {
    source: { widgetId: "w1", reelIds: ["r1"] },
    style: { heading: "One" } as WidgetStyleConfig,
    device: "desktop" as const,
    mode: "page" as const,
    highlight: null,
    onUnavailable,
  };
  const utils = render(<LivePreview {...base} {...props} />);
  const rerender = (next: Partial<Parameters<typeof LivePreview>[0]>) => utils.rerender(<LivePreview {...base} {...props} {...next} />);
  return { ...utils, rerender, onUnavailable };
}

const frame = () => screen.getByTitle("Live preview of your widget") as HTMLIFrameElement;

describe("LivePreview", () => {
  it("posts the widget, its videos and the unsaved style, then loads the rendered page", async () => {
    responses.push({ html: page("<section>One</section>") });
    const { onUnavailable } = setup();
    expect(screen.getByRole("status")).toHaveTextContent("Updating preview…");
    await waitFor(() => expect(frame()).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/app/widget-preview", expect.objectContaining({ method: "POST" }));
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({
      widgetId: "w1",
      reelIds: ["r1"],
      style: { heading: "One" },
    });
    expect(frame().getAttribute("srcdoc")).toContain("<section>One</section>");
    expect(frame()).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
    expect(onUnavailable).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Live preview"));
  });

  it("after the first load, changes swap into the running page and re-bind the widget scripts", async () => {
    responses.push({ html: page("<section>One</section>") }, { html: page("<section>Two</section>") });
    const { rerender } = setup();
    await waitFor(() => expect(frame()).toBeInTheDocument());
    loadFrame(frame(), "<section>One</section>");
    const doc = frame().contentDocument!;
    const reloaded = vi.fn();
    doc.addEventListener("shopify:section:load", reloaded);
    const srcdocBefore = frame().getAttribute("srcdoc");

    rerender({ style: { heading: "Two" } });
    await waitFor(() => expect(doc.getElementById("awa-sv-preview-root")!.innerHTML).toBe("<section>Two</section>"));
    expect(reloaded).toHaveBeenCalledOnce();
    // Swapped in place: the page wasn't reloaded.
    expect(frame().getAttribute("srcdoc")).toBe(srcdocBefore);
  });

  it("a response without the preview root reloads the page instead", async () => {
    responses.push({ html: page("<section>One</section>") }, { html: "<p>replaced</p>" });
    const { rerender } = setup();
    await waitFor(() => expect(frame()).toBeInTheDocument());
    loadFrame(frame(), "<section>One</section>");
    rerender({ style: { heading: "Two" } });
    await waitFor(() => expect(frame().getAttribute("srcdoc")).toBe("<p>replaced</p>"));
  });

  it("reports when there's nothing to show, or the request fails", async () => {
    responses.push({ html: null });
    const first = setup();
    await waitFor(() => expect(first.onUnavailable).toHaveBeenCalledWith(true));
    first.unmount();

    responses.push(new Error("offline"));
    const second = setup();
    await waitFor(() => expect(second.onUnavailable).toHaveBeenCalledWith(true));
  });

  it("a newer change wins over a slower older request", async () => {
    responses.push({ html: page("old") }, { html: page("new") });
    const { rerender } = setup();
    rerender({ style: { heading: "Newer" } });
    await waitFor(() => expect(frame()).toBeInTheDocument());
    // Only the debounced, latest request ran.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(frame().getAttribute("srcdoc")).toContain("old");
  });

  it("follows the device (a phone-width frame) and outlines the part being edited", async () => {
    responses.push({ html: page("<section class='awa-sv'>One</section>") });
    const { rerender } = setup({ device: "mobile" });
    await waitFor(() => expect(frame()).toBeInTheDocument());
    expect(frame().style.width).toBe("390px");
    loadFrame(frame(), "<section class='awa-sv'>One</section>");
    rerender({ device: "mobile", highlight: "header" });
    expect(frame().contentDocument!.documentElement.dataset.highlight).toBe("header");
    rerender({ device: "desktop", highlight: null });
    expect(frame().contentDocument!.documentElement.dataset.highlight).toBeUndefined();
    expect(frame().style.width).toBe("100%");
  });

  it("viewer mode opens the real player on the first video, and page mode closes it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      responses.push({ html: page("x") });
      const { rerender } = setup();
      await waitFor(() => expect(frame()).toBeInTheDocument());
      const body = `<ul data-awa-sv-group><li><div data-awa-sv-trigger id="t1"><button class="awa-sv-trigger__button"></button></div></li><li><div data-awa-sv-trigger id="t2"></div></li></ul><dialog id="d"></dialog>`;
      loadFrame(frame(), body);
      const win = frame().contentWindow as Window & { AwaSvLightbox?: { open: ReturnType<typeof vi.fn> } };
      win.AwaSvLightbox = { open: vi.fn() };
      rerender({ mode: "viewer" });
      const doc = frame().contentDocument!;
      expect(win.AwaSvLightbox.open).toHaveBeenCalledWith(doc.getElementById("t1"), [doc.getElementById("t1"), doc.getElementById("t2")]);
      expect(frame().style.height).toBe("640px");

      const dialog = doc.getElementById("d") as HTMLDialogElement;
      dialog.setAttribute("open", "");
      dialog.close = vi.fn(() => dialog.removeAttribute("open"));
      rerender({ mode: "page" });
      expect(dialog.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stories open by tapping the first avatar; the floating video by its bubble", async () => {
    responses.push({ html: page("x") });
    const { rerender } = setup();
    await waitFor(() => expect(frame()).toBeInTheDocument());
    loadFrame(frame(), `<div data-awa-sv-story-group><div data-awa-sv-trigger><button class="awa-sv-trigger__button" id="avatar"></button></div></div>`);
    const tapped = vi.fn();
    frame().contentDocument!.getElementById("avatar")!.addEventListener("click", tapped);
    rerender({ mode: "viewer" });
    expect(tapped).toHaveBeenCalledOnce();

    rerender({ mode: "page" });
    loadFrame(frame(), `<button data-awa-sv-pop-open id="bubble"></button>`);
    const opened = vi.fn();
    frame().contentDocument!.getElementById("bubble")!.addEventListener("click", opened);
    rerender({ mode: "viewer" });
    expect(opened).toHaveBeenCalledOnce();
  });

  it("re-measures when a viewer opens or closes inside the page", async () => {
    responses.push({ html: page("x") });
    setup();
    await waitFor(() => expect(frame()).toBeInTheDocument());
    loadFrame(frame(), `<dialog open id="d"></dialog>`);
    act(() => {
      frame().contentDocument!.dispatchEvent(new Event("awa-sv:viewer-change"));
    });
    await waitFor(() => expect(frame().style.height).toBe("640px"));
  });
});

describe("WidgetPreview with a live source", () => {
  const reels = [{ id: "r1", title: "Reel 1", products: [] }];

  it("shows the real widget when there are videos, the drawn preview when it can't", async () => {
    responses.push({ html: page("<section>Real</section>") });
    const { container } = render(<WidgetPreview kind="CAROUSEL" style={{}} reels={reels} live={{ widgetId: "w1", reelIds: ["r1"] }} />);
    expect(container.querySelector(".viewport")).toBeNull();
    await waitFor(() => expect(screen.getByTitle("Live preview of your widget")).toBeInTheDocument());
    expect(screen.getByText(/Your real widget, with your videos and products/)).toBeInTheDocument();
  });

  it("falls back to the drawn preview when the live one is unavailable", async () => {
    responses.push({ html: null });
    const { container } = render(<WidgetPreview kind="CAROUSEL" style={{}} reels={reels} live={{ widgetId: "w1", reelIds: ["r1"] }} />);
    await waitFor(() => expect(container.querySelector(".viewport")).not.toBeNull());
  });

  it("without videos it stays on the drawn sample preview", () => {
    const { container } = render(<WidgetPreview kind="CAROUSEL" style={{}} reels={[]} live={{ widgetId: "w1", reelIds: [] }} />);
    expect(container.querySelector(".viewport")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
