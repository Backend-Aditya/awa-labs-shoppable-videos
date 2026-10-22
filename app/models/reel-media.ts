// Client-safe helpers for Cloudflare Stream image URLs. Stream serves
// thumbnails at .../<uid>/thumbnails/thumbnail.jpg and accepts ?time=Ns to
// pick the frame, plus an animated .gif variant, so a cover frame and a
// hover preview are just URL tweaks, no extra API calls.

const STREAM_THUMBNAIL = /^(https:\/\/[^/]+\/[^/]+\/thumbnails\/thumbnail)\.(jpg|gif|png|webp)(\?.*)?$/i;

export function isStreamThumbnail(url: string | undefined | null): url is string {
  return Boolean(url && STREAM_THUMBNAIL.test(url));
}

// The poster for a given second of the video; falls back to the URL
// unchanged when it isn't a Stream thumbnail.
export function posterAt(posterUrl: string, seconds: number | undefined): string {
  const match = posterUrl.match(STREAM_THUMBNAIL);
  if (!match) return posterUrl;
  const base = `${match[1]}.jpg`;
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return base;
  return `${base}?time=${Math.round(seconds * 10) / 10}s`;
}

// A short, small looping GIF starting at the cover frame, for hover
// previews in the admin library.
export function animatedPreviewUrl(posterUrl: string | undefined, seconds = 0): string | null {
  if (!posterUrl) return null;
  const match = posterUrl.match(STREAM_THUMBNAIL);
  if (!match) return null;
  const start = Math.max(0, Math.round(seconds));
  return `${match[1]}.gif?time=${start}s&duration=4s&height=360&fps=12`;
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
