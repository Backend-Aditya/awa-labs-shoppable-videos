// reel-hls.js: native HLS (Safari) vs lazily loaded hls.js elsewhere.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, resetPage } from "./harness";

type Bridge = {
  attach: (video: HTMLVideoElement, src: string, opts?: { preview?: boolean }) => Promise<void>;
  teardown: (video: HTMLVideoElement) => void;
  supportsNativeHls: (video: HTMLVideoElement) => boolean;
};
const bridge = () => (window as unknown as { ReelupHls: Bridge }).ReelupHls;

class FakeHls {
  static instances: FakeHls[] = [];
  static Events = { MANIFEST_PARSED: "parsed", ERROR: "error" };
  static isSupported = () => true;
  handlers: Record<string, (event: string, data: unknown) => void> = {};
  currentLevel = -1;
  constructor(public config: Record<string, unknown>) {
    FakeHls.instances.push(this);
  }
  loadSource = vi.fn();
  attachMedia = vi.fn();
  startLoad = vi.fn();
  destroy = vi.fn();
  on(event: string, handler: (event: string, data: unknown) => void) {
    this.handlers[event] = handler;
  }
}

beforeEach(() => {
  resetPage();
  FakeHls.instances = [];
});

describe("reel-hls", () => {
  it("plays natively where the browser supports HLS", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("maybe");
    await mount("", ["hls"]);
    const video = document.createElement("video");
    await bridge().attach(video, "https://x/manifest.m3u8");
    expect(video.getAttribute("src")).toBe("https://x/manifest.m3u8");
    vi.restoreAllMocks();
  });

  it("uses hls.js otherwise, pinning the top level for the viewer and level 0 for previews", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("");
    (window as unknown as { Hls: typeof FakeHls }).Hls = FakeHls;
    await mount("", ["hls"]);
    const video = document.createElement("video");
    const full = bridge().attach(video, "https://x/a.m3u8");
    await Promise.resolve();
    await Promise.resolve();
    const hlsFull = FakeHls.instances[0];
    expect(hlsFull.config).toMatchObject({ autoStartLoad: false });
    hlsFull.handlers.parsed("parsed", { levels: [{ bitrate: 1 }, { bitrate: 2 }, { bitrate: 3 }] });
    await full;
    expect(hlsFull.currentLevel).toBe(2);
    expect(hlsFull.startLoad).toHaveBeenCalled();

    const preview = bridge().attach(video, "https://x/b.m3u8", { preview: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(hlsFull.destroy).toHaveBeenCalled();
    const hlsPreview = FakeHls.instances[1];
    hlsPreview.handlers.parsed("parsed", { levels: [{ bitrate: 1 }, { bitrate: 2 }] });
    await preview;
    expect(hlsPreview.currentLevel).toBe(0);

    bridge().teardown(video);
    expect(hlsPreview.destroy).toHaveBeenCalled();
    delete (window as unknown as { Hls?: unknown }).Hls;
    vi.restoreAllMocks();
  });

  it("rejects on a fatal hls.js error", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("");
    (window as unknown as { Hls: typeof FakeHls }).Hls = FakeHls;
    await mount("", ["hls"]);
    const attempt = bridge().attach(document.createElement("video"), "https://x/a.m3u8");
    await Promise.resolve();
    await Promise.resolve();
    FakeHls.instances[0].handlers.error("error", { fatal: true, type: "networkError" });
    await expect(attempt).rejects.toThrow("networkError");
    delete (window as unknown as { Hls?: unknown }).Hls;
    vi.restoreAllMocks();
  });
});
