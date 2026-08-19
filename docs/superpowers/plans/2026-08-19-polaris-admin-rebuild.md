# Polaris Admin Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the admin panel from the custom Tailwind design system back onto Shopify Polaris web components, keeping every UX improvement built since the original pre-Tailwind version (dashboard layout, modal-based create+upload, richer cards, sectioned detail modals).

**Architecture:** Remove the Tailwind toolchain and custom `app/components/ui/*` primitives first, then rewrite each route's markup directly onto native `<s-*>` Polaris web components — loaders/actions stay untouched throughout.

**Tech Stack:** Shopify Polaris web components (`polaris-app-home` API), React Router 7 — no new dependencies; Tailwind is removed, nothing replaces it (Polaris ships its own styling).

## Global Constraints

- No loader/action/`*.server.ts` behavior changes anywhere in this plan — markup only, same discipline as every prior redesign this session.
- Every JSX code block containing Polaris `<s-*>` components in this plan has already been validated against the live `polaris-app-home` API via `mcp__shopify-dev-mcp__validate_component_codeblocks` (not hand-typed from memory) — copy it verbatim. If you deviate from what's shown here (e.g. adding a prop not present in this plan), you must independently re-validate: call `mcp__shopify-dev-mcp__learn_shopify_api` (api: `polaris-app-home`) for your own conversation id, then `mcp__shopify-dev-mcp__validate_component_codeblocks` on your final code before committing, and fix any reported error.
- Modal open: a `<s-button command="--show" commandFor="modal-id">` (declarative, requires a real click — Shopify's own docs: modals can't be opened programmatically on load). Modal close: either `command="--hide"` on a button inside the modal, or — for auto-close after an async action completes — `shopify.modal.hide("modal-id")` via `useAppBridge()`. Every modal's `onHide` prop is what resets the corresponding React state (`selectedReelId`, `selectedWidgetId`, the create-form's local `file`/`uploadStatus`), regardless of which of the three ways (×, backdrop, ESC, or the programmatic auto-close) actually closed it — this mirrors exactly how the current custom `Modal` component's `onClose` callback already works, just wired to Polaris's own `hide` event instead.
- `<s-modal>` elements are always rendered in the tree (never conditionally mounted/unmounted) — Polaris manages its own shown/hidden state internally via the command mechanism; conditionally mounting them would break the commandFor targeting.
- Every load-bearing comment from the current code (the `armedRef` upload-race guard, the delete-form race-condition-fix comment, the `e instanceof Response` rethrow comment, the `reelNumericId` GID-slash comment) transfers verbatim into the new files.
- Per the confirmed trade-off: bespoke Tailwind visual effects with no Polaris equivalent (gradient thumbnail caption, custom SVG template icons, hover-elevate animation) are dropped in favor of Polaris's own native composition — not recreated by hand.
- No automated UI test suite exists — `npm run typecheck` / `npm run lint` / `npm run build` staying clean is the automated gate; manual click-through of every fetcher-driven action is the verification step, described per task.

---

### Task 1: Remove the Tailwind toolchain

**Files:**
- Modify: `package.json` (via `npm uninstall`)
- Modify: `vite.config.ts`
- Modify: `app/root.tsx`
- Delete: `app/tailwind.css`
- Delete: `app/components/ui/Badge.tsx`, `Button.tsx`, `Card.tsx`, `Checkbox.tsx`, `Modal.tsx`, `PageShell.tsx`, `Select.tsx`, `StatTile.tsx`, `TextField.tsx`

