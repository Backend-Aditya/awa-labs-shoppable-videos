// Fetches a video URL out of a public Instagram or TikTok post's HTML, so a
// reel can be created from a pasted link instead of only a local file
// upload. Neither platform offers a public API for this — this does the
// same thing a link-preview bot does: fetch the page, read the video URL out
// of its embedded page data. That makes it inherently fragile: it breaks
// whenever either platform changes markup, and it only works on posts that
// are public (no login wall). Every failure path throws SocialImportError
// with a message meant to be shown to the merchant as-is.

export type SocialPlatform = "instagram" | "tiktok";

export class SocialImportError extends Error {}

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 15_000;

export function parseSocialVideoUrl(
  rawUrl: string,
): { platform: SocialPlatform } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  if (host === "instagram.com" && /\/(p|reel|reels)\//.test(url.pathname)) {
    return { platform: "instagram" };
  }

  if (
    (host === "tiktok.com" && /\/video\//.test(url.pathname)) ||
    host === "vm.tiktok.com" ||
    host === "vt.tiktok.com"
  ) {
    return { platform: "tiktok" };
  }

  return null;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function extractOgMeta(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  return html.match(re)?.[1] ?? null;
}

function decodeJsonEscapes(value: string): string {
  return value.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
}

function extractInstagramVideoUrl(html: string): string | null {
  const ogVideo = extractOgMeta(html, "og:video:secure_url") ?? extractOgMeta(html, "og:video");
  if (ogVideo) return decodeJsonEscapes(ogVideo);

  // Fallback: Instagram's hydration payload embeds the raw CDN url as a
  // "video_url" field somewhere in an inline <script> blob.
  const match = html.match(/"video_url":"([^"]+)"/);
  return match ? decodeJsonEscapes(match[1]) : null;
}

function extractTiktokVideoUrl(html: string): string | null {
  const ogVideo = extractOgMeta(html, "og:video:secure_url") ?? extractOgMeta(html, "og:video");
  if (ogVideo) return decodeJsonEscapes(ogVideo);

  // Fallback: TikTok's __UNIVERSAL_DATA_FOR_REHYDRATION__ script embeds the
  // (watermarked) playAddr/downloadAddr for the video.
  const match =
    html.match(/"playAddr":"([^"]+)"/) ?? html.match(/"downloadAddr":"([^"]+)"/);
  return match ? decodeJsonEscapes(match[1]) : null;
}

export interface ResolvedSocialVideo {
  videoUrl: string;
  posterUrl: string | null;
  title: string | null;
}

export async function resolveVideoSourceUrl(
  platform: SocialPlatform,
  postUrl: string,
): Promise<ResolvedSocialVideo> {
  let response: Response;
  try {
    response = await fetchWithTimeout(postUrl, {
      headers: { "user-agent": DESKTOP_USER_AGENT, accept: "text/html" },
      redirect: "follow",
    });
  } catch {
    throw new SocialImportError(
      "Couldn't reach that link. Check the URL and try again.",
    );
  }

  if (!response.ok) {
    throw new SocialImportError(
      "Couldn't fetch video from that link. Make sure the post is public.",
    );
  }

  const html = await response.text();
  const videoUrl =
    platform === "instagram" ? extractInstagramVideoUrl(html) : extractTiktokVideoUrl(html);

  if (!videoUrl) {
    throw new SocialImportError(
      "Couldn't find a video on that page. Make sure the post is public and links directly to a video.",
    );
  }

  const posterUrl = extractOgMeta(html, "og:image");
  const title = extractOgMeta(html, "og:title");

  return { videoUrl, posterUrl, title };
}

// Fetches the resolved direct video URL's bytes, separately from the HTML
// page fetch above — the CDN URL needs the same browser-like headers (and
// often a Referer back to the original post) or it 403s even though it's
// the same "public" video the page itself embeds.
export async function fetchSocialVideo(videoUrl: string, refererUrl?: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetchWithTimeout(videoUrl, {
      headers: {
        "user-agent": DESKTOP_USER_AGENT,
        ...(refererUrl ? { referer: refererUrl } : {}),
      },
      redirect: "follow",
    });
  } catch {
    throw new SocialImportError("Couldn't download the video from that link. Try again.");
  }

  if (!response.ok || !response.body) {
    throw new SocialImportError("Couldn't download the video from that link. Try again.");
  }

  return response;
}
