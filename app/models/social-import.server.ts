// Resolves a public Instagram or TikTok post to its video file, so a reel
// can be created from a pasted link. Neither platform has a public API for
// this, so it reads the same page data a logged-out browser renders from:
// - Instagram: the post page embeds the media object (video_versions) in
//   its JSON <script> blobs. The CDN link is signed and public for a while,
//   so Cloudflare Stream can download it directly.
// - TikTok: the video page embeds the item in __UNIVERSAL_DATA_FOR_
//   REHYDRATION__ (older pages: SIGI_STATE). Its CDN only serves the file
//   to a request carrying the cookies the page set, so this server
//   downloads it and hands the bytes to Stream.
// Both can break when a platform changes its pages, and only work for
// public posts. Every failure throws SocialImportError with a message for
// the merchant.
import type { SocialPlatform } from "./video-link";

export type { SocialPlatform };

export class SocialImportError extends Error {}

export interface ResolvedSocialVideo {
  platform: SocialPlatform;
  videoUrl: string;
  posterUrl: string | null;
  // First line of the caption, for a default title.
  title: string | null;
  durationSeconds: number | null;
  // Extra request headers the video URL needs, or null when anyone can
  // fetch it (then Cloudflare downloads it itself).
  downloadHeaders: Record<string, string> | null;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// A top-level page load, as a browser sends it. Instagram serves a bare
// shell without the post data when these are missing.
const PAGE_HEADERS: Record<string, string> = {
  "user-agent": USER_AGENT,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
};

const PAGE_TIMEOUT_MS = 15_000;
const VIDEO_TIMEOUT_MS = 120_000;
// Cloudflare's basic (non-resumable) upload limit.
export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

const UPLOAD_INSTEAD = "Download the video and upload the file instead.";

type Fetch = typeof fetch;

async function fetchWithTimeout(fetchImpl: Fetch, url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function captionTitle(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.replace(/[#@][\w.]+/g, "").trim().length > 0);
  if (!line) return null;
  const clean = line.replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 79).trimEnd()}…` : clean;
}

/* ------------------------------------------------------------- Instagram */

export function instagramShortcode(url: string): string | null {
  try {
    return new URL(url).pathname.match(/\/(?:p|reels?|tv)\/([A-Za-z0-9_-]{5,40})/)?.[1] ?? null;
  } catch {
    return null;
  }
}

type InstagramMedia = {
  code?: string;
  media_type?: number;
  video_versions?: { url?: string; width?: number }[];
  carousel_media?: InstagramMedia[];
  image_versions2?: { candidates?: { url?: string }[] };
  caption?: { text?: string } | null;
  video_duration?: number;
};

function* jsonScriptBlobs(html: string): Generator<unknown> {
  const re = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    try {
      yield JSON.parse(match[1]);
    } catch {
      // Not every blob is JSON we can use.
    }
  }
}

function findByCode(node: unknown, code: string, depth = 0): InstagramMedia | null {
  if (!node || typeof node !== "object" || depth > 80) return null;
  if (!Array.isArray(node)) {
    const media = node as InstagramMedia;
    if (media.code === code && typeof media.media_type === "number") return media;
  }
  for (const value of Array.isArray(node) ? node : Object.values(node)) {
    const hit = findByCode(value, code, depth + 1);
    if (hit) return hit;
  }
  return null;
}

// Pure: page HTML -> the post's video, or a reason it has none.
export function extractInstagramVideo(
  html: string,
  shortcode: string,
): Omit<ResolvedSocialVideo, "platform" | "downloadHeaders"> | { error: string } {
  let media: InstagramMedia | null = null;
  for (const blob of jsonScriptBlobs(html)) {
    media = findByCode(blob, shortcode);
    if (media) break;
  }
  if (!media) {
    return {
      error: `Instagram didn't share this post. It may be private, age-restricted or removed. ${UPLOAD_INSTEAD}`,
    };
  }
  // A carousel: use its first video.
  const withVideo = media.video_versions?.length ? media : media.carousel_media?.find((m) => m.video_versions?.length);
  const url = withVideo?.video_versions?.find((v) => v.url)?.url;
  if (!withVideo || !url) return { error: "That Instagram post is a photo, not a video." };
  return {
    videoUrl: url,
    posterUrl: withVideo.image_versions2?.candidates?.[0]?.url ?? media.image_versions2?.candidates?.[0]?.url ?? null,
    title: captionTitle(media.caption?.text),
    durationSeconds: typeof withVideo.video_duration === "number" ? withVideo.video_duration : null,
  };
}

async function resolveInstagram(postUrl: string, fetchImpl: Fetch): Promise<ResolvedSocialVideo> {
  const shortcode = instagramShortcode(postUrl);
  if (!shortcode) throw new SocialImportError("Paste the link to one Instagram post or reel.");

  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      `https://www.instagram.com/p/${shortcode}/`,
      { headers: PAGE_HEADERS, redirect: "follow" },
      PAGE_TIMEOUT_MS,
    );
  } catch {
    throw new SocialImportError("Couldn't reach Instagram. Try again in a minute.");
  }
  if (response.status === 404) throw new SocialImportError("That Instagram post doesn't exist or was removed.");
  if (response.status === 429) {
    throw new SocialImportError("Instagram is limiting requests right now. Try again in a few minutes.");
  }
  if (!response.ok) {
    throw new SocialImportError(`Instagram didn't share this post. ${UPLOAD_INSTEAD}`);
  }

  const result = extractInstagramVideo(await response.text(), shortcode);
  if ("error" in result) throw new SocialImportError(result.error);
  return { platform: "instagram", ...result, downloadHeaders: null };
}