**Interfaces:** none — this task only removes things nothing will reference after Tasks 2-4 land. (Sequencing note: this task can safely run first because Tasks 2-4 each replace their route's imports of `app/components/ui/*` in the same commit that removes the last usage — but to keep `npm run typecheck` green at every intermediate commit, run this task LAST if executing tasks out of order. As written, this plan's task order (1 → 4) means Task 1 runs before the routes stop importing these files — see Step 5's note.)

- [ ] **Step 1: Uninstall the Tailwind packages**

```bash
npm uninstall tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Remove the Vite plugin registration**

In `vite.config.ts`, remove the import line:
```ts
import tailwindcss from "@tailwindcss/vite";
```
and remove `tailwindcss(),` from the `plugins` array, so it reads:
```ts
  plugins: [
    reactRouter(),
    tsconfigPaths(),
  ],
```
Nothing else in the file changes.

- [ ] **Step 3: Revert `app/root.tsx`**

Replace the file in full:

```tsx
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Delete `app/tailwind.css`**

```bash
git rm app/tailwind.css
```

- [ ] **Step 5: Delete the custom UI primitives — DEFERRED to after Task 4**

Do **not** run this step yet. `app/routes/app._index.tsx`, `app.reels.tsx`, and `app.widgets.tsx` still import from `app/components/ui/*` until Tasks 2-4 replace them — deleting these files now would break `npm run typecheck` for the rest of this plan's execution. Come back and run this exact command once Tasks 2, 3, and 4 are all committed:

```bash
git rm app/components/ui/Badge.tsx app/components/ui/Button.tsx app/components/ui/Card.tsx app/components/ui/Checkbox.tsx app/components/ui/Modal.tsx app/components/ui/PageShell.tsx app/components/ui/Select.tsx app/components/ui/StatTile.tsx app/components/ui/TextField.tsx
```

(Task 5, Step 1 below performs this deletion — don't do it here.)

- [ ] **Step 6: Verify**

```bash
npm run typecheck
```
Expected: **new errors are expected right now** — `app._index.tsx`/`app.reels.tsx`/`app.widgets.tsx` still import `app/components/ui/*`, which is unaffected by this task (only `app/tailwind.css`, `vite.config.ts`, and `app/root.tsx` changed — the `app/components/ui/*` files themselves still exist, only Tailwind's build plugin is gone). Confirm the specific errors are ONLY about missing Tailwind-driven CSS class behavior at runtime being untestable via typecheck (there shouldn't be any — `npm run typecheck` only checks types, and the `ui/*` components still compile fine without the Vite plugin present, since that plugin only affects CSS processing, not TypeScript). If `npm run typecheck` reports anything beyond pre-existing unrelated errors, stop and investigate before continuing.

```bash
npm run lint
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.ts app/root.tsx
git commit -m "chore(admin): remove Tailwind toolchain (routes still migrating to Polaris)"
```

(The `app/tailwind.css` deletion from Step 4 is included via `git rm` having already staged it.)

---

### Task 2: Rewrite `app._index.tsx` on Polaris

**Files:**
- Modify: `app/routes/app._index.tsx`

**Interfaces:**
- Consumes: no custom components — pure Polaris `<s-*>` tags plus `PreserveSearchParams` (unchanged, load-bearing fix for a documented embedded-admin bug — do not remove).

- [ ] **Step 1: Replace the file in full**

This JSX has been validated against the live `polaris-app-home` API (see Global Constraints).

```tsx
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { listReels } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import { listWidgetsForShop } from "../models/widget.server";
import { PreserveSearchParams } from "../components/PreserveSearchParams";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const [reels, widgets] = await Promise.all([
    listReels(admin, 50),
    listWidgetsForShop(shop.id),
  ]);

  const readyReels = reels.filter((r) => deriveReelStatus(r.config) === "ready").length;
  const publishedWidgets = widgets.filter((w) => w.published).length;

  return {
    plan: shop.plan,
    viewCapMonthly: shop.viewCapMonthly,
    totalReels: reels.length,
    readyReels,
    totalWidgets: widgets.length,
    publishedWidgets,
  };
};

function NavCard({
  to,
  heading,
  description,
}: {
  to: string;
  heading: string;
  description: string;
}) {
  return (
    <form method="get" action={to} style={{ margin: 0 }}>
      <PreserveSearchParams />
      <button
        type="submit"
        style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}
      >
        <s-box padding="base" background="subdued" borderRadius="base">
          <s-stack gap="small-200">
            <s-text>{heading}</s-text>
            <s-text color="subdued">{description}</s-text>
          </s-stack>
        </s-box>
      </button>
    </form>
  );
}

export default function Index() {
  const {
    plan,
    viewCapMonthly,
    totalReels,
    readyReels,
    totalWidgets,
    publishedWidgets,
  } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Shoppable Videos" inlineSize="large">
      <s-section>
        <s-paragraph color="subdued">
          An overview of your reels and storefront widgets.
        </s-paragraph>
      </s-section>
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Reels</s-text>
              <s-heading>{totalReels}</s-heading>
              <s-text color="subdued">{readyReels} ready to play</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Widgets</s-text>
              <s-heading>{totalWidgets}</s-heading>
              <s-text color="subdued">{publishedWidgets} published</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Plan</s-text>
              <s-heading>{plan}</s-heading>
              <s-text color="subdued">{viewCapMonthly.toLocaleString()} views/mo</s-text>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>
      <s-section heading="Get started">
        <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
          <NavCard
            to="/app/reels"
            heading="Reels library"
            description="Upload videos, tag products, manage status"
          />
          <NavCard
            to="/app/widgets"
            heading="Widgets"
            description="Manage where reels show up on your storefront"
          />
        </s-grid>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
npm run lint
```
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add app/routes/app._index.tsx
git commit -m "refactor(admin): rebuild home page on Polaris web components"
```

---

### Task 3: Rewrite `app.reels.tsx` on Polaris

**Files:**
- Modify: `app/routes/app.reels.tsx`

**Interfaces:**
- Loader and action are copied forward with **zero behavior changes** — every intent branch (`mark-upload-failed`, `start-upload`), the `armedRef` guard, and the `e instanceof Response` rethrow are identical to the current file.
- Consumes: no custom components — pure Polaris `<s-*>` tags.

- [ ] **Step 1: Replace the file in full**

This JSX has been validated against the live `polaris-app-home` API (see Global Constraints).

```tsx
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  deleteReel,
  generateReelHandle,
  listReels,
  updateReelConfig,
  upsertReel,
} from "../models/reel.server";
import type { Reel } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import { createDirectUploadUrl, getCloudflareConfig } from "../models/cloudflare-stream.server";

// Route param is the trailing numeric id only — a raw GID (gid://shopify/Metaobject/123)
// contains ':' and '/' characters that break single-segment routing/URLs.
function reelNumericId(reel: Reel): string {
  return reel.id.split("/").pop()!;
}

const REEL_STATUS_LABELS: Record<string, string> = {
  draft: "No video",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const reels = await listReels(admin, 50);
  return { reels };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

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
    const title = String(formData.get("title") ?? "").trim();
    const published = formData.get("published") != null;
    if (!title) {
      return { error: "Title is required", uploadURL: null, reelId: null };
    }

    try {
      const reel = await upsertReel(admin, generateReelHandle(title), title, published, {
        productIds: [],
        interactions: {},
        source: { type: "upload" },
      });

      try {
        const { uid, uploadURL } = await createDirectUploadUrl(
          getCloudflareConfig(),
          3600,
          { reelId: reel.id, shop: session.shop },
        );

        // Record the stream uid as soon as it exists, not just when the
        // "ready" webhook fires — that webhook depends on a notificationUrl
        // registered against this app's public URL, which in dev points at
        // a Cloudflare tunnel hostname that rotates on every restart. Without
        // this, an otherwise-successful upload leaves config.cloudflareStreamUid
        // unset forever and the preview never appears, regardless of whether
        // the video actually finished processing.
        await updateReelConfig(admin, reel.id, { cloudflareStreamUid: uid });

        return { error: null, uploadURL, reelId: reel.id };
      } catch {
        try {
          await deleteReel(admin, reel.id);
        } catch {
          // best-effort cleanup; the original error below is what the merchant sees
        }
        return {
          error: "Could not start upload. Check Cloudflare configuration.",
          uploadURL: null,
          reelId: null,
        };
      }
    } catch (e) {
      // The Shopify Admin client throws actual Response objects (not Error) for
      // session-token expiry and rate-limit throttling — this is Shopify's own
      // control-flow mechanism and React Router needs to see it propagate. Do not
      // remove this rethrow or it will swallow real auth failures and mislabel
      // them as Cloudflare configuration errors.
      if (e instanceof Response) throw e;
      return {
        error: "Could not create the reel. Try again.",
        uploadURL: null,
        reelId: null,
      };
    }
  }

  return { error: "Unknown request", uploadURL: null, reelId: null };
};

