import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  createDirectUploadUrl,
  getVideoDetails,
  verifyWebhookSignature,
} from "./cloudflare-stream.server";

const config = { accountId: "acct123", apiToken: "token123" };

describe("cloudflare-stream.server", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a direct upload URL, sending meta and the auth header correctly", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        "https://api.cloudflare.com/client/v4/accounts/acct123/stream/direct_upload",
      );
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer token123",
      );
      expect(JSON.parse(init!.body as string)).toEqual({
        maxDurationSeconds: 3600,
        meta: { reelId: "gid://shopify/Metaobject/1" },
      });
      return {
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            uid: "abc123",
            uploadURL: "https://upload.videodelivery.net/abc123",
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createDirectUploadUrl(config, 3600, {
      reelId: "gid://shopify/Metaobject/1",
    });

    expect(result).toEqual({
      uid: "abc123",
      uploadURL: "https://upload.videodelivery.net/abc123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws with Cloudflare's error message when the API reports failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          success: false,
          errors: [{ code: 10000, message: "Invalid API token" }],
          messages: [],
          result: null,
        }),
      })),
    );

    await expect(createDirectUploadUrl(config, 3600, {})).rejects.toThrow(
      "Invalid API token",
    );
  });

  it("fetches video details and normalizes the response shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(
          "https://api.cloudflare.com/client/v4/accounts/acct123/stream/abc123",
        );
        return {
          json: async () => ({
            success: true,
            errors: [],
            messages: [],
            result: {
              uid: "abc123",
              status: { state: "ready" },
              readyToStream: true,
              duration: 12.5,
              thumbnail: "https://videodelivery.net/abc123/thumbnails/thumbnail.jpg",
              meta: { reelId: "gid://shopify/Metaobject/1" },
            },
          }),
        };
      }),
    );

    const details = await getVideoDetails(config, "abc123");
    expect(details).toEqual({
      uid: "abc123",
      state: "ready",
      readyToStream: true,
      duration: 12.5,
      thumbnail: "https://videodelivery.net/abc123/thumbnails/thumbnail.jpg",
      meta: { reelId: "gid://shopify/Metaobject/1" },
    });
  });

  it("verifies a correctly-signed webhook payload", () => {
    const secret = "whsec_test";
    const rawBody = JSON.stringify({ uid: "abc123" });
    const time = "1700000000";
    const signature = createHmac("sha256", secret)
      .update(`${time}.${rawBody}`)
      .digest("hex");

    const valid = verifyWebhookSignature(
      rawBody,
      `time=${time},sig1=${signature}`,
      secret,
    );
    expect(valid).toBe(true);
  });

  it("rejects a webhook payload whose body doesn't match the signature", () => {
    const secret = "whsec_test";
    const time = "1700000000";
    const signature = createHmac("sha256", secret)
      .update(`${time}.${JSON.stringify({ uid: "abc123" })}`)
      .digest("hex");

    const valid = verifyWebhookSignature(
      JSON.stringify({ uid: "tampered" }),
      `time=${time},sig1=${signature}`,
      secret,
    );
    expect(valid).toBe(false);
  });

  it("rejects a malformed signature header instead of throwing", () => {
    const valid = verifyWebhookSignature("{}", "garbage-header", "secret");
    expect(valid).toBe(false);
  });
});
