// Client side of the upload flow: ask app.reels.upload for a one-time
// Cloudflare URL, then send the file straight to Cloudflare with XHR so
// there's real progress. fetch() to our own origin goes through App
// Bridge, which attaches the session token.

const ENDPOINT = "/app/reels/upload";

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

type ApiResult = { error?: string; reelId?: string; uploadURL?: string };

async function call(body: Record<string, unknown>): Promise<ApiResult> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  let data: ApiResult = {};
  try {
    data = (await response.json()) as ApiResult;
  } catch {
    // Non-JSON (e.g. an auth redirect), handled below.
  }
  if (!response.ok || data.error) {
    throw new Error(data.error ?? "Something went wrong. Please try again.");
  }
  return data;
}

function sendToCloudflare(uploadURL: string, file: File, onProgress: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadURL);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed.")));
    xhr.onerror = () => reject(new Error("The upload failed. Check your connection and try again."));
    const body = new FormData();
    body.append("file", file);
    xhr.send(body);
  });
}

export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Untitled video";
}

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|mpe?g|3gp|ogv)$/i;

// Some systems (notably Windows for .mov/.mkv) report an empty MIME type,
// so fall back to the file extension.
export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || (!file.type && VIDEO_EXTENSIONS.test(file.name));
}

export function validateVideoFile(file: File): string | null {
  if (!isVideoFile(file)) return "Not a video file.";
  if (file.size > MAX_UPLOAD_BYTES) return "Larger than 200 MB.";
  return null;
}

export async function uploadNewReel(
  file: File,
  options: { title: string; published: boolean; productIds: string[] },
  onProgress: (ratio: number) => void,
): Promise<string> {
  const { reelId, uploadURL } = await call({ intent: "create", ...options });
  if (!reelId || !uploadURL) throw new Error("Upload couldn't start.");
  try {
    await sendToCloudflare(uploadURL, file, onProgress);
  } catch (error) {
    // Nothing was uploaded: remove the new reel (and its empty Stream video)
    // so a retry doesn't leave a trail of "Failed" tiles.
    await discardFailedUpload(reelId);
    throw error;
  }
  return reelId;
}

export async function discardFailedUpload(reelId: string): Promise<void> {
  await call({ intent: "discard", reelId }).catch(() => {});
}

export async function importReel(options: {
  title: string;
  published: boolean;
  productIds: string[];
  sourceUrl: string;
}): Promise<string> {
  const { reelId } = await call({ intent: "import", ...options, rightsConfirmed: true });
  if (!reelId) throw new Error("Import failed.");
  return reelId;
}

export async function replaceReelVideo(reelId: string, file: File, onProgress: (ratio: number) => void): Promise<void> {
  const { uploadURL } = await call({ intent: "replace", reelId });
  if (!uploadURL) throw new Error("Upload couldn't start.");
  try {
    await sendToCloudflare(uploadURL, file, onProgress);
  } catch (error) {
    await call({ intent: "failed", reelId }).catch(() => {});
    throw error;
  }
}
