import { createHmac, timingSafeEqual } from "node:crypto";

export interface CloudflareStreamConfig {
  accountId: string;
  apiToken: string;
}

/**
 * Builds a CloudflareStreamConfig from environment variables, throwing a
 * clear error instead of silently sending requests with an empty account ID
 * and empty bearer token when Cloudflare isn't configured yet (which is the
 * real state of this repo until a Cloudflare account is set up). Both the
 * upload-start action and the webhook handler should call this rather than
 * constructing the config inline, so there is exactly one place that decides
 * what "not configured" means.
 */
export function getCloudflareConfig(): CloudflareStreamConfig {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error(
      "Cloudflare Stream is not configured: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN",
    );
  }

  return { accountId, apiToken };
}

export interface DirectUploadResult {
  uid: string;
  uploadURL: string;
}

export interface VideoDetails {
  uid: string;
  state:
    | "pendingupload"
    | "downloading"
    | "queued"
    | "inprogress"
    | "ready"
    | "error";
  readyToStream: boolean;
  duration: number | null;
  thumbnail: string | null;
  meta: Record<string, string>;
  playback: { hls: string | null; dash: string | null };
}

interface CloudflareApiResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: T;
}

function throwOnCloudflareErrors(
  response: CloudflareApiResponse<unknown>,
): void {
  if (!response.success) {
    throw new Error(
      response.errors.map((e) => e.message).join(", ") ||
        "Cloudflare Stream API request failed",
    );
  }
}

export async function createDirectUploadUrl(
  config: CloudflareStreamConfig,
  maxDurationSeconds: number,
  meta: Record<string, string>,
): Promise<DirectUploadResult> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/stream/direct_upload`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maxDurationSeconds, meta }),
    },
  );

  const json = (await response.json()) as CloudflareApiResponse<{
    uid: string;
    uploadURL: string;
  }>;
  throwOnCloudflareErrors(json);

  return { uid: json.result.uid, uploadURL: json.result.uploadURL };
}

export async function getVideoDetails(
  config: CloudflareStreamConfig,
  uid: string,
): Promise<VideoDetails> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/stream/${uid}`,
    {
      headers: { Authorization: `Bearer ${config.apiToken}` },
    },
  );

  const json = (await response.json()) as CloudflareApiResponse<{
    uid: string;
    status: { state: VideoDetails["state"] };
    readyToStream: boolean;
    duration: number;
    thumbnail: string;
    meta: Record<string, string>;
    playback?: { hls?: string; dash?: string };
  }>;
  throwOnCloudflareErrors(json);

  return {
    uid: json.result.uid,
    state: json.result.status.state,
    readyToStream: json.result.readyToStream,
    duration: json.result.duration >= 0 ? json.result.duration : null,
    thumbnail: json.result.thumbnail ?? null,
    meta: json.result.meta ?? {},
    playback: {
      hls: json.result.playback?.hls ?? null,
      dash: json.result.playback?.dash ?? null,
    },
  };
}

// A valid signature over an old `time` would otherwise verify forever —
// anyone who captures one signed payload (e.g. from logs, a proxy, or a
// browser network panel) could replay it indefinitely. 5 minutes comfortably
// covers normal delivery/retry latency without leaving a long replay window.
const WEBHOOK_MAX_AGE_SECONDS = 300;

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const parts: Record<string, string> = {};
  for (const pair of signatureHeader.split(",")) {
    const [key, value] = pair.split("=");
    if (key && value) parts[key] = value;
  }

  const time = parts.time;
  const signature = parts.sig1;
  if (!time || !signature) return false;

  const expected = createHmac("sha256", secret)
    .update(`${time}.${rawBody}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== actualBuffer.length) return false;

  if (!timingSafeEqual(expectedBuffer, actualBuffer)) return false;

  const timeSeconds = Number(time);
  if (!Number.isFinite(timeSeconds)) return false;
  return Math.abs(nowSeconds - timeSeconds) <= WEBHOOK_MAX_AGE_SECONDS;
}