function statusTone(status: string | null): "success" | "critical" | "info" | "neutral" {
  return status === "ready"
    ? "success"
    : status === "failed"
      ? "critical"
      : status === "processing"
        ? "info"
        : "neutral";
}

function CreateReelModal() {
  const fetcher = useFetcher<typeof action>();
  const failureFetcher = useFetcher();
  const shopify = useAppBridge();
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "done" | "error" | "no-file"
  >("idle");
  // armedRef gates the upload PUT to fire exactly once per submission. Without
  // it, changing the selected file after a completed/failed upload re-runs this
  // effect and re-fires against the STALE one-time uploadURL from the previous
  // submission — silently uploading the wrong file into the wrong reel's
  // Cloudflare record with no visible error. Do not remove this guard, and do
  // not drop `fetcher.state` from the dependency array (it closes a ~1-3s race
  // during an in-flight submission).
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

  useEffect(() => {
    if (uploadStatus === "done") {
      shopify.modal.hide("create-reel-modal");
    }
  }, [uploadStatus, shopify]);

  const isSubmitting = fetcher.state !== "idle" || uploadStatus === "uploading";

  return (
    <s-modal
      id="create-reel-modal"
      heading="Create a reel"
      onHide={() => {
        setFile(null);
        setUploadStatus("idle");
      }}
    >
      <fetcher.Form
        method="post"
        onSubmit={(e) => {
          if (!file) {
            e.preventDefault();
            setUploadStatus("no-file");
            return;
          }
          armedRef.current = true;
          setUploadStatus("idle");
        }}
      >
        <input type="hidden" name="intent" value="start-upload" />
        <s-stack gap="base">
          {fetcher.data?.error && (
            <s-paragraph tone="critical">{fetcher.data.error}</s-paragraph>
          )}
          <s-text-field label="Title" name="title" required></s-text-field>
          <s-checkbox label="Published" name="published"></s-checkbox>
          <s-drop-zone
            label="Video file"
            name="file"
            accept="video/*"
            accessibilityLabel="Video file"
            onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
          ></s-drop-zone>
          {uploadStatus === "uploading" && (
            <s-paragraph>Uploading to Cloudflare…</s-paragraph>
          )}
          {uploadStatus === "error" && (
            <s-paragraph tone="critical">Upload failed. Try again.</s-paragraph>
          )}
          {uploadStatus === "no-file" && (
            <s-paragraph tone="critical">Choose a video file first.</s-paragraph>
          )}
        </s-stack>
        <s-button slot="primary-action" variant="primary" type="submit" loading={isSubmitting}>
          Create reel
        </s-button>
        <s-button slot="secondary-actions" commandFor="create-reel-modal" command="--hide">
          Cancel
        </s-button>
      </fetcher.Form>
    </s-modal>
  );
}

