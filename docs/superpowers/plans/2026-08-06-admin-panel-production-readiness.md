# Admin Panel Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Reels admin surface production-usable: a merchant can tag a reel to product(s), see its real status at a glance, edit or delete any reel, and recover from a failed/stuck upload — closing the four gaps found in the production-readiness review (no product tagging, no status visibility, no edit/delete, unrecoverable stuck uploads).

**Architecture:** Extend the existing metaobject-backed `reel.server.ts` model with a derived status helper and a products-by-id lookup, add a Status column + row links to the existing Reels list, and add a new `/app/reels/$id` detail route that owns editing, product tagging (via Shopify's native App Bridge `ResourcePicker`), and delete. No new persisted field except one optional `uploadFailedAt` timestamp in `ReelConfig`, used to make a failed browser-side upload durable/visible instead of vanishing on refresh.

**Tech Stack:** React Router file routes (existing convention), Polaris web components (`s-*`, no import needed, matches existing routes), `@shopify/app-bridge-react`'s `useAppBridge` hook + `shopify.resourcePicker()` (already a project dependency, not yet used anywhere in this codebase), Shopify Admin GraphQL via `authenticate.admin(request)`, Vitest (existing infra).

## Global Constraints

- **No new Shopify scopes.** `write_products` (already granted in `shopify.app.toml`) implies read access for the Admin GraphQL product queries and the App Bridge resource picker's product search — do not add `read_products` as a separate scope line.
- **Status is derived, never stored**, except the one new field below. Do not add a stored `status` string field to `ReelConfig` — computing it from existing fields (`cloudflareStreamUid`, `hlsManifestUrl`, `uploadFailedAt`) is required so the value can never drift out of sync with the data it's derived from.
- **New field:** `ReelConfig.uploadFailedAt?: string` (ISO 8601 timestamp string, e.g. `new Date().toISOString()`) — the only new persisted field in this plan.
- **Status derivation logic (exact, used by both the list and detail page — implement once, import everywhere):**
  ```
  if (config.hlsManifestUrl) return "ready";
  if (config.cloudflareStreamUid) return "processing";
  if (config.uploadFailedAt) return "failed";
  if (config.cloudflareStreamUid === undefined && /* upload was ever started */) return "uploading";
  return "draft";
  ```
  Concretely (see Task 1 for the exact implementation): a reel with no `cloudflareStreamUid`, no `uploadFailedAt`, and created via the "Create a reel" manual form (not the upload form) is `draft`. Distinguishing `draft` from `uploading` requires knowing whether an upload was ever *attempted* — the manual "Create a reel" form and the "Upload a video" form both create a reel via `upsertReel` with the same shape, so this plan does NOT attempt to distinguish "manually created, no video" from "upload started, still in flight" at the model layer (there is no field recording "upload was attempted"). Both render as `draft` until either `cloudflareStreamUid` (→ `processing`) or `uploadFailedAt` (→ `failed`) appears. This is a deliberate simplification: the existing upload form already shows its own live "Uploading…" state client-side (`app.reels.tsx`'s `uploadStatus` state) while the browser tab is open, so the list-page `Uploading` status described in the design doc's status table is **collapsed into `Draft`** for this plan — re-litigated only if a future plan adds a stored "upload attempted" marker. State this plainly in each task's report; it is a scope reduction from the design doc, not an oversight, made because it avoids adding a second new field to track a state the client already surfaces live.
- **`ResourcePicker` API shape (from `@shopify/app-bridge-react` v4, matching the already-installed `^4.2.4`):** `const shopify = useAppBridge();` then `const selected = await shopify.resourcePicker({ type: "product", multiple: true, selectionIds: initialIds.map((id) => ({ id })) });` — resolves to `Array<{ id: string; title: string; handle: string }> | undefined` (`undefined` if the merchant cancels). This has not been exercised against a live store in this environment (same category of limitation as prior plans' Shopify-CLI-dependent steps) — ship it correctly-shaped per the documented v4 contract, and say so plainly in the task report rather than claiming live verification.
- **No feature work beyond spec:** no pagination changes, no widget edit/delete (explicitly deferred), no Settings page changes, no resumable/chunked upload, no upload progress percentage, no custom delete-confirmation modal (native `confirm()` only).
- **Delete confirmation:** always `if (!confirm("Delete this reel? This can't be undone.")) return;` before calling the delete action — exact copy, used consistently.

---

## File Structure

- `app/models/reel.server.ts` — modify: add `uploadFailedAt?: string` to `ReelConfig`, add `deriveReelStatus(config: ReelConfig): ReelStatus` and `getProductsByIds(admin, ids: string[])`.
- `app/models/reel.server.test.ts` — modify: tests for `deriveReelStatus` and `getProductsByIds`.
- `app/routes/app.reels.tsx` — modify: add Status column, make rows link to `/app/reels/$id`, persist `uploadFailedAt` on upload failure.
- `app/routes/app.reels.$id.tsx` — create: reel detail page (edit title/published, status badge, tagged-products list + picker, delete).
- `app/routes/app.reels.$id.test.tsx` — not created (see Testing note in Global Constraints / plan header: this project tests `.server.ts` files, not routes; route-level testing infra is a separate, larger gap not solved by this plan).

---

### Task 1: Status derivation helper + `uploadFailedAt` field

**Files:**
- Modify: `app/models/reel.server.ts`
- Modify: `app/models/reel.server.test.ts`

**Interfaces:**
- Produces: `ReelConfig.uploadFailedAt?: string`, `type ReelStatus = "draft" | "processing" | "failed" | "ready"`, `deriveReelStatus(config: ReelConfig): ReelStatus` — both exported, consumed by Task 3 (list page) and Task 4 (detail page).

- [ ] **Step 1: Write the failing tests**

Add to `app/models/reel.server.test.ts`, inside the existing `describe("reel.server", ...)` block (add a nested `describe`):

```ts
describe("deriveReelStatus", () => {
  const base: ReelConfig = {
    productIds: [],
    interactions: {},
    source: { type: "upload" },
  };

  it("returns ready when hlsManifestUrl is present", () => {
    expect(
      deriveReelStatus({ ...base, cloudflareStreamUid: "abc", hlsManifestUrl: "https://x/y.m3u8" }),
    ).toBe("ready");
  });

  it("returns processing when cloudflareStreamUid is present but hlsManifestUrl is not", () => {
    expect(deriveReelStatus({ ...base, cloudflareStreamUid: "abc" })).toBe("processing");
  });

  it("returns failed when uploadFailedAt is present and no cloudflareStreamUid", () => {
    expect(deriveReelStatus({ ...base, uploadFailedAt: "2026-08-06T00:00:00.000Z" })).toBe(
      "failed",
    );
  });

  it("returns draft when nothing has happened yet", () => {
    expect(deriveReelStatus(base)).toBe("draft");
  });

  it("prefers ready over a stale failed/processing marker if hlsManifestUrl is set", () => {
    expect(
      deriveReelStatus({
        ...base,
        uploadFailedAt: "2026-08-06T00:00:00.000Z",
        cloudflareStreamUid: "abc",
        hlsManifestUrl: "https://x/y.m3u8",
      }),
    ).toBe("ready");
  });
});

describe("getProductsByIds", () => {
  it("fetches product titles for the given IDs", async () => {
    let capturedVariables: Record<string, unknown> | undefined;
    const admin = {
      graphql: async (
        _query: string,
        options?: { variables?: Record<string, unknown> },
      ) => {
        capturedVariables = options?.variables;
        return {
          json: async () => ({
            data: {
              nodes: [
                { id: "gid://shopify/Product/1", title: "Blue Shirt", handle: "blue-shirt" },
                null,
              ],
            },
          }),
        };
      },
    };

    const products = await getProductsByIds(admin, [
      "gid://shopify/Product/1",
      "gid://shopify/Product/999",
    ]);

    expect(products).toEqual([
      { id: "gid://shopify/Product/1", title: "Blue Shirt", handle: "blue-shirt" },
    ]);
    expect(capturedVariables).toEqual({
      ids: ["gid://shopify/Product/1", "gid://shopify/Product/999"],
    });
  });

  it("returns an empty array without a network call when ids is empty", async () => {
    let called = false;
    const admin = {
      graphql: async () => {
        called = true;
        return { json: async () => ({ data: { nodes: [] } }) };
      },
    };

    const products = await getProductsByIds(admin, []);
    expect(products).toEqual([]);
    expect(called).toBe(false);
  });
});
```

Add the new imports at the top of the test file:

```ts
import {
  generateReelHandle,
  upsertReel,
  listReels,
  deleteReel,
  getReel,
  updateReelConfig,
  deriveReelStatus,
  getProductsByIds,
} from "./reel.server";
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `deriveReelStatus`/`getProductsByIds` are not exported yet.

- [ ] **Step 3: Write the implementation**

In `app/models/reel.server.ts`, update `ReelConfig`:

```ts
export interface ReelConfig {
  cloudflareStreamUid?: string;
  posterUrl?: string;
  durationSeconds?: number;
  hlsManifestUrl?: string;
  dashManifestUrl?: string;
  uploadFailedAt?: string;
  productIds: string[];
  interactions: { ctaLabel?: string; ctaUrl?: string };
  source: { type: "upload" | "instagram" | "tiktok"; originalUrl?: string };
}
```

Add near the bottom of the file (after `deleteReel`):

```ts
export type ReelStatus = "draft" | "processing" | "failed" | "ready";

export function deriveReelStatus(config: ReelConfig): ReelStatus {
  if (config.hlsManifestUrl) return "ready";
  if (config.cloudflareStreamUid) return "processing";
  if (config.uploadFailedAt) return "failed";
  return "draft";
}

export interface ProductSummary {
  id: string;
  title: string;
  handle: string;
}

export async function getProductsByIds(
  admin: AdminGraphqlClient,
  ids: string[],
): Promise<ProductSummary[]> {
  if (ids.length === 0) return [];

  const response = await admin.graphql(
    `#graphql
    query GetProductsByIds($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          handle
        }
      }
    }`,
    { variables: { ids } },
  );

  const json = await response.json();
  assertNoGraphqlErrors(json);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL response shape varies per query; this is the external Admin API boundary
  return json.data.nodes.filter((node: any) => node != null);
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — all tests across all model test files green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add app/models/reel.server.ts app/models/reel.server.test.ts
git commit -m "feat(admin): add reel status derivation and product-lookup helpers"
```

---

### Task 2: Reels list — Status column, row links to detail page

**Files:**
- Modify: `app/routes/app.reels.tsx`

**Interfaces:**
- Consumes: `deriveReelStatus` (Task 1), `Reel` type (existing, unmodified).

- [ ] **Step 1: Add the Status column and row links**

In `app/routes/app.reels.tsx`, add the import:

```ts
import { deleteReel, deriveReelStatus, generateReelHandle, listReels, upsertReel } from "../models/reel.server";
```

Replace the `<s-table>` block inside `ReelsLibrary` (the one rendering `reels.map(...)`) with:

```tsx
<s-table variant="list">
  <s-table-header-row>
    <s-table-header listSlot="primary">Title</s-table-header>
    <s-table-header listSlot="inline">Published</s-table-header>
    <s-table-header listSlot="inline">Status</s-table-header>
  </s-table-header-row>
  <s-table-body>
    {reels.map((reel) => {
      const status = deriveReelStatus(reel.config);
      const statusTone =
        status === "ready"
          ? "success"
          : status === "failed"
            ? "critical"
            : status === "processing"
              ? "info"
              : "neutral";
      return (
        <s-table-row key={reel.id}>
          <s-table-cell>
            <s-link href={`/app/reels/${encodeURIComponent(reel.id)}`}>
              {reel.title}
            </s-link>
          </s-table-cell>
          <s-table-cell>
            <s-badge tone={reel.published ? "success" : "neutral"}>
              {reel.published ? "Published" : "Draft"}
            </s-badge>
          </s-table-cell>
          <s-table-cell>
            <s-badge tone={statusTone}>{status}</s-badge>
          </s-table-cell>
        </s-table-row>
      );
    })}
  </s-table-body>
</s-table>
```

Note: this replaces the previous two-column header row (`Title`, `Status` where "Status" meant Published/Draft) with three columns (`Title`, `Published`, `Status` meaning the new derived upload/processing/ready state) — the old single "Status" column was actually showing Published/Draft, which this task renames to "Published" to make room for the real status column and avoid two columns both claiming to be "Status".

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors — `s-link` and `s-badge` are existing Polaris web components already used elsewhere in this file and `app.settings.tsx`/`app._index.tsx`, no new component types needed.

- [ ] **Step 3: Run the full test suite as a sanity check**

Run: `npm test`
Expected: PASS — this task has no new test file (route-level testing is out of scope per Global Constraints), confirm nothing else broke.

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.reels.tsx
git commit -m "feat(admin): add status column and detail-page links to reels list"
```

---

### Task 3: Reel detail page — view/edit title, published, delete

**Files:**
- Create: `app/routes/app.reels.$id.tsx`

**Interfaces:**
- Consumes: `getReel`, `upsertReel`, `deleteReel` (existing, unmodified), `deriveReelStatus` (Task 1).
- Produces: route `/app/reels/:id` — later extended by Task 4 (product tagging) in the same file.

- [ ] **Step 1: Create the detail route**

Create `app/routes/app.reels.$id.tsx`:

```tsx
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { deleteReel, deriveReelStatus, getReel, upsertReel } from "../models/reel.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const reel = await getReel(admin, params.id!);
  if (!reel) {
    throw new Response("Reel not found", { status: 404 });
  }
  return { reel };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const reel = await getReel(admin, params.id!);
  if (!reel) {
    throw new Response("Reel not found", { status: 404 });
  }

  if (intent === "delete") {
    await deleteReel(admin, reel.id);
    return redirect("/app/reels");
  }

  const title = String(formData.get("title") ?? "").trim();
  const published = formData.get("published") != null;

  if (!title) {
    return { error: "Title is required" };
  }

  await upsertReel(admin, reel.handle, title, published, reel.config);
  return { error: null };
};

export default function ReelDetail() {
  const { reel } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const status = deriveReelStatus(reel.config);
  const statusTone =
    status === "ready"
      ? "success"
      : status === "failed"
        ? "critical"
        : status === "processing"
          ? "info"
          : "neutral";

  return (
    <s-page heading={reel.title} backAction={{ href: "/app/reels" }}>
      <s-section heading="Details">
        <s-stack gap="base">
          <s-paragraph>
            Status: <s-badge tone={statusTone}>{status}</s-badge>
          </s-paragraph>
          <Form method="post">
            <s-stack gap="base">
              <s-text-field
                label="Title"
                name="title"
                defaultValue={reel.title}
                required
              ></s-text-field>
              <s-checkbox
                label="Published"
                name="published"
                defaultChecked={reel.published}
              ></s-checkbox>
              <s-button
                type="submit"
                variant="primary"
                {...(isSubmitting ? { loading: true } : {})}
              >
                Save
              </s-button>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>
      <s-section heading="Danger zone">
        <Form
          method="post"
          onSubmit={(e) => {
            if (!confirm("Delete this reel? This can't be undone.")) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <s-button type="submit" variant="secondary" tone="critical">
            Delete reel
          </s-button>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

Note: this task deliberately does not yet render tagged products or the product picker — that's Task 4, on top of this file, so this task's diff stays reviewable as "detail page exists, edits title/published, deletes" before product tagging lands.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes. `s-page`'s `backAction` prop and `s-button`'s `tone` prop are part of the existing Polaris web component set already used in this project (`app.tsx` uses `s-app-nav`/`s-link`; `app.reels.tsx` uses `s-badge`/`tone`) — if `backAction` or `tone` on `s-button` produce a type error, use the plain form instead: `<s-page heading={reel.title}>` (drop `backAction`, add an `<s-link href="/app/reels">Back to reels</s-link>` inside the page instead) and drop `tone="critical"` from the delete button (keep `variant="secondary"` only) — note in your report which form you used.

- [ ] **Step 3: Run the full test suite as a sanity check**

Run: `npm test`
Expected: PASS — this task has no new test file (route-level testing out of scope), confirm nothing else broke.

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.reels.\$id.tsx
git commit -m "feat(admin): add reel detail page with edit and delete"
```

---

### Task 4: Product tagging via ResourcePicker

**Files:**
- Modify: `app/routes/app.reels.$id.tsx`

**Interfaces:**
- Consumes: `getProductsByIds` (Task 1), `updateReelConfig` (existing, unmodified), `useAppBridge` from `@shopify/app-bridge-react`.

- [ ] **Step 1: Extend the loader to fetch tagged product summaries**

In `app/routes/app.reels.$id.tsx`, update the loader:

```ts
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const reel = await getReel(admin, params.id!);
  if (!reel) {
    throw new Response("Reel not found", { status: 404 });
  }
  const taggedProducts = await getProductsByIds(admin, reel.config.productIds);
  return { reel, taggedProducts };
};
```

Add the import:

```ts
import { deleteReel, deriveReelStatus, getProductsByIds, getReel, updateReelConfig, upsertReel } from "../models/reel.server";
```

- [ ] **Step 2: Add a "set-products" action branch**

In the `action` function, add a new `intent` branch above the `delete` branch:

```ts
  if (intent === "set-products") {
    const productIds = formData.getAll("productId").map(String);
    await updateReelConfig(admin, reel.id, { productIds });
    return { error: null };
  }

  if (intent === "delete") {
```

- [ ] **Step 3: Add the picker UI**

In the default export, add the App Bridge hook and a new section. Update the imports:

```ts
import { useAppBridge } from "@shopify/app-bridge-react";
import { useFetcher } from "react-router";
```

(add these alongside the existing `react-router` import — merge into the existing `import { Form, redirect, useLoaderData, useNavigation } from "react-router";` line, adding `useFetcher`)

Inside `ReelDetail`, before the `return`:

```tsx
  const { taggedProducts } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const productsFetcher = useFetcher();

  const handlePickProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: taggedProducts.map((p) => ({ id: p.id })),
    });
    if (!selected) return;

    const formData = new FormData();
    formData.set("intent", "set-products");
    for (const product of selected) {
      formData.append("productId", product.id);
    }
    productsFetcher.submit(formData, { method: "post" });
  };
```

(Note: `useLoaderData<typeof loader>()` is already called once at the top of the component for `reel` — merge into a single destructure: `const { reel, taggedProducts } = useLoaderData<typeof loader>();`, do not call the hook twice.)

Add a new section in the JSX, between the "Details" section and the "Danger zone" section:

```tsx
      <s-section heading="Tagged products">
        <s-stack gap="base">
          {taggedProducts.length === 0 ? (
            <s-paragraph>No products tagged yet.</s-paragraph>
          ) : (
            <s-stack gap="tight">
              {taggedProducts.map((product) => (
                <s-paragraph key={product.id}>{product.title}</s-paragraph>
              ))}
            </s-stack>
          )}
          <s-button
            onClick={handlePickProducts}
            {...(productsFetcher.state !== "idle" ? { loading: true } : {})}
          >
            {taggedProducts.length === 0 ? "Tag products" : "Edit tagged products"}
          </s-button>
        </s-stack>
      </s-section>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes. If `shopify.resourcePicker` is not recognized on the type returned by `useAppBridge()`, this means the installed `@shopify/app-bridge-react@^4.2.4` types don't expose it directly on the hook's return type in this version — check `node_modules/@shopify/app-bridge-react/build/ts/*.d.ts` for the actual exposed shape (it may require `useAppBridge().resourcePicker` vs a separate export) and adjust the call site to match what's actually exported, keeping the same request/response shape described in Global Constraints. Note in your report which shape you found and used.

- [ ] **Step 5: Add a model-layer test confirming `productIds` round-trips through `updateReelConfig`**

This is already covered by the existing `updateReelConfig` test in `reel.server.test.ts` (Task 1's file, unmodified by this task) which asserts a partial-merge with `cloudflareStreamUid`/`durationSeconds` — `productIds` merges through the identical code path (`{ ...existing.config, ...definedUpdates }`), so no new model test is needed for this task. Confirm this by re-reading `updateReelConfig`'s implementation in `reel.server.ts` before proceeding — if the merge logic differs for array fields in a way that isn't a plain overwrite, stop and report NEEDS_CONTEXT rather than assuming.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — no new tests added this task (per Step 5's reasoning), confirm nothing broke.

- [ ] **Step 7: Note on verification**

The `ResourcePicker` call cannot be exercised in this environment (no live Shopify admin session) — state plainly in your report that this is unverified against a live picker, consistent with this project's established pattern for Shopify-CLI/live-session-dependent work.

- [ ] **Step 8: Commit**

```bash
git add app/routes/app.reels.\$id.tsx
git commit -m "feat(admin): add product tagging via App Bridge resource picker"
```

---

### Task 5: Persist upload failures so stuck uploads are visible and deletable

**Files:**
- Modify: `app/routes/app.reels.tsx`

**Interfaces:**
- Consumes: `updateReelConfig` (existing, unmodified).

- [ ] **Step 1: Add a persist-failure action branch**

In `app/routes/app.reels.tsx`, add the import:

```ts
import { createDirectUploadUrl, getCloudflareConfig } from "../models/cloudflare-stream.server";
import { deleteReel, deriveReelStatus, generateReelHandle, listReels, updateReelConfig, upsertReel } from "../models/reel.server";
```

(merges `updateReelConfig` into the existing `reel.server` import line)

Add a new intent branch in the `action` function, above the `start-upload` branch:

```ts
  if (intent === "mark-upload-failed") {
    const reelId = String(formData.get("reelId") ?? "");
    if (!reelId) {
      return { error: "Missing reel id", uploadURL: null };
    }
    await updateReelConfig(admin, reelId, {
      uploadFailedAt: new Date().toISOString(),
    });
    return { error: null, uploadURL: null };
  }
```

- [ ] **Step 2: Wire the client-side upload-failure handler to call it**

The `start-upload` action already returns `uploadURL` but not the reel's `id` — the client needs the reel id to report failure against. Update the `start-upload` branch's success return:

```ts
      try {
        const { uploadURL } = await createDirectUploadUrl(
          getCloudflareConfig(),
          3600,
          { reelId: reel.id, shop: session.shop },
        );

        return { error: null, uploadURL, reelId: reel.id };
      } catch {
```

And the error branches' returns need the same shape (`reelId: null`) so the fetcher's data type is consistent — update both:

```ts
        return {
          error: "Could not start upload. Check Cloudflare configuration.",
          uploadURL: null,
          reelId: null,
        };
      }
    } catch (e) {
      if (e instanceof Response) throw e;
      return {
        error: "Could not create the reel. Try again.",
        uploadURL: null,
        reelId: null,
      };
    }
  }
```

Also update the plain-create branch's return and the `mark-upload-failed`/`title`-branch returns to include `reelId: null` for type consistency across the whole action's return shape:

```ts
  const title = String(formData.get("title") ?? "").trim();
  const published = formData.get("published") != null;

  if (!title) {
    return { error: "Title is required", uploadURL: null, reelId: null };
  }

  await upsertReel(admin, generateReelHandle(title), title, published, {
    productIds: [],
    interactions: {},
    source: { type: "upload" },
  });

  return { error: null, uploadURL: null, reelId: null };
```

And the `mark-upload-failed` branch and the `!reelId` guard inside `start-upload` also need `reelId: null` added to their returns — update:

```ts
  if (intent === "mark-upload-failed") {
    const reelId = String(formData.get("reelId") ?? "");
    if (!reelId) {
      return { error: "Missing reel id", uploadURL: null, reelId: null };
    }
    await updateReelConfig(admin, reelId, {
      uploadFailedAt: new Date().toISOString(),
    });
    return { error: null, uploadURL: null, reelId: null };
  }

  if (intent === "start-upload") {
    const title = String(formData.get("uploadTitle") ?? "").trim();
    if (!title) {
      return { error: "Title is required", uploadURL: null, reelId: null };
    }
```

- [ ] **Step 3: Update `UploadVideoForm` to report failure back to the server**

In `UploadVideoForm`, add a second fetcher for reporting failure (separate from the main upload `fetcher`, so its submission doesn't clobber `fetcher.data`/`uploadURL` mid-upload):

```tsx
function UploadVideoForm() {
  const fetcher = useFetcher<typeof action>();
  const failureFetcher = useFetcher();
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "done" | "error" | "no-file"
  >("idle");
  const armedRef = useRef(false);

  useEffect(() => {
    if (
      armedRef.current &&
      fetcher.state === "idle" &&
      fetcher.data?.uploadURL &&
      file
    ) {
      armedRef.current = false;
      setUploadStatus("uploading");
      const reelId = fetcher.data.reelId;
      const body = new FormData();
      body.append("file", file);
      fetch(fetcher.data.uploadURL, { method: "POST", body })
        .then((res) => {
          setUploadStatus(res.ok ? "done" : "error");
          if (!res.ok && reelId) {
            const failForm = new FormData();
            failForm.set("intent", "mark-upload-failed");
            failForm.set("reelId", reelId);
            failureFetcher.submit(failForm, { method: "post" });
          }
        })
        .catch(() => {
          setUploadStatus("error");
          if (reelId) {
            const failForm = new FormData();
            failForm.set("intent", "mark-upload-failed");
            failForm.set("reelId", reelId);
            failureFetcher.submit(failForm, { method: "post" });
          }
        });
    }
  }, [fetcher.data, file, fetcher.state, failureFetcher]);
```

(the rest of `UploadVideoForm`'s JSX is unchanged from the current file)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — no new test file for this route-level change (route testing out of scope per plan header), confirm nothing broke.

- [ ] **Step 6: Manual reasoning check (no live environment available)**

Re-read the final state of `app.reels.tsx`'s `action` function end-to-end and confirm every `return` statement has the same three keys (`error`, `uploadURL`, `reelId`) — a missing key on any branch will make `fetcher.data`'s inferred TypeScript type a union that's wrong on the branches that omit it, which `npm run typecheck` (Step 4) should already have caught, but confirm by reading, not just by the type-checker passing, since `fetcher.data?.reelId` being silently `undefined` on a branch that forgot the key would still typecheck if TypeScript widens the return type to `Partial`-like inference in this context.

- [ ] **Step 7: Commit**

```bash
git add app/routes/app.reels.tsx
git commit -m "fix(admin): persist upload failures so stuck reels are visible and deletable"
```

---

## Self-Review

**Spec coverage:** Product tagging ✓ Task 4. Status visibility ✓ Task 1 (derivation) + Task 2 (list column) + Task 3 (detail page badge). Edit/delete ✓ Task 3. Upload resilience (visible + deletable, not auto-resumed, per design doc's explicit scope) ✓ Task 5 (persist failure) + Task 3 (delete already covers "clear a stuck reel"). Widget edit/delete, pagination, Settings — explicitly out of scope per design doc, not silently dropped.

**Placeholder scan:** none. The one deliberate scope reduction (collapsing the design doc's `Uploading` status into `Draft` at the model layer) is explained inline in Global Constraints with its reasoning, not hidden.

**Type consistency:** `ReelConfig.uploadFailedAt` (Task 1) is read by `deriveReelStatus` (Task 1) and written by `updateReelConfig` (existing, called from Task 5) — same field name throughout. `ReelStatus` (Task 1) is the return type consumed identically by Task 2 (list) and Task 3 (detail) for the tone-mapping logic — copy the same ternary chain in both places rather than inventing a second mapping function, since it's a 4-line, 2-use pattern (not worth extracting per YAGNI, but MUST stay textually identical between the two — if you find yourself writing a third variant, stop and use the existing one). `ProductSummary`/`getProductsByIds` (Task 1) return type matches exactly what Task 4's loader and JSX consume (`{ id, title, handle }`). The action's return shape (`{ error, uploadURL, reelId }`) is established in Task 5 and must stay consistent across every `return` in that action — enumerated explicitly in Task 5 to prevent drift.
