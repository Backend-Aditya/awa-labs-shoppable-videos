// Classifies a link pasted into "Import from link". Client-safe, so the
// modal and the server agree on what will happen to a link:
// - a public Instagram or TikTok post goes through the social importer,
// - a link to a video file (or a Dropbox share link, rewritten to download
//   the file) is handed to Cloudflare Stream, which fetches it itself,
// - anything else gets a message saying why it won't work and what to do.

export type SocialPlatform = "instagram" | "tiktok";

export type ImportLink =
  | { kind: "empty" }
  | { kind: "social"; platform: SocialPlatform }
  | { kind: "file"; url: string; source: "dropbox" | "direct" }
  | { kind: "invalid"; error: string };

const UPLOAD_INSTEAD = "Download the video and upload the file instead.";

// Sites whose links open a web page, not a video file.
const PAGE_SITES: { hosts: string[]; name: string }[] = [
  { hosts: ["youtube.com", "youtu.be"], name: "YouTube" },
  { hosts: ["facebook.com", "fb.watch"], name: "Facebook" },
  { hosts: ["vimeo.com"], name: "Vimeo" },
  { hosts: ["x.com", "twitter.com"], name: "X" },
  { hosts: ["pinterest.com", "pin.it"], name: "Pinterest" },
  { hosts: ["threads.net", "threads.com"], name: "Threads" },
  { hosts: ["snapchat.com"], name: "Snapchat" },
  { hosts: ["linkedin.com"], name: "LinkedIn" },
  { hosts: ["photos.google.com", "photos.app.goo.gl"], name: "Google Photos" },
  { hosts: ["icloud.com"], name: "iCloud" },
];

const onHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function detectSocialPlatform(url: URL): SocialPlatform | null {
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  if (host === "instagram.com" && /^\/(?:[^/]+\/)?(p|reel|reels|tv)\/[^/]+/.test(url.pathname)) return "instagram";
  if ((host === "tiktok.com" && /\/video\/\d+/.test(url.pathname)) || host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    return "tiktok";
  }
  return null;
}

// Hosts Cloudflare should never be asked to fetch: bare IPs, localhost and
// single-label or internal names.
function isPrivateHost(host: string): boolean {
  if (host === "localhost" || !host.includes(".")) return true;
  if (/^\[.*\]$/.test(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return /\.(local|localhost|internal|test|invalid|example)$/.test(host);
}

export function classifyImportLink(raw: string): ImportLink {
  const text = raw.trim();
  if (!text) return { kind: "empty" };

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return { kind: "invalid", error: "That doesn't look like a link. Paste the full address, starting with https://." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "invalid", error: "Paste a web link that starts with https://." };
  }
  const host = url.hostname.toLowerCase();
  if (isPrivateHost(host)) {
    return { kind: "invalid", error: "That link isn't publicly reachable. Paste a public link to the video." };
  }

  const platform = detectSocialPlatform(url);
  if (platform) return { kind: "social", platform };

  const bare = host.replace(/^(www|m)\./, "");
  if (bare === "instagram.com") {
    return { kind: "invalid", error: "Paste the link to one Instagram post or reel, not a profile." };
  }
  if (bare === "tiktok.com") {
    return { kind: "invalid", error: "Paste the link to one TikTok video, not a profile." };
  }
  if (onHost(bare, "drive.google.com") || onHost(bare, "docs.google.com")) {
    return {
      kind: "invalid",
      error: `Google Drive links can't be imported reliably. ${UPLOAD_INSTEAD} Or share it from Dropbox.`,
    };
  }
  const site = PAGE_SITES.find((s) => s.hosts.some((h) => onHost(bare, h)));
  if (site) {
    return { kind: "invalid", error: `${site.name} links open a web page, not a video file. ${UPLOAD_INSTEAD}` };
  }

  // Dropbox share links open a preview page; dl=1 downloads the file itself.
  if (onHost(bare, "dropbox.com")) {
    if (!/^\/(s|scl\/fi)\//.test(url.pathname)) {
      return { kind: "invalid", error: "Use Dropbox's Copy link on the video file itself, not a folder." };
    }
    url.searchParams.delete("raw");
    url.searchParams.set("dl", "1");
    url.protocol = "https:";
    return { kind: "file", url: url.toString(), source: "dropbox" };
  }

  url.hash = "";
  return { kind: "file", url: url.toString(), source: "direct" };
}