function ReelCard({ reel, onOpen }: { reel: Reel; onOpen: (reel: Reel) => void }) {
  const status = deriveReelStatus(reel.config);
  const productCount = reel.config.productIds?.length ?? 0;

  return (
    // Opens a popup instead of navigating — full-page navigation inside the
    // embedded admin iframe repeatedly failed to reach the detail route (see
    // git history). A click handler that loads detail data via useFetcher()
    // sidesteps that: fetcher requests go through App Bridge's patched
    // fetch(), which attaches a session-token header, so authenticate.admin()
    // never falls back to needing shop/host params.
    <s-clickable
      padding="base"
      background="subdued"
      borderRadius="base"
      commandFor="reel-detail-modal"
      command="--show"
      onClick={() => onOpen(reel)}
    >
      <s-stack gap="small-200">
        {reel.config.posterUrl && (
          <s-image
            src={reel.config.posterUrl}
            alt={reel.title}
            aspectRatio="9/16"
            objectFit="cover"
            loading="lazy"
          ></s-image>
        )}
        <s-text>{reel.title}</s-text>
        <s-stack direction="inline" gap="small-200">
          <s-badge tone={reel.published ? "success" : "neutral"}>
            {reel.published ? "Published" : "Draft"}
          </s-badge>
          <s-badge tone={statusTone(status)}>{REEL_STATUS_LABELS[status]}</s-badge>
        </s-stack>
        <s-badge tone={productCount > 0 ? "success" : "neutral"}>
          {productCount > 0 ? `${productCount} tagged` : "Untagged"}
        </s-badge>
      </s-stack>
    </s-clickable>
  );
}

type ReelDetailLoaderData = {
  loaderError: string | null;
  reel: Reel | null;
  taggedProducts: { id: string; title: string }[];
};

