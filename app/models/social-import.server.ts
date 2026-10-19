// Resolves a public Instagram or TikTok post to its video file, so a reel
// can be created from a pasted link. Neither platform has a public API for
// this, so it reads the same page data a logged-out browser renders from:
// - Instagram: the post page embeds the media object (video_versions) in
//   its JSON <script> blobs. Instagram rate-limits that page for shared
//   server addresses, so the embed page (what sites use to embed a post,
//   lower resolution) is the fallback. The CDN link is signed and public
//   for a while, so Cloudflare Stream can download it directly.
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

// Both shapes Instagram uses: the post page's API objects (video_versions,
// image_versions2, caption.text) and the embed page's GraphQL ones
// (video_url, display_url, edge_media_to_caption).
type InstagramMedia = {
  code?: string;
  shortcode?: string;
  media_type?: number;
  __typename?: string;
  is_video?: boolean;
  video_versions?: { url?: string }[];
  video_url?: string;
  video_duration?: number;
  carousel_media?: InstagramMedia[];
  edge_sidecar_to_children?: { edges?: { node?: InstagramMedia }[] };
  image_versions2?: { candidates?: { url?: string }[] };
  display_url?: string;
  caption?: { text?: string } | null;
  edge_media_to_caption?: { edges?: { node?: { text?: string } }[] };
};

// The JSON payloads in a page: <script type="application/json"> blobs and
// ServerJS `.handle({...})` calls (the embed page).
function* pagePayloads(html: string): Generator<unknown> {
  const json = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = json.exec(html))) {
    try {
      yield JSON.parse(match[1]);
    } catch {
      // Not every blob is JSON we can use.
    }
  }
  let from = 0;
  while ((from = html.indexOf(".handle({", from)) !== -1) {
    const start = from + ".handle(".length;
    const end = matchingBrace(html, start);
    from = start;
    if (end === -1) continue;
    try {
      yield JSON.parse(html.slice(start, end + 1));
    } catch {
      // Not plain JSON.
    }
  }
}

// Index of the brace closing the object that opens at `start`, skipping
// braces inside strings.
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

function isPostMedia(node: InstagramMedia, code: string): boolean {
  return (
    (node.code === code || node.shortcode === code) &&
    (typeof node.media_type === "number" || typeof node.__typename === "string" || typeof node.is_video === "boolean")
  );
}

// Collects every object describing the post. A page can hold several (a
// light stub for the header, the full media for the player), so the caller
// picks the one with video. Some payloads carry JSON inside string fields
// (the embed page's contextJSON); strings that mention the shortcode are
// decoded and searched too.
function collectMedia(node: unknown, code: string, out: InstagramMedia[], depth = 0): void {
  if (depth > 80 || node == null || out.length >= 20) return;
  if (typeof node === "string") {
    if (node.length < 64 || !node.includes(code) || !/^\s*[[{]/.test(node)) return;
    try {
      collectMedia(JSON.parse(node), code, out, depth + 1);
    } catch {
      // Not JSON after all.
    }
    return;
  }
  if (typeof node !== "object") return;
  if (!Array.isArray(node) && isPostMedia(node as InstagramMedia, code)) out.push(node as InstagramMedia);
  for (const value of Array.isArray(node) ? node : Object.values(node)) collectMedia(value, code, out, depth + 1);
}

const videoOf = (m: InstagramMedia | undefined) => m?.video_versions?.find((v) => v.url)?.url ?? m?.video_url ?? null;
const childrenOf = (m: InstagramMedia) =>
  m.carousel_media ?? m.edge_sidecar_to_children?.edges?.map((e) => e.node ?? {}) ?? [];

// Pure: page HTML -> the post's video, or a reason it has none.
export function extractInstagramVideo(
  html: string,
  shortcode: string,
): Omit<ResolvedSocialVideo, "platform" | "downloadHeaders"> | { error: string } {
  const found: InstagramMedia[] = [];
  for (const payload of pagePayloads(html)) collectMedia(payload, shortcode, found);
  const hasVideo = (m: InstagramMedia) => Boolean(videoOf(m) || childrenOf(m).some((c) => videoOf(c)));
  const media = found.find(hasVideo) ?? found[0];
  if (!media) {
    return {
      error: `Instagram didn't share this post. It may be private, age-restricted or removed. ${UPLOAD_INSTEAD}`,
    };
  }
  // A carousel: use its first video.
  const withVideo = videoOf(media) ? media : childrenOf(media).find((m) => videoOf(m));
  const url = videoOf(withVideo);
  if (!withVideo || !url) return { error: "That Instagram post is a photo, not a video." };
  const poster = (m: InstagramMedia) => m.image_versions2?.candidates?.[0]?.url ?? m.display_url ?? null;
  return {
    videoUrl: url,
    posterUrl: poster(withVideo) ?? poster(media),
    title: captionTitle(
      found.map((m) => m.caption?.text ?? m.edge_media_to_caption?.edges?.[0]?.node?.text).find(Boolean),
    ),
    durationSeconds: typeof withVideo.video_duration === "number" ? withVideo.video_duration : null,
  };
}

type PageResult = { html: string } | { status: number } | { unreachable: true };

async function loadInstagramPage(url: string, headers: Record<string, string>, fetchImpl: Fetch): Promise<PageResult> {
  try {
    const response = await fetchWithTimeout(fetchImpl, url, { headers, redirect: "follow" }, PAGE_TIMEOUT_MS);
    return response.ok ? { html: await response.text() } : { status: response.status };
  } catch {
    return { unreachable: true };
  }
}

// How a site embedding the post in an iframe asks for it.
const EMBED_HEADERS: Record<string, string> = {
  ...PAGE_HEADERS,
  "sec-fetch-dest": "iframe",
  "sec-fetch-site": "cross-site",
};

async function resolveInstagram(postUrl: string, fetchImpl: Fetch): Promise<ResolvedSocialVideo> {
  const shortcode = instagramShortcode(postUrl);
  if (!shortcode) throw new SocialImportError("Paste the link to one Instagram post or reel.");

  // Full-quality post page first; the embed page only if that fails.
  const attempts = [
    () => loadInstagramPage(`https://www.instagram.com/p/${shortcode}/`, PAGE_HEADERS, fetchImpl),
    () => loadInstagramPage(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, EMBED_HEADERS, fetchImpl),
  ];
  let lastError: string | null = null;
  const statuses: number[] = [];
  let reached = false;
  for (const attempt of attempts) {
    const page = await attempt();
    if ("unreachable" in page) continue;
    reached = true;
    if ("status" in page) {
      if (page.status === 404) throw new SocialImportError("That Instagram post doesn't exist or was removed.");
      statuses.push(page.status);
      continue;
    }
    const result = extractInstagramVideo(page.html, shortcode);
    if (!("error" in result)) return { platform: "instagram", ...result, downloadHeaders: null };
    // A definite answer about the post itself; no point trying further.
    if (/photo, not a video/.test(result.error)) throw new SocialImportError(result.error);
    lastError = result.error;
  }

  if (!reached) throw new SocialImportError("Couldn't reach Instagram. Try again in a minute.");
  if (!lastError && statuses.includes(429)) {
    throw new SocialImportError("Instagram is limiting requests right now. Try again in a few minutes.");
  }
  throw new SocialImportError(lastError ?? `Instagram didn't share this post. ${UPLOAD_INSTEAD}`);
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
