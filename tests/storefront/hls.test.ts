// reel-hls.js: native HLS (Safari) vs lazily loaded hls.js elsewhere.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, resetPage } from "./harness";

type Bridge = {
  attach: (video: HTMLVideoElement, src: string, opts?: { preview?: boolean }) => Promise<void>;
  teardown: (video: HTMLVideoElement) => void;
  stopLoading: (video: HTMLVideoElement) => void;
  supportsNativeHls: (video: HTMLVideoElement) => boolean;
};
const bridge = () => (window as unknown as { ReelupHls: Bridge }).ReelupHls;

class FakeHls {
  static instances: FakeHls[] = [];
  static Events = { MANIFEST_PARSED: "parsed", ERROR: "error" };
  static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };
  static isSupported = () => true;
  handlers: Record<string, (event: string, data: unknown) => void> = {};
  startLevel = -2;
  autoLevelCapping = -1;
  constructor(public config: Record<string, unknown>) {
    FakeHls.instances.push(this);
  }
  loadSource = vi.fn();
  attachMedia = vi.fn();
  startLoad = vi.fn();
  stopLoad = vi.fn();
  recoverMediaError = vi.fn();
  destroy = vi.fn();
  on(event: string, handler: (event: string, data: unknown) => void) {
    this.handlers[event] = handler;
  }
  emit(event: "parsed" | "error", data: unknown) {
    this.handlers[event](event, data);
  }
}

const tick = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

async function load({ native = false } = {}) {
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue(native ? "maybe" : "");
  (window as unknown as { Hls: typeof FakeHls }).Hls = FakeHls;
  delete (window as unknown as { ReelupHls?: unknown }).ReelupHls;
  await mount("", ["hls"]);
}

async function attached(video = document.createElement("video"), opts?: { preview?: boolean }) {
  const attaching = bridge().attach(video, "https://x/a.m3u8", opts);
  await tick();
  const hls = FakeHls.instances.at(-1)!;
  return { video, hls, attaching };
}

beforeEach(() => {
  resetPage();
  FakeHls.instances = [];
});
afterEach(() => {
  delete (window as unknown as { Hls?: unknown }).Hls;
  vi.restoreAllMocks();
});

describe("reel-hls", () => {
  it("plays natively where the browser supports HLS", async () => {
    await load({ native: true });
    const video = document.createElement("video");
    await bridge().attach(video, "https://x/manifest.m3u8");
    expect(video.getAttribute("src")).toBe("https://x/manifest.m3u8");
    expect(FakeHls.instances).toHaveLength(0);
  });

  it("viewer: hls.js, ABR seeded by hls.js's own estimate when link speed is unknown", async () => {
    await load();
    const { video, hls, attaching } = await attached();
    expect(hls.config).toMatchObject({ autoStartLoad: false });
    expect(hls.loadSource).toHaveBeenCalledWith("https://x/a.m3u8");
    expect(hls.attachMedia).toHaveBeenCalledWith(video);
    hls.emit("parsed", { levels: [{ bitrate: 1 }, { bitrate: 2 }] });
    await attaching;
    expect(hls.startLevel).toBe(-1);
    expect(hls.startLoad).toHaveBeenCalled();
  });

  it("viewer: starts at the highest rendition the measured downlink can sustain", async () => {
    Object.defineProperty(navigator, "connection", { configurable: true, value: { downlink: 2 } });
    try {
      await load();
      const { hls, attaching } = await attached();
      hls.emit("parsed", { levels: [{ bitrate: 500_000 }, { bitrate: 1_200_000 }, { bitrate: 3_000_000 }] });
      await attaching;
      expect(hls.startLevel).toBe(1);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).connection;
    }
  });

  it("preview: capped to the lowest rendition", async () => {
    await load();
    const { hls, attaching } = await attached(undefined, { preview: true });
    expect(hls.config).toMatchObject({ startLevel: 0, maxBufferLength: 6 });
    hls.emit("parsed", { levels: [{ bitrate: 1 }, { bitrate: 2 }] });
    await attaching;
    expect(hls.autoLevelCapping).toBe(0);
  });

  it("a newer attach supersedes a pending one (AbortError) and destroys the old instance", async () => {
    await load();
    const { video, hls: first, attaching } = await attached();
    const second = bridge().attach(video, "https://x/2.m3u8");
    await expect(attaching).rejects.toMatchObject({ name: "AbortError" });
    expect(first.destroy).toHaveBeenCalled();
    await tick();
    FakeHls.instances[1].emit("parsed", { levels: [] });
    await expect(second).resolves.toBeUndefined();
  });

  it("rejects when the manifest fails fatally", async () => {
    await load();
    const { hls, attaching } = await attached();
    hls.emit("error", { fatal: true, type: "networkError" });
    await expect(attaching).rejects.toThrow("networkError");
    expect(hls.destroy).toHaveBeenCalled();
  });

  it("mid-play: retries the network 3 times, then reports a playback error", async () => {
    await load();
    const { video, hls, attaching } = await attached();
    const onError = vi.fn();
    video.addEventListener("reelup:playback-error", onError);
    hls.emit("parsed", { levels: [] });
    await attaching;
    hls.startLoad.mockClear();
    for (let i = 0; i < 3; i++) hls.emit("error", { fatal: true, type: "networkError" });
    expect(hls.startLoad).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
    hls.emit("error", { fatal: true, type: "networkError" });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(hls.destroy).toHaveBeenCalled();
  });

  it("mid-play: recovers media errors twice; non-fatal errors are ignored", async () => {
    await load();
    const { video, hls, attaching } = await attached();
    const onError = vi.fn();
    video.addEventListener("reelup:playback-error", onError);
    hls.emit("parsed", { levels: [] });
    await attaching;
    hls.emit("error", { fatal: false, type: "mediaError" });
    hls.emit("error", { fatal: true, type: "mediaError" });
    hls.emit("error", { fatal: true, type: "mediaError" });
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(2);
    hls.emit("error", { fatal: true, type: "mediaError" });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("stopLoading keeps the frame; teardown destroys and clears the source", async () => {
    await load();
    const { video, hls, attaching } = await attached();
    hls.emit("parsed", { levels: [] });
    await attaching;
    bridge().stopLoading(video);
    expect(hls.stopLoad).toHaveBeenCalled();
    bridge().teardown(video);
    expect(hls.destroy).toHaveBeenCalled();
    expect(video.hasAttribute("src")).toBe(false);
  });
});