function ReelDetailModal({
  reel,
  href,
  onClose,
}: {
  reel: Reel | null;
  href: string | null;
  onClose: () => void;
}) {
  const detailFetcher = useFetcher<ReelDetailLoaderData>();
  const editFetcher = useFetcher<{ error: string | null }>();
  const productsFetcher = useFetcher<{ error: string | null }>();
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => {
    if (href) detailFetcher.load(href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);

  useEffect(() => {
    if (href && editFetcher.state === "idle" && editFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editFetcher.state, editFetcher.data]);

  useEffect(() => {
    if (href && productsFetcher.state === "idle" && productsFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productsFetcher.state, productsFetcher.data]);

  const handlePickProducts = async () => {
    if (!href) return;
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: (detailFetcher.data?.taggedProducts ?? []).map((p) => ({ id: p.id })),
    });
    if (!selected) return;

    const formData = new FormData();
    formData.set("intent", "set-products");
    for (const product of selected) {
      formData.append("productId", product.id);
    }
    productsFetcher.submit(formData, { method: "post", action: href });
  };

  const data = detailFetcher.data;
  const detailReel = data?.reel ?? null;
  const status = detailReel ? deriveReelStatus(detailReel.config) : null;

  return (
    <s-modal id="reel-detail-modal" heading={reel?.title ?? "Reel"} onHide={onClose}>
      {!data ? (
        <s-paragraph>Loading…</s-paragraph>
      ) : data.loaderError ? (
        <s-paragraph tone="critical">{data.loaderError}</s-paragraph>
      ) : detailReel ? (
        <s-stack gap="base">
          {detailReel.config.cloudflareStreamUid ? (
            <iframe
              src={`https://iframe.videodelivery.net/${encodeURIComponent(detailReel.config.cloudflareStreamUid)}`}
              title={`Preview of ${detailReel.title}`}
              style={{ border: "none", aspectRatio: "9 / 16", width: "100%", maxWidth: "220px" }}
              allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture"
              allowFullScreen
            ></iframe>
          ) : (
            <s-paragraph>No video uploaded yet.</s-paragraph>
          )}
          <s-paragraph>
            Status: <s-badge tone={statusTone(status)}>{status ? REEL_STATUS_LABELS[status] : ""}</s-badge>
          </s-paragraph>

          <s-divider></s-divider>

          {editFetcher.data?.error && (
            <s-paragraph tone="critical">{editFetcher.data.error}</s-paragraph>
          )}
          <editFetcher.Form method="post" action={href ?? undefined}>
            <s-stack gap="base">
              <s-text-field
                label="Title"
                name="title"
                defaultValue={detailReel.title}
                required
              ></s-text-field>
              <s-checkbox
                label="Published"
                name="published"
                defaultChecked={detailReel.published}
              ></s-checkbox>
              <s-button type="submit" variant="primary" loading={editFetcher.state !== "idle"}>
                Save
              </s-button>
            </s-stack>
          </editFetcher.Form>

          <s-divider></s-divider>

          <s-stack gap="base">
            {productsFetcher.data?.error && (
              <s-paragraph tone="critical">{productsFetcher.data.error}</s-paragraph>
            )}
            {data.taggedProducts.length === 0 ? (
              <s-paragraph>No products tagged yet.</s-paragraph>
            ) : (
              <s-stack gap="small-200">
                {data.taggedProducts.map((product) => (
                  <s-paragraph key={product.id}>{product.title}</s-paragraph>
                ))}
              </s-stack>
            )}
            <s-button
              variant="secondary"
              onClick={handlePickProducts}
              loading={productsFetcher.state !== "idle"}
            >
              {data.taggedProducts.length === 0 ? "Tag products" : "Edit tagged products"}
            </s-button>
          </s-stack>

          <s-divider></s-divider>

          <deleteFetcher.Form
            method="post"
            action={href ?? undefined}
            onSubmit={(e) => {
              // Don't call onClose() here — it sets selectedReelId to null
              // synchronously, which can flip href to null before/while the
              // fetcher reads this form's action, sending the delete POST
              // for the wrong (or no) id and 404ing (confirmed live on the
              // equivalent widgets modal). The modal closes naturally once
              // the reel disappears from the revalidated list after the
              // delete redirect completes.
              if (!confirm("Delete this reel? This can't be undone.")) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="delete" />
            <s-button type="submit" variant="secondary" tone="critical" loading={deleteFetcher.state !== "idle"}>
              Delete reel
            </s-button>
          </deleteFetcher.Form>
        </s-stack>
      ) : null}
    </s-modal>
  );
}

export default function ReelsLibrary() {
  const { reels } = useLoaderData<typeof loader>();
  const [selectedReelId, setSelectedReelId] = useState<string | null>(null);
  // Re-derived from the live `reels` list (not stored as its own object) so
  // the modal reflects fresh data automatically after the list revalidates.
  const selectedReel = reels.find((r) => r.id === selectedReelId) ?? null;
  const href = selectedReel ? `/app/reels/${reelNumericId(selectedReel)}` : null;

  const publishedCount = reels.filter((r) => r.published).length;
  const readyCount = reels.filter(
    (r) => deriveReelStatus(r.config) === "ready",
  ).length;
  const taggedCount = reels.filter(
    (r) => (r.config.productIds?.length ?? 0) > 0,
  ).length;

  return (
    <s-page heading="Reels library" inlineSize="large">
      <s-button slot="primary-action" variant="primary" commandFor="create-reel-modal" command="--show">
        Create reel
      </s-button>
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Total reels</s-text>
              <s-heading>{reels.length}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Published</s-text>
              <s-heading>{publishedCount}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Ready to play</s-text>
              <s-heading>{readyCount}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Tagged to products</s-text>
              <s-heading>{taggedCount}</s-heading>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      <s-section heading="All reels">
        {reels.length === 0 ? (
          <s-paragraph>No reels yet. Use Create reel to add your first one.</s-paragraph>
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
            {reels.map((reel) => (
              <ReelCard key={reel.id} reel={reel} onOpen={(r) => setSelectedReelId(r.id)} />
            ))}
          </s-grid>
        )}
      </s-section>

      <CreateReelModal />
      <ReelDetailModal reel={selectedReel} href={href} onClose={() => setSelectedReelId(null)} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
npm run lint
```
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.reels.tsx
git commit -m "refactor(admin): rebuild reels library on Polaris web components"
```

---

### Task 4: Rewrite `app.widgets.tsx` on Polaris

**Files:**
- Modify: `app/routes/app.widgets.tsx`

**Interfaces:**
- Loader and action are copied forward with **zero behavior changes**.
- Consumes: no custom components — pure Polaris `<s-*>` tags. Per the confirmed trade-off, the template picker's custom SVG icons are dropped (name + description text only, matching the original pre-Tailwind version).

- [ ] **Step 1: Replace the file in full**

This JSX has been validated against the live `polaris-app-home` API (see Global Constraints).

```tsx
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { createWidget, listWidgetsForShop } from "../models/widget.server";
import type { WidgetConfig, WidgetKind } from "../models/widget.server";
import type { Widget } from "@prisma/client";

interface WidgetTemplateMeta {
  kind: WidgetKind;
  name: string;
  description: string;
}

const WIDGET_TEMPLATES: WidgetTemplateMeta[] = [
  {
    kind: "PRODUCT_PAGE_REELS",
    name: "Product page reels",
    description: "A row of tagged reels on the product page.",
  },
  {
    kind: "SINGLE_VIDEO",
    name: "Single video",
    description: "One featured video, no carousel.",
  },
  {
    kind: "CAROUSEL",
    name: "Stacked carousel",
    description: "Tagged reels as a swipeable stacked deck.",
  },
  {
    kind: "STORIES",
    name: "Insta-style stories",
    description: "Circular avatars that open a full-screen story viewer.",
  },
  {
    kind: "REEL_POPS",
    name: "Reel pops",
    description: "A site-wide floating bubble that expands into a video.",
  },
];

const WIDGET_KINDS: WidgetKind[] = WIDGET_TEMPLATES.map((t) => t.kind);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widgets = await listWidgetsForShop(shop.id);
  return { widgets };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "");

  if (!name || !WIDGET_KINDS.includes(type as WidgetKind)) {
    return { error: "Name and a valid widget type are required" };
  }

  await createWidget(shop.id, type as WidgetKind, name, {
    templateStyle: "classic",
    targetRule: { type: "all_products" },
  });

  return { error: null };
};

function WidgetCard({ widget, onOpen }: { widget: Widget; onOpen: (widget: Widget) => void }) {
  const config = widget.config as unknown as WidgetConfig;
  const kind = widget.type as WidgetKind;
  const meta = WIDGET_TEMPLATES.find((t) => t.kind === kind);
  const targetRule = config.targetRule;
  const handleCount = targetRule?.type === "handles" ? targetRule.handles.length : 0;
  const targetSummary =
    targetRule?.type === "all_products"
      ? "All products"
      : `${handleCount} product${handleCount === 1 ? "" : "s"}`;
  const reelCount = config.reelIds?.length ?? 0;
  const hasFeaturedReel = Boolean(config.featuredReelId);
  const showsFeaturedReel = kind === "SINGLE_VIDEO" || kind === "REEL_POPS";
  const showsReelCount = kind === "PRODUCT_PAGE_REELS" || kind === "CAROUSEL" || kind === "STORIES";

  return (
    // Opens a popup instead of navigating — see ReelCard in app.reels.tsx for
    // why: full-page navigation inside the embedded admin iframe repeatedly
    // failed to reach the detail route, while fetcher requests (used here)
    // go through App Bridge's patched fetch() and carry a session token.
    <s-clickable
      padding="base"
      background="subdued"
      borderRadius="base"
      commandFor="widget-detail-modal"
      command="--show"
      onClick={() => onOpen(widget)}
    >
      <s-stack gap="small-200">
        <s-text>{widget.name}</s-text>
        <s-text color="subdued">{meta?.name ?? widget.type}</s-text>
        <s-stack direction="inline" gap="small-200">
          <s-badge tone={widget.published ? "success" : "neutral"}>
            {widget.published ? "Published" : "Draft"}
          </s-badge>
          <s-badge tone="neutral">{targetSummary}</s-badge>
        </s-stack>
        {(showsFeaturedReel || showsReelCount) && (
          <s-text color="subdued">
            {showsFeaturedReel && (hasFeaturedReel ? "Featured reel set" : "No featured reel yet")}
            {showsReelCount && `${reelCount} reel${reelCount === 1 ? "" : "s"} selected`}
          </s-text>
        )}
      </s-stack>
    </s-clickable>
  );
}

function TemplatePicker({
  value,
  onChange,
}: {
  value: WidgetKind;
  onChange: (kind: WidgetKind) => void;
}) {
  return (
    <s-grid gridTemplateColumns="repeat(auto-fill, minmax(160px, 1fr))" gap="small-200">
      {WIDGET_TEMPLATES.map((template) => (
        <s-clickable
          key={template.kind}
          padding="base"
          background={template.kind === value ? "strong" : "subdued"}
          borderRadius="base"
          onClick={() => onChange(template.kind)}
        >
          <s-stack gap="small-200">
            <s-text>{template.name}</s-text>
            <s-text color="subdued">{template.description}</s-text>
          </s-stack>
        </s-clickable>
      ))}
    </s-grid>
  );
}

function CreateWidgetModal() {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [selectedKind, setSelectedKind] = useState<WidgetKind>("PRODUCT_PAGE_REELS");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      shopify.modal.hide("create-widget-modal");
    }
  }, [fetcher.state, fetcher.data, shopify]);

  return (
    <s-modal id="create-widget-modal" heading="Create a widget">
      <fetcher.Form method="post">
        <s-stack gap="base">
          {fetcher.data?.error && (
            <s-paragraph tone="critical">{fetcher.data.error}</s-paragraph>
          )}
          <s-text-field label="Name" name="name" required></s-text-field>
          <input type="hidden" name="type" value={selectedKind} />
          <TemplatePicker value={selectedKind} onChange={setSelectedKind} />
        </s-stack>
        <s-button slot="primary-action" variant="primary" type="submit" loading={fetcher.state !== "idle"}>
          Create widget
        </s-button>
        <s-button slot="secondary-actions" commandFor="create-widget-modal" command="--hide">
          Cancel
        </s-button>
      </fetcher.Form>
    </s-modal>
  );
}

type WidgetDetailLoaderData = {
  widget: Widget;
  reels: { id: string; title: string }[];
};

function WidgetDetailModal({
  widget,
  href,
  onClose,
}: {
  widget: Widget | null;
  href: string | null;
  onClose: () => void;
}) {
  const detailFetcher = useFetcher<WidgetDetailLoaderData>();
  const editFetcher = useFetcher<{ error: string | null }>();
  const targetFetcher = useFetcher<{ error: string | null }>();
  const featuredReelFetcher = useFetcher<{ error: string | null }>();
  const reelsFetcher = useFetcher<{ error: string | null }>();
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => {
    if (href) detailFetcher.load(href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);

  useEffect(() => {
    if (href && editFetcher.state === "idle" && editFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editFetcher.state, editFetcher.data]);

  useEffect(() => {
    if (href && targetFetcher.state === "idle" && targetFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFetcher.state, targetFetcher.data]);

  useEffect(() => {
    if (href && featuredReelFetcher.state === "idle" && featuredReelFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuredReelFetcher.state, featuredReelFetcher.data]);

  useEffect(() => {
    if (href && reelsFetcher.state === "idle" && reelsFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reelsFetcher.state, reelsFetcher.data]);

  const detailWidget = detailFetcher.data?.widget ?? null;
  const targetRule = detailWidget
    ? (detailWidget.config as unknown as WidgetConfig).targetRule
    : null;
  const currentHandles = targetRule?.type === "handles" ? targetRule.handles : [];

  const handlePickProducts = async () => {
    if (!href) return;
    const selected = await shopify.resourcePicker({ type: "product", multiple: true });
    if (!selected) return;

    const formData = new FormData();
    formData.set("intent", "set-target");
    for (const product of selected) {
      formData.append("productHandle", product.handle);
    }
    targetFetcher.submit(formData, { method: "post", action: href });
  };

  const handleClearTarget = () => {
    if (!href) return;
    const formData = new FormData();
    formData.set("intent", "clear-target");
    targetFetcher.submit(formData, { method: "post", action: href });
  };

  return (
    <s-modal id="widget-detail-modal" heading={widget?.name ?? "Widget"} onHide={onClose}>
      {!detailWidget ? (
        <s-paragraph>Loading…</s-paragraph>
      ) : (
        <s-stack gap="base">
          <s-paragraph>Type: {detailWidget.type}</s-paragraph>

          <s-divider></s-divider>

          {editFetcher.data?.error && (
            <s-paragraph tone="critical">{editFetcher.data.error}</s-paragraph>
          )}
          <editFetcher.Form method="post" action={href ?? undefined}>
            <s-stack gap="base">
              <s-text-field
                label="Name"
                name="name"
                defaultValue={detailWidget.name}
                required
              ></s-text-field>
              <s-checkbox
                label="Published"
                name="published"
                defaultChecked={detailWidget.published}
              ></s-checkbox>
              <s-button type="submit" variant="primary" loading={editFetcher.state !== "idle"}>
                Save
              </s-button>
            </s-stack>
          </editFetcher.Form>

          <s-divider></s-divider>

          <s-stack gap="base">
            {targetFetcher.data?.error && (
              <s-paragraph tone="critical">{targetFetcher.data.error}</s-paragraph>
            )}
            {targetRule?.type === "all_products" ? (
              <s-paragraph>Showing on all products.</s-paragraph>
            ) : (
              <s-stack gap="small-200">
                <s-paragraph>Targeting {currentHandles.length} product(s):</s-paragraph>
                {currentHandles.map((handle) => (
                  <s-paragraph key={handle}>{handle}</s-paragraph>
                ))}
              </s-stack>
            )}
            <s-stack direction="inline" gap="small-200">
              <s-button
                variant="secondary"
                onClick={handlePickProducts}
                loading={targetFetcher.state !== "idle"}
              >
                Choose products
              </s-button>
              {targetRule?.type === "handles" && (
                <s-button variant="tertiary" onClick={handleClearTarget}>
                  Target all products instead
                </s-button>
              )}
            </s-stack>
          </s-stack>

          {(detailWidget.type === "SINGLE_VIDEO" || detailWidget.type === "REEL_POPS") && (
            <>
              <s-divider></s-divider>
              <s-stack gap="base">
                {featuredReelFetcher.data?.error && (
                  <s-paragraph tone="critical">{featuredReelFetcher.data.error}</s-paragraph>
                )}
                <s-paragraph>
                  Featured reel:{" "}
                  {(() => {
                    const featuredReelId = (detailWidget.config as unknown as WidgetConfig)
                      .featuredReelId;
                    const reels = detailFetcher.data?.reels ?? [];
                    const featured = reels.find((r) => r.id === featuredReelId);
                    return featured ? featured.title : "None chosen yet";
                  })()}
                </s-paragraph>
                <featuredReelFetcher.Form method="post" action={href ?? undefined}>
                  <input type="hidden" name="intent" value="set-featured-reel" />
                  <s-stack gap="base">
                    <s-select label="Choose reel" name="featuredReelId" required>
                      {(detailFetcher.data?.reels ?? []).map((reel) => (
                        <s-option key={reel.id} value={reel.id}>
                          {reel.title}
                        </s-option>
                      ))}
                    </s-select>
                    <s-button
                      type="submit"
                      variant="secondary"
                      loading={featuredReelFetcher.state !== "idle"}
                    >
                      Save featured reel
                    </s-button>
                  </s-stack>
                </featuredReelFetcher.Form>
              </s-stack>
            </>
          )}

          {(detailWidget.type === "PRODUCT_PAGE_REELS" ||
            detailWidget.type === "CAROUSEL" ||
            detailWidget.type === "STORIES") && (
            <>
              <s-divider></s-divider>
              <s-stack gap="base">
                {reelsFetcher.data?.error && (
                  <s-paragraph tone="critical">{reelsFetcher.data.error}</s-paragraph>
                )}
                <s-paragraph>
                  Reels shown by this widget (same set on every targeted product page):
                </s-paragraph>
                <reelsFetcher.Form method="post" action={href ?? undefined}>
                  <input type="hidden" name="intent" value="set-reels" />
                  <s-stack gap="small-200">
                    {(detailFetcher.data?.reels ?? []).map((reel) => (
                      <s-checkbox
                        key={reel.id}
                        label={reel.title}
                        name="reelId"
                        value={reel.id}
                        defaultChecked={(
                          (detailWidget.config as unknown as WidgetConfig).reelIds ?? []
                        ).includes(reel.id)}
                      ></s-checkbox>
                    ))}
                  </s-stack>
                  <s-button
                    type="submit"
                    variant="secondary"
                    loading={reelsFetcher.state !== "idle"}
                  >
                    Save reels
                  </s-button>
                </reelsFetcher.Form>
              </s-stack>
            </>
          )}

          <s-divider></s-divider>

          <deleteFetcher.Form
            method="post"
            action={href ?? undefined}
            onSubmit={(e) => {
              // Don't call onClose() here — it sets selectedWidgetId to
              // null synchronously, which can flip href to null before/while
              // the fetcher reads this form's action, sending the delete
              // POST for the wrong (or no) id and 404ing (confirmed live).
              // The modal closes naturally once the widget disappears from
              // the revalidated list after the delete redirect completes.
              if (!confirm("Delete this widget? This can't be undone.")) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="delete" />
            <s-button type="submit" variant="secondary" tone="critical" loading={deleteFetcher.state !== "idle"}>
              Delete widget
            </s-button>
          </deleteFetcher.Form>
        </s-stack>
      )}
    </s-modal>
  );
}

export default function Widgets() {
  const { widgets } = useLoaderData<typeof loader>();
  const publishedCount = widgets.filter((w) => w.published).length;
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const selectedWidget = widgets.find((w) => w.id === selectedWidgetId) ?? null;
  const href = selectedWidget ? `/app/widgets/${encodeURIComponent(selectedWidget.id)}` : null;

  return (
    <s-page heading="Widgets" inlineSize="large">
      <s-button slot="primary-action" variant="primary" commandFor="create-widget-modal" command="--show">
        Create widget
      </s-button>
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Total widgets</s-text>
              <s-heading>{widgets.length}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Published</s-text>
              <s-heading>{publishedCount}</s-heading>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      <s-section heading="All widgets">
        {widgets.length === 0 ? (
          <s-paragraph>No widgets yet. Use Create widget to add your first one.</s-paragraph>
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
            {widgets.map((widget) => (
              <WidgetCard key={widget.id} widget={widget} onOpen={(w) => setSelectedWidgetId(w.id)} />
            ))}
          </s-grid>
        )}
      </s-section>

      <CreateWidgetModal />
      <WidgetDetailModal widget={selectedWidget} href={href} onClose={() => setSelectedWidgetId(null)} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
npm run lint
```
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.widgets.tsx
git commit -m "refactor(admin): rebuild widgets page on Polaris web components"
```

---

### Task 5: Delete the custom UI primitives and verify the whole branch

**Files:**
- Delete: `app/components/ui/Badge.tsx`, `Button.tsx`, `Card.tsx`, `Checkbox.tsx`, `Modal.tsx`, `PageShell.tsx`, `Select.tsx`, `StatTile.tsx`, `TextField.tsx`

**Interfaces:** none.

- [ ] **Step 1: Delete the now-unused primitive files**

```bash
git rm app/components/ui/Badge.tsx app/components/ui/Button.tsx app/components/ui/Card.tsx app/components/ui/Checkbox.tsx app/components/ui/Modal.tsx app/components/ui/PageShell.tsx app/components/ui/Select.tsx app/components/ui/StatTile.tsx app/components/ui/TextField.tsx
```

- [ ] **Step 2: Confirm nothing still imports them**

```bash
grep -rn "components/ui/" app/routes/
```
Expected: no output.

- [ ] **Step 3: Confirm no Tailwind traces remain**

```bash
grep -rn "tailwind" package.json vite.config.ts app/root.tsx
```
Expected: no output.

```bash
ls app/tailwind.css 2>&1
```
Expected: `No such file or directory`.

- [ ] **Step 4: Full project checks**

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```
Expected: all four clean.

- [ ] **Step 5: MCP validation of the three rewritten route files**

Extract the full JSX-containing content of `app/routes/app._index.tsx`, `app/routes/app.reels.tsx`, and `app/routes/app.widgets.tsx` (as they exist in the working tree right now, not the plan's copy) and run `mcp__shopify-dev-mcp__validate_component_codeblocks` (api: `polaris-app-home`) against each, using your own `mcp__shopify-dev-mcp__learn_shopify_api` conversation id. This re-confirms the actually-committed code (which may have picked up small edits during Tasks 2-4's own review/fix loops) still validates clean, not just the plan's original draft.

- [ ] **Step 6: Manual walkthrough**

Run the dev server and click through: `/app` (stat tiles, both nav cards) → `/app/reels` (header "Create reel" opens the modal; fill title + published + drop a video file; submit; confirm the modal auto-closes on successful upload and the new reel appears; open a reel card's detail modal, confirm the Cloudflare preview iframe/status/edit-form/tag-products/delete sections all render and work; confirm delete still succeeds without a 404) → `/app/widgets` (header "Create widget" opens the modal with the template picker; create one of each of the 5 template kinds; open a widget card's detail modal, confirm edit/target-picker/featured-reel-or-reels-checklist (per kind)/delete all work). Confirm every modal opens via the header/card click and closes correctly via its own × / Cancel / backdrop / ESC, and that the auto-close-on-success behavior works for both create modals.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(admin): remove unused Tailwind-era UI primitives"
```
