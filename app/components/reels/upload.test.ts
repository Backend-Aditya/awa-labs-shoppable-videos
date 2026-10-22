// Client upload flow: our API hands out a one-time Cloudflare URL, then the
// file goes straight to Cloudflare by XHR. No real network: fetch and
// XMLHttpRequest are stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importReel, isVideoFile, MAX_UPLOAD_BYTES, replaceReelVideo, titleFromFilename, uploadNewReel, validateVideoFile } from "./upload";

type XhrBehaviour = "ok" | "http-error" | "network-error";

class FakeXhr {
  static behaviour: XhrBehaviour = "ok";
  static instances: FakeXhr[] = [];
  method = "";
  url = "";
  status = 0;
  body: unknown;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: unknown) {
    this.body = body;
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      if (FakeXhr.behaviour === "network-error") return this.onerror?.();
      this.status = FakeXhr.behaviour === "ok" ? 201 : 500;
      this.onload?.();
    });
  }
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const file = (type = "video/mp4", size = 10) => new File([new Uint8Array(size)], "clip.mp4", { type });

let fetchMock: ReturnType<typeof vi.fn>;
const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

beforeEach(() => {
  FakeXhr.behaviour = "ok";
  FakeXhr.instances = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("titleFromFilename", () => {
  it.each([
    ["summer_sale-final.mp4", "Summer sale final"],
    ["  my   clip .mov", "My clip"],
    ["a.b.c.webm", "A.b.c"],
    [".mp4", "Untitled video"],
    ["___.mp4", "Untitled video"],
  ])("%j → %j", (name, title) => {
    expect(titleFromFilename(name)).toBe(title);
  });
});

describe("validateVideoFile", () => {
  it("accepts videos up to 200 MB", () => {
    expect(validateVideoFile(file())).toBeNull();
    expect(validateVideoFile({ type: "video/quicktime", size: MAX_UPLOAD_BYTES } as File)).toBeNull();
  });
  it("falls back to the extension when the OS reports no MIME type (Windows .mov/.mkv)", () => {
    expect(isVideoFile(new File([], "clip.MOV", { type: "" }))).toBe(true);
    expect(isVideoFile(new File([], "clip.mkv", { type: "" }))).toBe(true);
    expect(isVideoFile(new File([], "notes.txt", { type: "" }))).toBe(false);
    // A declared non-video type wins over the extension.
    expect(isVideoFile(new File([], "clip.mp4", { type: "text/plain" }))).toBe(false);
  });
  it("rejects non-videos and oversize files", () => {
    expect(validateVideoFile(file("image/png"))).toBe("Not a video file.");
    expect(validateVideoFile({ type: "video/mp4", size: MAX_UPLOAD_BYTES + 1 } as File)).toBe("Larger than 200 MB.");
  });
});

describe("uploadNewReel", () => {
  it("creates the reel, uploads to the one-time URL and reports progress", async () => {
    fetchMock.mockReturnValueOnce(json({ reelId: "gid://shopify/Metaobject/1", uploadURL: "https://upload.cloudflare.test/x" }));
    const progress = vi.fn();
    const id = await uploadNewReel(file(), { title: "Clip", published: true, productIds: ["p1"] }, progress);
    expect(id).toBe("gid://shopify/Metaobject/1");
    expect(fetchMock).toHaveBeenCalledWith("/app/reels/upload", expect.objectContaining({ method: "POST" }));
    expect(bodies()).toEqual([{ intent: "create", title: "Clip", published: true, productIds: ["p1"] }]);
    expect(FakeXhr.instances[0].method).toBe("POST");
    expect(FakeXhr.instances[0].url).toBe("https://upload.cloudflare.test/x");
    expect(FakeXhr.instances[0].body).toBeInstanceOf(FormData);
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith(0.5);
  });

  it("surfaces the API's error message", async () => {
    fetchMock.mockReturnValueOnce(json({ error: "Plan limit reached" }, 403));
    await expect(uploadNewReel(file(), { title: "", published: false, productIds: [] }, () => {})).rejects.toThrow("Plan limit reached");
  });

  it("uses a generic message for a non-JSON failure (e.g. auth redirect)", async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response("<html>", { status: 302 })));
    await expect(uploadNewReel(file(), { title: "", published: false, productIds: [] }, () => {})).rejects.toThrow(
      "Something went wrong. Please try again.",
    );
  });

  it("refuses to upload without an upload URL", async () => {
    fetchMock.mockReturnValueOnce(json({ reelId: "r1" }));
    await expect(uploadNewReel(file(), { title: "", published: false, productIds: [] }, () => {})).rejects.toThrow("Upload couldn't start.");
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it.each([
    ["http-error", "Upload failed."],
    ["network-error", "The upload failed. Check your connection and try again."],
  ] as const)("discards the new reel when the Cloudflare upload has a %s", async (behaviour, message) => {
    FakeXhr.behaviour = behaviour;
    fetchMock.mockReturnValueOnce(json({ reelId: "r1", uploadURL: "https://u" })).mockReturnValueOnce(json({ ok: true }));
    await expect(uploadNewReel(file(), { title: "", published: false, productIds: [] }, () => {})).rejects.toThrow(message);
    expect(bodies()[1]).toEqual({ intent: "discard", reelId: "r1" });
  });

  it("still reports the upload error if marking failed also fails", async () => {
    FakeXhr.behaviour = "http-error";
    fetchMock.mockReturnValueOnce(json({ reelId: "r1", uploadURL: "https://u" })).mockReturnValueOnce(Promise.reject(new Error("offline")));
    await expect(uploadNewReel(file(), { title: "", published: false, productIds: [] }, () => {})).rejects.toThrow("Upload failed.");
  });
});

describe("importReel", () => {
  it("posts an import intent and returns the reel id", async () => {
    fetchMock.mockReturnValueOnce(json({ reelId: "r9" }));
    await expect(
      importReel({ title: "T", published: true, productIds: [], sourceUrl: "https://www.instagram.com/reel/abc/" }),
    ).resolves.toBe("r9");
    expect(bodies()[0]).toMatchObject({ intent: "import", rightsConfirmed: true, sourceUrl: "https://www.instagram.com/reel/abc/" });
  });

  it("fails without a reel id", async () => {
    fetchMock.mockReturnValueOnce(json({}));
    await expect(importReel({ title: "T", published: true, productIds: [], sourceUrl: "x" })).rejects.toThrow("Import failed.");
  });
});

describe("replaceReelVideo", () => {
  it("asks for a replace URL and uploads", async () => {
    fetchMock.mockReturnValueOnce(json({ uploadURL: "https://u" }));
    await replaceReelVideo("r1", file(), () => {});
    expect(bodies()).toEqual([{ intent: "replace", reelId: "r1" }]);
    expect(FakeXhr.instances).toHaveLength(1);
  });

  it("fails without a URL, and marks failed uploads", async () => {
    fetchMock.mockReturnValueOnce(json({}));
    await expect(replaceReelVideo("r1", file(), () => {})).rejects.toThrow("Upload couldn't start.");

    FakeXhr.behaviour = "http-error";
    fetchMock.mockReturnValueOnce(json({ uploadURL: "https://u" })).mockReturnValueOnce(json({}));
    await expect(replaceReelVideo("r1", file(), () => {})).rejects.toThrow("Upload failed.");
    expect(bodies().at(-1)).toEqual({ intent: "failed", reelId: "r1" });
  });
});
