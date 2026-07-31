# Video Ingestion (Cloudflare Stream) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a merchant upload a real video file from the Reels library and have it land, transcoded, in Cloudflare Stream — populating the `cloudflareStreamUid`/`posterUrl`/`durationSeconds` fields on the reel's `config` that have been empty placeholders since the Admin UI plan.

**Architecture:** Cloudflare Stream's direct-creator-upload flow: the server asks Cloudflare for a one-time `uploadURL` (tagging it with `{ reelId, shop }` metadata), the browser uploads the file straight to Cloudflare (never touching our server), and Cloudflare calls back a webhook once transcoding finishes. The webhook is the one place in this app that talks to the Shopify Admin API without an inbound authenticated request — it resolves an offline-token admin client via `unauthenticated.admin(shop)` using the shop domain carried in Cloudflare's echoed metadata.

**Tech Stack:** Cloudflare Stream REST API (verified directly against developers.cloudflare.com and the Cloudflare API reference during planning — endpoints/shapes below are not guesses), Node's built-in `fetch` and `node:crypto`, `unauthenticated.admin(shop)` from `@shopify/shopify-app-react-router` (verified against the installed package's own type definitions).

## Global Constraints

- No live Cloudflare credentials are available in development right now — Tasks 1-2 must be fully unit-testable against a stubbed `fetch`, with zero live network calls. Tasks 3-4 cannot be smoke-tested at all until a real Cloudflare account exists; ship them correctly-shaped per the verified API contracts below, but do not claim they've been exercised end-to-end.
- Cloudflare Stream API base: `https://api.cloudflare.com/client/v4/accounts/{account_id}/stream`. Auth header: `Authorization: Bearer <api_token>`.
- Direct upload creation: `POST /accounts/{account_id}/stream/direct_upload`, body `{ maxDurationSeconds, meta }` (`meta` is a free-form string-keyed object — confirmed via the Cloudflare API reference), response `{ success, errors, messages, result: { uid, uploadURL } }`.
- Video details: `GET /accounts/{account_id}/stream/{uid}`, response `result: { uid, status: { state }, readyToStream, duration, thumbnail, meta }`.
- Webhook signature: header `Webhook-Signature` formatted `time=<unix>,sig1=<hex>`; verify via HMAC-SHA256 of `${time}.${rawBody}` using the shared webhook secret, hex-compare with `timingSafeEqual` (confirmed against Cloudflare's webhook docs).
- Actual file upload to the returned `uploadURL`: `POST` request, `multipart/form-data`, file attached under form field name `file` (confirmed against Cloudflare's docs).
- Reel metaobject writes MUST continue to go through `upsertReel` (which uses `metaobjectUpsert`) — do not introduce a separate `metaobjectUpdate` mutation. `updateReelConfig` (Task 2) is a thin wrapper: read the current reel, merge the partial config in memory, call the existing `upsertReel`.
- `unauthenticated.admin(shop)` returns `Promise<{ admin: AdminApiContext; session: Session }>` (verified against the installed `@shopify/shopify-app-react-router` package's own `.d.ts` files) — use this in the webhook handler, never `authenticate.admin(request)` (there is no inbound Shopify-authenticated request to authenticate; Cloudflare is the caller).
- No feature work beyond what's specified: no Instagram/TikTok import (explicitly out of scope, a later plan), no upload progress bar, no retry/resume on failed uploads, no multi-file batch upload.

---

## File Structure

- `app/models/cloudflare-stream.server.ts` — create: `CloudflareStreamConfig`, `DirectUploadResult`, `VideoDetails` types; `createDirectUploadUrl`, `getVideoDetails`, `verifyWebhookSignature`.
- `app/models/cloudflare-stream.server.test.ts` — create: tests against a stubbed global `fetch`.
- `app/models/reel.server.ts` — modify: add `getReel`, `updateReelConfig`.
- `app/models/reel.server.test.ts` — modify: add tests for the two new functions.
- `app/routes/webhooks.cloudflare-stream.tsx` — create: public route, HMAC-verified, updates a reel's config when Cloudflare reports a video ready.
- `.env.example` — modify: add `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_STREAM_WEBHOOK_SECRET` placeholders.
- `app/routes/app.reels.tsx` — modify: add an "Upload a video" section (title + file picker) alongside the existing manual-create form, wired to Cloudflare's direct-upload flow.

---

### Task 1: `cloudflare-stream.server.ts` — Cloudflare Stream API wrapper

**Files:**
- Create: `app/models/cloudflare-stream.server.ts`
- Test: `app/models/cloudflare-stream.server.test.ts`

**Interfaces:**
- Produces: `interface CloudflareStreamConfig { accountId: string; apiToken: string }`, `interface DirectUploadResult { uid: string; uploadURL: string }`, `interface VideoDetails { uid: string; state: "pendingupload" | "downloading" | "queued" | "inprogress" | "ready" | "error"; readyToStream: boolean; duration: number | null; thumbnail: string | null; meta: Record<string, string> }`, `createDirectUploadUrl(config: CloudflareStreamConfig, maxDurationSeconds: number, meta: Record<string, string>): Promise<DirectUploadResult>`, `getVideoDetails(config: CloudflareStreamConfig, uid: string): Promise<VideoDetails>`, `verifyWebhookSignature(rawBody: string, signatureHeader: string, secret: string): boolean` — consumed by Task 3 (webhook route) and Task 4 (Reels library upload action).

- [ ] **Step 1: Write the failing tests**

Create `app/models/cloudflare-stream.server.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './cloudflare-stream.server'`.

- [ ] **Step 3: Write the implementation**

Create `app/models/cloudflare-stream.server.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — all 6 new tests green, existing shop/widget/reel tests unaffected.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add app/models/cloudflare-stream.server.ts app/models/cloudflare-stream.server.test.ts
git commit -m "feat(ingestion): add Cloudflare Stream API wrapper"
```

---

### Task 2: `reel.server.ts` — `getReel` and `updateReelConfig`

**Files:**
- Modify: `app/models/reel.server.ts`
- Modify: `app/models/reel.server.test.ts`

**Interfaces:**
- Produces: `getReel(admin: AdminGraphqlClient, id: string): Promise<Reel | null>`, `updateReelConfig(admin: AdminGraphqlClient, id: string, partialConfig: Partial<ReelConfig>): Promise<Reel>` — consumed by Task 3's webhook handler.
- Consumes: existing `upsertReel`, `Reel`, `ReelConfig`, `AdminGraphqlClient`, `assertNoGraphqlErrors` (already defined in this file).

- [ ] **Step 1: Write the failing tests**

Add to `app/models/reel.server.test.ts` (inside the existing `describe("reel.server", ...)` block, alongside the existing tests):

```ts
  it("fetches a single reel by ID via the metaobject query", async () => {
    let capturedQuery = "";
    let capturedVariables: Record<string, unknown> | undefined;
    const admin = {
      graphql: async (
        query: string,
        options?: { variables?: Record<string, unknown> },
      ) => {
        capturedQuery = query;
        capturedVariables = options?.variables;
        return {
          json: async () => ({
            data: {
              metaobject: {
                id: "gid://shopify/Metaobject/1",
                handle: "summer-look-1",
                title: { jsonValue: "Summer Look" },
                published: { jsonValue: false },
                config: { jsonValue: config },
              },
            },
          }),
        };
      },
    };

    const reel = await getReel(admin, "gid://shopify/Metaobject/1");

    expect(reel).toEqual({
      id: "gid://shopify/Metaobject/1",
      handle: "summer-look-1",
      title: "Summer Look",
      published: false,
      config,
    });
    expect(capturedQuery).toContain("metaobject(id: $id)");
    expect(capturedVariables).toEqual({ id: "gid://shopify/Metaobject/1" });
  });

  it("returns null from getReel when the metaobject doesn't exist", async () => {
    const admin = {
      graphql: async () => ({
        json: async () => ({ data: { metaobject: null } }),
      }),
    };

    const reel = await getReel(admin, "gid://shopify/Metaobject/999");
    expect(reel).toBeNull();
  });

  it("merges a partial config into the existing reel via updateReelConfig", async () => {
    let upsertVariables: Record<string, unknown> | undefined;
    const admin = {
      graphql: async (
        query: string,
        options?: { variables?: Record<string, unknown> },
      ) => {
        if (query.includes("metaobject(id: $id)")) {
          return {
            json: async () => ({
              data: {
                metaobject: {
                  id: "gid://shopify/Metaobject/1",
                  handle: "summer-look-1",
                  title: { jsonValue: "Summer Look" },
                  published: { jsonValue: false },
                  config: { jsonValue: config },
                },
              },
            }),
          };
        }

        // The upsertReel call underneath updateReelConfig
        upsertVariables = options?.variables;
        return {
          json: async () => ({
            data: {
              metaobjectUpsert: {
                metaobject: {
                  id: "gid://shopify/Metaobject/1",
                  handle: "summer-look-1",
                  title: { jsonValue: "Summer Look" },
                  published: { jsonValue: false },
                  config: {
                    jsonValue: {
                      ...config,
                      cloudflareStreamUid: "abc123",
                      durationSeconds: 12.5,
                    },
                  },
                },
                userErrors: [],
              },
            },
          }),
        };
      },
    };

    const updated = await updateReelConfig(admin, "gid://shopify/Metaobject/1", {
      cloudflareStreamUid: "abc123",
      durationSeconds: 12.5,
    });

    expect(updated.config).toEqual({
      ...config,
      cloudflareStreamUid: "abc123",
      durationSeconds: 12.5,
    });
    // Confirms the merge kept fields untouched by the partial update (productIds, interactions, source)
    const mergedFieldsSent = JSON.parse(
      (upsertVariables!.metaobject as { fields: Array<{ key: string; value: string }> })
        .fields.find((f) => f.key === "config")!.value,
    );
    expect(mergedFieldsSent).toEqual({
      ...config,
      cloudflareStreamUid: "abc123",
      durationSeconds: 12.5,
    });
  });

  it("throws from updateReelConfig when the reel doesn't exist", async () => {
    const admin = {
      graphql: async () => ({
        json: async () => ({ data: { metaobject: null } }),
      }),
    };

    await expect(
      updateReelConfig(admin, "gid://shopify/Metaobject/999", {
        cloudflareStreamUid: "abc123",
      }),
    ).rejects.toThrow("Reel not found");
  });
```

Update the import line at the top of `app/models/reel.server.test.ts` to include the two new functions:

```ts
import {
  generateReelHandle,
  upsertReel,
  listReels,
  deleteReel,
  getReel,
  updateReelConfig,
} from "./reel.server";
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `getReel`/`updateReelConfig` are not exported from `./reel.server`.

- [ ] **Step 3: Write the implementation**

Add to `app/models/reel.server.ts` (after the existing `listReels` function, before `deleteReel`):

```ts
export async function getReel(
  admin: AdminGraphqlClient,
  id: string,
): Promise<Reel | null> {
  const response = await admin.graphql(
    `#graphql
    query GetReel($id: ID!) {
      metaobject(id: $id) {
        id
        handle
        title: field(key: "title") { jsonValue }
        published: field(key: "published") { jsonValue }
        config: field(key: "config") { jsonValue }
      }
    }`,
    { variables: { id } },
  );

  const json = await response.json();
  assertNoGraphqlErrors(json);

  const node = json.data.metaobject;
  if (!node) return null;

  return {
    id: node.id,
    handle: node.handle,
    title: node.title.jsonValue,
    published: node.published.jsonValue,
    config: node.config.jsonValue,
  };
}

export async function updateReelConfig(
  admin: AdminGraphqlClient,
  id: string,
  partialConfig: Partial<ReelConfig>,
): Promise<Reel> {
  const existing = await getReel(admin, id);
  if (!existing) {
    throw new Error(`Reel not found: ${id}`);
  }

  const mergedConfig: ReelConfig = { ...existing.config, ...partialConfig };

  return upsertReel(
    admin,
    existing.handle,
    existing.title,
    existing.published,
    mergedConfig,
  );
}
```

Note: `assertNoGraphqlErrors` already exists in this file (added during the Admin UI plan's final-review fix round) — reuse it, don't redefine it.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — all tests across all 4 model test files green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add app/models/reel.server.ts app/models/reel.server.test.ts
git commit -m "feat(ingestion): add getReel and updateReelConfig to reel.server.ts"
```

---

### Task 3: Cloudflare Stream webhook route

**Files:**
- Create: `app/routes/webhooks.cloudflare-stream.tsx`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `verifyWebhookSignature`, `getVideoDetails` from Task 1; `updateReelConfig` from Task 2; `unauthenticated` from `app/shopify.server.ts` (already exported — do not modify that file).

- [ ] **Step 1: Add the Cloudflare env vars to `.env.example`**

Append to `.env.example`:

```
CLOUDFLARE_ACCOUNT_ID=""
CLOUDFLARE_API_TOKEN=""
CLOUDFLARE_STREAM_WEBHOOK_SECRET=""
```

- [ ] **Step 2: Create the webhook route**

Create `app/routes/webhooks.cloudflare-stream.tsx`:

```tsx
import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import {
  getVideoDetails,
  verifyWebhookSignature,
} from "../models/cloudflare-stream.server";
import { updateReelConfig } from "../models/reel.server";

interface CloudflareWebhookPayload {
  uid: string;
  status?: { state: string };
  meta?: Record<string, string>;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("Webhook-Signature");
  const secret = process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;

  if (
    !secret ||
    !signatureHeader ||
    !verifyWebhookSignature(rawBody, signatureHeader, secret)
  ) {
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody) as CloudflareWebhookPayload;
  const shop = payload.meta?.shop;
  const reelId = payload.meta?.reelId;

  if (!shop || !reelId) {
    return new Response("Missing shop/reelId metadata", { status: 400 });
  }

  if (payload.status?.state !== "ready") {
    return new Response("OK", { status: 200 });
  }

  const { admin } = await unauthenticated.admin(shop);

  const details = await getVideoDetails(
    {
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
    },
    payload.uid,
  );

  await updateReelConfig(admin, reelId, {
    cloudflareStreamUid: payload.uid,
    posterUrl: details.thumbnail ?? undefined,
    durationSeconds: details.duration ?? undefined,
  });

  return new Response("OK", { status: 200 });
};
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 4: Note on verification**

This route cannot be tested at all without a live Cloudflare account configured to actually send webhooks (there's no local way to simulate a real Cloudflare-signed request meaningfully beyond what Task 1's unit tests already cover for the signature-verification logic in isolation). Do not attempt to run this end-to-end — typecheck passing is the only available gate here. Note this plainly in your report.

- [ ] **Step 5: Commit**

```bash
git add app/routes/webhooks.cloudflare-stream.tsx .env.example
git commit -m "feat(ingestion): add Cloudflare Stream webhook handler"
```

---

### Task 4: Reels library — upload a video

**Files:**
- Modify: `app/routes/app.reels.tsx`

**Interfaces:**
- Consumes: `createDirectUploadUrl` from Task 1; `getOrCreateShop` is NOT needed here (reels are metaobject-backed, not Prisma-backed — `session.shop` is passed straight through as Cloudflare webhook metadata, not resolved to a Prisma `Shop.id`). `generateReelHandle`, `upsertReel` (existing, from the Admin UI plan).

- [ ] **Step 1: Add an `intent`-based branch to the existing action**

Replace the existing `action` in `app/routes/app.reels.tsx` with:

```tsx
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "start-upload") {
    const title = String(formData.get("uploadTitle") ?? "").trim();
    if (!title) {
      return { error: "Title is required", uploadURL: null };
    }

    const reel = await upsertReel(admin, generateReelHandle(title), title, false, {
      productIds: [],
      interactions: {},
      source: { type: "upload" },
    });

    const { uploadURL } = await createDirectUploadUrl(
      {
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
        apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
      },
      3600,
      { reelId: reel.id, shop: session.shop },
    );

    return { error: null, uploadURL };
  }

  const title = String(formData.get("title") ?? "").trim();
  const published = formData.get("published") != null;

  if (!title) {
    return { error: "Title is required", uploadURL: null };
  }

  await upsertReel(admin, generateReelHandle(title), title, published, {
    productIds: [],
    interactions: {},
    source: { type: "upload" },
  });

  return { error: null, uploadURL: null };
};
```

Note this changes the existing manual-create action's return shape — it now always includes `uploadURL: null` alongside `error`, so `useActionData`'s type stays consistent across both branches. Update the import at the top of the file to add `createDirectUploadUrl`:

```tsx
import { createDirectUploadUrl } from "../models/cloudflare-stream.server";
```

- [ ] **Step 2: Add the upload form to the component**

Add a new section to the `ReelsLibrary` component, between the existing "Create a reel" section and the "All reels" section. Also add the `useEffect`/`useState`/`useFetcher` imports needed:

```tsx
import { useEffect, useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
```

Add this section in the JSX, and this component function above `ReelsLibrary`'s return statement (or as a separate function in the same file — either is fine, keep it simple):

```tsx
function UploadVideoForm() {
  const fetcher = useFetcher<typeof action>();
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "done" | "error"
  >("idle");

  useEffect(() => {
    if (fetcher.data?.uploadURL && file) {
      setUploadStatus("uploading");
      const body = new FormData();
      body.append("file", file);
      fetch(fetcher.data.uploadURL, { method: "POST", body })
        .then((res) => {
          setUploadStatus(res.ok ? "done" : "error");
        })
        .catch(() => setUploadStatus("error"));
    }
  }, [fetcher.data, file]);

  return (
    <s-section heading="Upload a video">
      <fetcher.Form
        method="post"
        onSubmit={() => setUploadStatus("idle")}
      >
        <input type="hidden" name="intent" value="start-upload" />
        <s-stack gap="base">
          {fetcher.data?.error && (
            <s-paragraph tone="critical">{fetcher.data.error}</s-paragraph>
          )}
          <s-text-field label="Title" name="uploadTitle" required></s-text-field>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <s-button type="submit" variant="primary">
            Start upload
          </s-button>
          {uploadStatus === "uploading" && (
            <s-paragraph>Uploading to Cloudflare…</s-paragraph>
          )}
          {uploadStatus === "done" && (
            <s-paragraph tone="success">
              Upload complete — processing will finish shortly.
            </s-paragraph>
          )}
          {uploadStatus === "error" && (
            <s-paragraph tone="critical">Upload failed. Try again.</s-paragraph>
          )}
        </s-stack>
      </fetcher.Form>
    </s-section>
  );
}
```

Then render `<UploadVideoForm />` inside `ReelsLibrary`'s returned JSX, directly after the existing "Create a reel" `<s-section>` and before the "All reels" `<s-section>`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 4: Note on verification**

This cannot be smoke-tested without a real Cloudflare Stream account and API token — the human has explicitly accepted this risk (see the plan's Global Constraints). Do not attempt `npm run dev` for this specifically beyond what's already been validated for this route in the Admin UI plan; typecheck is the only available gate. State this plainly in your report — do not imply this was verified working when it wasn't.

- [ ] **Step 5: Commit**

```bash
git add app/routes/app.reels.tsx
git commit -m "feat(ingestion): add video upload flow to Reels library"
```

---

## Self-Review

**Spec coverage:** Cloudflare Stream API wrapper (create upload URL, get video details, verify webhook signature) ✓ Task 1, fully unit-tested against a stubbed fetch per the Global Constraints. Reel config partial-update capability (the thing the final review on the Admin UI plan specifically recommended: "relax upsertReel's signature to accept a partial field set") ✓ Task 2, implemented as a thin merge-then-upsert wrapper rather than a new unverified mutation. Webhook handler resolving shop identity from Cloudflare's echoed metadata via `unauthenticated.admin` ✓ Task 3. Upload UI wired into the existing Reels library page ✓ Task 4. Instagram/TikTok import explicitly out of scope per Global Constraints, not silently dropped.

**Placeholder scan:** none. The two "cannot verify live" notes (Tasks 3 and 4) are explicit, human-approved, disclosed limitations — not stand-ins for missing work; the code itself is complete and shaped against verified API contracts, not guessed ones.

**Type consistency:** `DirectUploadResult`/`VideoDetails` (Task 1) match exactly between `cloudflare-stream.server.ts` and its test file. `getReel`/`updateReelConfig` (Task 2) reuse `Reel`/`ReelConfig`/`AdminGraphqlClient` from the existing file rather than redefining them. Task 3's webhook payload shape (`uid`, `status.state`, `meta.shop`, `meta.reelId`) matches exactly what Task 4's action sends as `meta` when creating the upload (`{ reelId: reel.id, shop: session.shop }`) — this correlation is the crux of the whole flow and both sides were written to agree on the same two key names.
