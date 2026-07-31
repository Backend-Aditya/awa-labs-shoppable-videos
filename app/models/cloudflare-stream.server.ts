import { createHmac, timingSafeEqual } from "node:crypto";

export interface CloudflareStreamConfig {
  accountId: string;
  apiToken: string;
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
  }>;
  throwOnCloudflareErrors(json);

  return {
    uid: json.result.uid,
    state: json.result.status.state,
    readyToStream: json.result.readyToStream,
    duration: json.result.duration ?? null,
    thumbnail: json.result.thumbnail ?? null,
    meta: json.result.meta ?? {},
  };
}

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
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

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