/* ---------------------------------------------------------------- TikTok */

type TiktokItem = {
  desc?: string;
  imagePost?: unknown;
  video?: {
    playAddr?: string;
    downloadAddr?: string;
    duration?: number;
    cover?: string;
    originCover?: string;
    bitrateInfo?: { CodecType?: string; PlayAddr?: { UrlList?: string[] } }[];
  };
};

function scriptById(html: string, id: string): unknown {
  const match = html.match(new RegExp(`<script[^>]+id="${id}"[^>]*>([\\s\\S]*?)</script>`));
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// Pure: page HTML -> the video's file URL, or a reason it has none.
export function extractTiktokVideo(
  html: string,
): Omit<ResolvedSocialVideo, "platform" | "downloadHeaders"> | { error: string } {
  let item: TiktokItem | null = null;
  let status: number | undefined;

  const universal = scriptById(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__") as {
    __DEFAULT_SCOPE__?: Record<string, { statusCode?: number; itemInfo?: { itemStruct?: TiktokItem } }>;
  } | null;
  const detail = universal?.__DEFAULT_SCOPE__?.["webapp.video-detail"];
  if (detail) {
    status = detail.statusCode;
    item = detail.itemInfo?.itemStruct ?? null;
  }
  if (!item) {
    const sigi = scriptById(html, "SIGI_STATE") as { ItemModule?: Record<string, TiktokItem> } | null;
    item = sigi?.ItemModule ? (Object.values(sigi.ItemModule)[0] ?? null) : null;
  }

  if (!item || (status !== undefined && status !== 0)) {
    return { error: `TikTok didn't share this video. It may be private or removed. ${UPLOAD_INSTEAD}` };
  }
  if (item.imagePost) return { error: "That TikTok is a photo post, not a video." };

  const video = item.video ?? {};
  // Prefer the unwatermarked H.264 stream, then any stream, then the
  // watermarked download.
  const byCodec = (codec: string) =>
    video.bitrateInfo?.find((b) => b.CodecType?.toLowerCase().includes(codec))?.PlayAddr?.UrlList?.[0];
  const url = video.playAddr || byCodec("h264") || video.bitrateInfo?.[0]?.PlayAddr?.UrlList?.[0] || video.downloadAddr;
  if (!url) return { error: `TikTok didn't share this video's file. ${UPLOAD_INSTEAD}` };

  return {
    videoUrl: url,
    posterUrl: video.originCover || video.cover || null,
    title: captionTitle(item.desc),
    durationSeconds: typeof video.duration === "number" ? video.duration : null,
  };
}

function cookiesFrom(response: Response): string {
  const raw =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : (response.headers.get("set-cookie") ?? "").split(/,(?=\s*[^;,=\s]+=)/);
  return raw
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.includes("="))
    .join("; ");
}

async function resolveTiktok(postUrl: string, fetchImpl: Fetch): Promise<ResolvedSocialVideo> {
  let response: Response;
  try {
    // Short links (vm./vt.tiktok.com) redirect to the full video page.
    response = await fetchWithTimeout(fetchImpl, postUrl, { headers: PAGE_HEADERS, redirect: "follow" }, PAGE_TIMEOUT_MS);
  } catch {
    throw new SocialImportError("Couldn't reach TikTok. Try again in a minute.");
  }
  if (response.status === 404) throw new SocialImportError("That TikTok video doesn't exist or was removed.");
  if (response.status === 429) {
    throw new SocialImportError("TikTok is limiting requests right now. Try again in a few minutes.");
  }
  if (!response.ok) throw new SocialImportError(`TikTok didn't share this video. ${UPLOAD_INSTEAD}`);

  const result = extractTiktokVideo(await response.text());
  if ("error" in result) throw new SocialImportError(result.error);
  const cookie = cookiesFrom(response);
  return {
    platform: "tiktok",
    ...result,
    downloadHeaders: {
      "user-agent": USER_AGENT,
      referer: "https://www.tiktok.com/",
      ...(cookie ? { cookie } : {}),
    },
  };
}

/* ----------------------------------------------------------------- API */

export async function resolveSocialVideo(
  platform: SocialPlatform,
  postUrl: string,
  fetchImpl: Fetch = fetch,
): Promise<ResolvedSocialVideo> {
  return platform === "instagram" ? resolveInstagram(postUrl, fetchImpl) : resolveTiktok(postUrl, fetchImpl);
}

// Downloads a video that needs this server to fetch it (TikTok), refusing
// anything that isn't a video or is too large to hand on to Stream.
export async function downloadSocialVideo(video: ResolvedSocialVideo, fetchImpl: Fetch = fetch): Promise<Response> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      video.videoUrl,
      { headers: video.downloadHeaders ?? { "user-agent": USER_AGENT }, redirect: "follow" },
      VIDEO_TIMEOUT_MS,
    );
  } catch {
    throw new SocialImportError("Couldn't download the video. Try again in a minute.");
  }
  if (!response.ok || !response.body) {
    throw new SocialImportError(`Couldn't download the video (the platform refused). ${UPLOAD_INSTEAD}`);
  }
  const type = response.headers.get("content-type") ?? "";
  if (type && !/^(video\/|application\/octet-stream|binary\/)/i.test(type)) {
    throw new SocialImportError(`The platform sent a web page instead of the video. ${UPLOAD_INSTEAD}`);
  }
  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > MAX_DOWNLOAD_BYTES) {
    await response.body.cancel().catch(() => {});
    throw new SocialImportError(`That video is too large to import from a link. ${UPLOAD_INSTEAD}`);
  }
  return response;
}
