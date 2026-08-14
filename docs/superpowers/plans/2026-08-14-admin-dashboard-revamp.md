# Admin Dashboard Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Shopify's real sidebar navigation (`<s-app-nav>`) and rework the four admin screens into a wider, more spacious, dashboard-style layout — page-header-with-actions pattern, bigger stat tiles, elevated cards, a wider sectioned modal, and modal-based create flows — with zero changes to loader/action/fetcher business logic beyond what's needed to support modal-based create (see Global Constraints).

**Architecture:** Update four shared primitives first (`PageShell`, `StatTile`, `Card`, `Modal`), restore `<s-app-nav>` and delete the now-redundant custom `AppNav` component, then rework each of the three content routes on top of the updated primitives.

**Tech Stack:** Same as the existing app (React Router 7, Tailwind CSS v4, Shopify App Bridge) — no new dependencies.

## Global Constraints

- No change to any loader, action, or `*.server.ts` model function's *behavior* — same validation, same return shapes, same side effects as today. The one permitted exception: the existing "Create a reel" / "Create a widget" `<Form method="post">` submissions move to `useFetcher()`-driven submissions against the *same* route action, so the new create-modal can auto-close on success. This changes *how* the request is sent, not what the action does or returns.
- `app/routes/app.reels.$id.tsx`, `app/routes/app.widgets.$id.tsx`, and `app/routes/app.settings.tsx` are out of scope — do not touch them.
- Every fetcher/effect pattern already present and documented with an explanatory comment (the `armedRef` upload guard, the delete-form `onSubmit` race-condition fix in both `app.reels.tsx` and `app.widgets.tsx`, the `if (e instanceof Response) throw e` rethrow, the five detail-modal reload effects in `app.widgets.tsx`) must be preserved verbatim, including its comment.
- Colors stay on the existing OKLCH token classes (`bg-primary`, `text-ink`, `border-border`, etc.) — no new tokens, no hardcoded hex/oklch().
- `npm run typecheck` and `npm run lint` must stay clean throughout (no automated UI test suite exists in this project — these plus `npm run build` are the verification gates).

---

### Task 1: Update shared primitives — PageShell, StatTile, Card, Modal

**Files:**
- Modify: `app/components/ui/PageShell.tsx`
- Modify: `app/components/ui/StatTile.tsx`
- Modify: `app/components/ui/Card.tsx`
- Modify: `app/components/ui/Modal.tsx`

**Interfaces:**
- Produces: `PageShell({ heading: string, description?: string, actions?: ReactNode, children: ReactNode })` — new `description` and `actions` props, wider container.
- Produces: `StatTile` — same props as today (`label`, `value`, `sublabel?`), bigger visual treatment.
- Produces: `CARD_INTERACTIVE_CLASSES`/`CARD_CLASSES` — same exported names, updated with hover elevation.
- Produces: `Modal` — same `ModalHandle`/props contract as today, wider and more padded.

- [ ] **Step 1: Widen and extend `PageShell`**

Replace `app/components/ui/PageShell.tsx` in full:

```tsx
import type { ReactNode } from "react";

export function PageShell({
  heading,
  description,
  actions,
  children,
}: {
  heading: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1400px] px-6 py-10 lg:px-10">
      <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{heading}</h1>
          {description && (
            <p className="mt-1.5 text-sm text-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="flex flex-col gap-10">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Enlarge `StatTile`**

Replace `app/components/ui/StatTile.tsx` in full:

```tsx
export function StatTile({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1.5 text-3xl font-semibold text-ink">{value}</div>
      {sublabel && <div className="mt-1.5 text-sm text-muted">{sublabel}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Add hover elevation to `Card`**

Replace `app/components/ui/Card.tsx` in full:

```tsx
import type { ReactNode } from "react";

export const CARD_CLASSES = "rounded-lg border border-border bg-bg p-4";

export const CARD_INTERACTIVE_CLASSES =
  "rounded-lg border border-border bg-bg p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`${CARD_CLASSES} ${className}`}>{children}</div>;
}
```

- [ ] **Step 4: Widen `Modal` and increase padding**

In `app/components/ui/Modal.tsx`, change only the two className strings — everything else (imports, `ModalHandle`, `useImperativeHandle`, the `close`-event `useEffect`, the backdrop-click handler, the eslint-disable comment, the close button) stays byte-identical:

- The `<dialog>` element's `className` changes from
  `"m-auto w-full max-w-lg rounded-xl border border-border bg-bg p-0 backdrop:bg-ink/40"`
  to
  `"m-auto w-full max-w-2xl rounded-xl border border-border bg-bg p-0 backdrop:bg-ink/40"`.
- The header `<div>`'s `className` changes from
  `"flex items-center justify-between border-b border-border px-5 py-4"`
  to
  `"flex items-center justify-between border-b border-border px-6 py-5"`.
- The body `<div>`'s `className` changes from
  `"max-h-[70vh] overflow-y-auto px-5 py-4"`
  to
  `"max-h-[75vh] overflow-y-auto px-6 py-6"`.

- [ ] **Step 5: Verify**

Run:
```bash
npm run typecheck
npm run lint
```
Expected: both clean. Nothing consumes the new `description`/`actions` props yet, so this only checks the four files typecheck/lint standalone.

- [ ] **Step 6: Commit**

```bash
git add app/components/ui/PageShell.tsx app/components/ui/StatTile.tsx app/components/ui/Card.tsx app/components/ui/Modal.tsx
git commit -m "feat(admin-ui): widen and extend PageShell/StatTile/Card/Modal for dashboard layout"
```

---

### Task 2: Restore Shopify's sidebar nav, remove the custom top nav

**Files:**
- Modify: `app/routes/app.tsx`
- Delete: `app/components/ui/AppNav.tsx`

**Interfaces:**
- Consumes: none (this task removes a consumer, doesn't add one).

- [ ] **Step 1: Restore `<s-app-nav>` in `app/routes/app.tsx`**

Replace the file in full:

```tsx
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import type {} from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/reels">Reels library</s-link>
        <s-link href="/app/widgets">Widgets</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

- [ ] **Step 2: Delete the now-redundant custom nav component**

```bash
git rm app/components/ui/AppNav.tsx
```

- [ ] **Step 3: Verify**

```bash
npm run typecheck
npm run lint
```
Expected: both clean (confirms nothing else still imports `AppNav`).

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.tsx
git commit -m "refactor(admin): restore Shopify sidebar nav via s-app-nav, drop custom AppNav"
```

(The `git rm` in Step 2 stages the deletion; it will be included in this commit alongside `app/routes/app.tsx`.)

---

### Task 3: Rework `app._index.tsx` onto the wider PageShell

**Files:**
- Modify: `app/routes/app._index.tsx`

**Interfaces:**
- Consumes: `PageShell` (Task 1's new `description` prop), `StatTile`, `CARD_INTERACTIVE_CLASSES` (Task 1's elevation update, no API change).

- [ ] **Step 1: Replace the file in full**

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
import { PageShell } from "../components/ui/PageShell";
import { StatTile } from "../components/ui/StatTile";
import { CARD_INTERACTIVE_CLASSES } from "../components/ui/Card";

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
    <form method="get" action={to} className="m-0">
      <PreserveSearchParams />
      <button type="submit" className={`block w-full ${CARD_INTERACTIVE_CLASSES}`}>
        <div className="mb-1.5 font-semibold text-ink">{heading}</div>
        <div className="text-sm text-muted">{description}</div>
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
    <PageShell
      heading="Shoppable Videos"
      description="An overview of your reels and storefront widgets."
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Reels" value={totalReels} sublabel={`${readyReels} ready to play`} />
        <StatTile label="Widgets" value={totalWidgets} sublabel={`${publishedWidgets} published`} />
        <StatTile label="Plan" value={plan} sublabel={`${viewCapMonthly.toLocaleString()} views/mo`} />
      </div>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Get started</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
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
        </div>
      </section>
    </PageShell>
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
git commit -m "refactor(admin): rework home page onto wider dashboard PageShell"
```

---

### Task 4: Rework `app.reels.tsx` — page-header create action, wider cards, sectioned modal

**Files:**
- Modify: `app/routes/app.reels.tsx`

**Interfaces:**
- Consumes: `PageShell` (`description`/`actions` props), `StatTile`, `CARD_INTERACTIVE_CLASSES`, `Badge`, `Button`, `TextField`, `Checkbox`, `Modal`/`ModalHandle`.
- Loader and action are unchanged in behavior. The create-reel submission moves from a plain `<Form>` to a `useFetcher()`-driven `fetcher.Form` inside a new `CreateReelModal`, so it can auto-close on success — this is the one permitted wiring change from Global Constraints.
- Every other fetcher/effect/comment (upload `armedRef` guard, `mark-upload-failed`, the delete-form `onSubmit` race-fix comment, the three `ReelDetailModal` reload effects, `reelNumericId`, `REEL_STATUS_LABELS`, `statusTone`) is copied forward verbatim.

- [ ] **Step 1: Replace the file in full**

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
import { PageShell } from "../components/ui/PageShell";
import { StatTile } from "../components/ui/StatTile";
import { CARD_INTERACTIVE_CLASSES } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { Checkbox } from "../components/ui/Checkbox";
import { Modal, type ModalHandle } from "../components/ui/Modal";

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
    const title = String(formData.get("uploadTitle") ?? "").trim();
    if (!title) {
      return { error: "Title is required", uploadURL: null, reelId: null };
    }

    try {
      const reel = await upsertReel(admin, generateReelHandle(title), title, false, {
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
};

function CreateReelModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const modalRef = useRef<ModalHandle>(null);
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (open) {
      modalRef.current?.show();
    } else {
      modalRef.current?.hide();
    }
  }, [open]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return (
    <Modal ref={modalRef} title="Create a reel" onClose={onClose}>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        {fetcher.data?.error && (
          <p className="text-sm text-critical">{fetcher.data.error}</p>
        )}
        <TextField label="Title" name="title" required />
        <Checkbox label="Published" name="published" />
        <div>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            Create reel
          </Button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}

function UploadVideoForm() {
  const fetcher = useFetcher<typeof action>();
  const failureFetcher = useFetcher();
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

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-ink">Upload a video</h2>
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
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="intent" value="start-upload" />
        {fetcher.data?.error && (
          <p className="text-sm text-critical">{fetcher.data.error}</p>
        )}
        <TextField label="Title" name="uploadTitle" required />
        <input
          type="file"
          accept="video/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-ink file:mr-3 file:rounded-md file:border file:border-border file:bg-bg file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-surface"
        />
        <div>
          <Button type="submit" variant="primary" loading={fetcher.state !== "idle"}>
            Start upload
          </Button>
        </div>
        {uploadStatus === "uploading" && (
          <p className="text-sm text-muted">Uploading to Cloudflare…</p>
        )}
        {uploadStatus === "done" && (
          <p className="text-sm text-success">
            Upload complete — processing will finish shortly.
          </p>
        )}
        {uploadStatus === "error" && (
          <p className="text-sm text-critical">Upload failed. Try again.</p>
        )}
        {uploadStatus === "no-file" && (
          <p className="text-sm text-critical">Choose a video file first.</p>
        )}
      </fetcher.Form>
    </section>
  );
}

function statusTone(status: string | null): "success" | "critical" | "info" | "neutral" {
  return status === "ready"
    ? "success"
    : status === "failed"
      ? "critical"
      : status === "processing"
        ? "info"
        : "neutral";
}

function ReelCard({ reel, onOpen }: { reel: Reel; onOpen: (reel: Reel) => void }) {
  const status = deriveReelStatus(reel.config);
  const productCount = reel.config.productIds?.length ?? 0;

  return (
    // Opens a popup instead of navigating — full-page navigation inside the
    // embedded admin iframe repeatedly failed to reach the detail route (see
    // git history). A click handler that shows a Modal and loads detail data
    // via useFetcher() sidesteps that: fetcher requests go through App
    // Bridge's patched fetch(), which attaches a session-token header, so
    // authenticate.admin() never falls back to needing shop/host params.
    <button
      type="button"
      onClick={() => onOpen(reel)}
      className={`block w-full ${CARD_INTERACTIVE_CLASSES}`}
    >
      <div className="mb-2 h-[180px] w-full overflow-hidden rounded-md bg-surface">
        {reel.config.posterUrl ? (
          <img
            src={reel.config.posterUrl}
            alt={reel.title}
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>
      <div className="mb-2 font-semibold text-ink">{reel.title}</div>
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        <Badge tone={reel.published ? "success" : "neutral"}>
          {reel.published ? "Published" : "Draft"}
        </Badge>
        <Badge tone={statusTone(status)}>{REEL_STATUS_LABELS[status]}</Badge>
      </div>
      <Badge tone={productCount > 0 ? "success" : "neutral"}>
        {productCount > 0 ? `${productCount} tagged` : "Untagged"}
      </Badge>
    </button>
  );
}

type ReelDetailLoaderData = {
  loaderError: string | null;
  reel: Reel | null;
  taggedProducts: { id: string; title: string }[];
};

function ReelDetailModal({
  reel,
  onClose,
}: {
  reel: Reel | null;
  onClose: () => void;
}) {
  const modalRef = useRef<ModalHandle>(null);
  const detailFetcher = useFetcher<ReelDetailLoaderData>();
  const editFetcher = useFetcher<{ error: string | null }>();
  const productsFetcher = useFetcher<{ error: string | null }>();
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();
  const href = reel ? `/app/reels/${reelNumericId(reel)}` : null;

  useEffect(() => {
    if (href) {
      modalRef.current?.show();
      detailFetcher.load(href);
    } else {
      modalRef.current?.hide();
    }
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
    <Modal ref={modalRef} title={reel?.title ?? "Reel"} onClose={onClose}>
      {!data ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : data.loaderError ? (
        <p className="text-sm text-critical">{data.loaderError}</p>
      ) : detailReel ? (
        <div className="flex flex-col">
          <div className="flex flex-col gap-4 pb-6">
            {detailReel.config.cloudflareStreamUid ? (
              <iframe
                src={`https://iframe.videodelivery.net/${encodeURIComponent(detailReel.config.cloudflareStreamUid)}`}
                title={`Preview of ${detailReel.title}`}
                className="aspect-[9/16] w-full max-w-[220px] border-0"
                allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture"
                allowFullScreen
              ></iframe>
            ) : (
              <p className="text-sm text-muted">No video uploaded yet.</p>
            )}
            <p className="flex items-center gap-2 text-sm text-ink">
              Status:{" "}
              <Badge tone={statusTone(status)}>{status ? REEL_STATUS_LABELS[status] : ""}</Badge>
            </p>
          </div>

          <div className="flex flex-col gap-4 border-t border-border py-6">
            {editFetcher.data?.error && (
              <p className="text-sm text-critical">{editFetcher.data.error}</p>
            )}
            <editFetcher.Form method="post" action={href!} className="flex flex-col gap-4">
              <TextField label="Title" name="title" defaultValue={detailReel.title} required />
              <Checkbox label="Published" name="published" defaultChecked={detailReel.published} />
              <div>
                <Button type="submit" variant="primary" loading={editFetcher.state !== "idle"}>
                  Save
                </Button>
              </div>
            </editFetcher.Form>
          </div>

          <div className="flex flex-col gap-3 border-t border-border py-6">
            {productsFetcher.data?.error && (
              <p className="text-sm text-critical">{productsFetcher.data.error}</p>
            )}
            {data.taggedProducts.length === 0 ? (
              <p className="text-sm text-muted">No products tagged yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {data.taggedProducts.map((product) => (
                  <p key={product.id} className="text-sm text-ink">
                    {product.title}
                  </p>
                ))}
              </div>
            )}
            <div>
              <Button
                variant="secondary"
                onClick={handlePickProducts}
                loading={productsFetcher.state !== "idle"}
              >
                {data.taggedProducts.length === 0 ? "Tag products" : "Edit tagged products"}
              </Button>
            </div>
          </div>

          <div className="border-t border-border pt-6">
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
              <Button type="submit" variant="critical" loading={deleteFetcher.state !== "idle"}>
                Delete reel
              </Button>
            </deleteFetcher.Form>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export default function ReelsLibrary() {
  const { reels } = useLoaderData<typeof loader>();
  const [selectedReelId, setSelectedReelId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // Re-derived from the live `reels` list (not stored as its own object) so
  // the modal reflects fresh data automatically after the list revalidates.
  const selectedReel = reels.find((r) => r.id === selectedReelId) ?? null;

  const publishedCount = reels.filter((r) => r.published).length;
  const readyCount = reels.filter(
    (r) => deriveReelStatus(r.config) === "ready",
  ).length;
  const taggedCount = reels.filter(
    (r) => (r.config.productIds?.length ?? 0) > 0,
  ).length;

  return (
    <PageShell
      heading="Reels library"
      description="Upload videos, tag products, and manage what's ready to publish."
      actions={
        <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
          Create reel
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total reels" value={reels.length} />
        <StatTile label="Published" value={publishedCount} />
        <StatTile label="Ready to play" value={readyCount} />
        <StatTile label="Tagged to products" value={taggedCount} />
      </div>

      <UploadVideoForm />

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">All reels</h2>
        {reels.length === 0 ? (
          <p className="text-sm text-muted">No reels yet. Create your first one above.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {reels.map((reel) => (
              <ReelCard key={reel.id} reel={reel} onOpen={(r) => setSelectedReelId(r.id)} />
            ))}
          </div>
        )}
      </section>

      <CreateReelModal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <ReelDetailModal reel={selectedReel} onClose={() => setSelectedReelId(null)} />
    </PageShell>
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
git commit -m "refactor(admin): rework reels library onto dashboard layout with modal create flow"
```

---

### Task 5: Rework `app.widgets.tsx` — page-header create action, template icons, wider cards, sectioned modal

**Files:**
- Modify: `app/routes/app.widgets.tsx`

**Interfaces:**
- Consumes: `PageShell` (`description`/`actions` props), `StatTile`, `CARD_INTERACTIVE_CLASSES`, `Badge`, `Button`, `TextField`, `Checkbox`, `Select`, `Modal`/`ModalHandle`.
- Loader and action are unchanged in behavior. The create-widget submission moves from a plain `<Form>` to a `useFetcher()`-driven `fetcher.Form` inside a new `CreateWidgetModal`, same reasoning as Task 4.
- Every other fetcher/effect/comment (the delete-form `onSubmit` race-fix comment, all five detail-modal reload effects, `handlePickProducts`/`handleClearTarget`, `WIDGET_TEMPLATES`/`WIDGET_KINDS`) is copied forward verbatim.

- [ ] **Step 1: Replace the file in full**

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
import { getOrCreateShop } from "../models/shop.server";
import { createWidget, listWidgetsForShop } from "../models/widget.server";
import type { WidgetConfig, WidgetKind } from "../models/widget.server";
import type { Widget } from "@prisma/client";
import { PageShell } from "../components/ui/PageShell";
import { StatTile } from "../components/ui/StatTile";
import { CARD_INTERACTIVE_CLASSES } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { Checkbox } from "../components/ui/Checkbox";
import { Select } from "../components/ui/Select";
import { Modal, type ModalHandle } from "../components/ui/Modal";

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
  return (
    // Opens a popup instead of navigating — see ReelCard in app.reels.tsx for
    // why: full-page navigation inside the embedded admin iframe repeatedly
    // failed to reach the detail route, while fetcher requests (used here)
    // go through App Bridge's patched fetch() and carry a session token.
    <button
      type="button"
      onClick={() => onOpen(widget)}
      className={`block w-full ${CARD_INTERACTIVE_CLASSES}`}
    >
      <div className="mb-1.5 font-semibold text-ink">{widget.name}</div>
      <div className="mb-2 text-sm text-muted">{widget.type}</div>
      <Badge tone={widget.published ? "success" : "neutral"}>
        {widget.published ? "Published" : "Draft"}
      </Badge>
    </button>
  );
}

function TemplateIcon({ kind }: { kind: WidgetKind }) {
  const common = "h-6 w-6 text-primary";
  switch (kind) {
    case "PRODUCT_PAGE_REELS":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="6" width="4" height="12" rx="1" />
          <rect x="10" y="6" width="4" height="12" rx="1" />
          <rect x="17" y="6" width="4" height="12" rx="1" />
        </svg>
      );
    case "SINGLE_VIDEO":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="5" y="4" width="14" height="16" rx="2" />
          <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "CAROUSEL":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="2" y="7" width="5" height="10" rx="1" />
          <rect x="9.5" y="5" width="5" height="14" rx="1" />
          <rect x="17" y="7" width="5" height="10" rx="1" />
        </svg>
      );
    case "STORIES":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="7" cy="12" r="4" />
          <circle cx="17" cy="12" r="4" />
        </svg>
      );
    case "REEL_POPS":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="12" cy="12" r="7" />
          <circle cx="17" cy="7" r="2" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}

function TemplatePicker({
  value,
  onChange,
}: {
  value: WidgetKind;
  onChange: (kind: WidgetKind) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
      {WIDGET_TEMPLATES.map((template) => (
        <button
          key={template.kind}
          type="button"
          onClick={() => onChange(template.kind)}
          className={`rounded-lg border p-2.5 text-left transition-colors ${
            template.kind === value
              ? "border-2 border-primary"
              : "border border-border hover:border-primary/40"
          }`}
        >
          <div className="mb-2 flex h-14 items-center justify-center rounded-md bg-surface">
            <TemplateIcon kind={template.kind} />
          </div>
          <div className="text-sm font-semibold text-ink">{template.name}</div>
          <div className="text-xs text-muted">{template.description}</div>
        </button>
      ))}
    </div>
  );
}

function CreateWidgetModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const modalRef = useRef<ModalHandle>(null);
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";
  const [selectedKind, setSelectedKind] = useState<WidgetKind>("PRODUCT_PAGE_REELS");

  useEffect(() => {
    if (open) {
      modalRef.current?.show();
    } else {
      modalRef.current?.hide();
    }
  }, [open]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return (
    <Modal ref={modalRef} title="Create a widget" onClose={onClose}>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        {fetcher.data?.error && (
          <p className="text-sm text-critical">{fetcher.data.error}</p>
        )}
        <TextField label="Name" name="name" required />
        <input type="hidden" name="type" value={selectedKind} />
        <TemplatePicker value={selectedKind} onChange={setSelectedKind} />
        <div>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            Create widget
          </Button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}

type WidgetDetailLoaderData = {
  widget: Widget;
  reels: { id: string; title: string }[];
};

function WidgetDetailModal({
  widget,
  onClose,
}: {
  widget: Widget | null;
  onClose: () => void;
}) {
  const modalRef = useRef<ModalHandle>(null);
  const detailFetcher = useFetcher<WidgetDetailLoaderData>();
  const editFetcher = useFetcher<{ error: string | null }>();
  const targetFetcher = useFetcher<{ error: string | null }>();
  const featuredReelFetcher = useFetcher<{ error: string | null }>();
  const reelsFetcher = useFetcher<{ error: string | null }>();
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();
  const href = widget ? `/app/widgets/${encodeURIComponent(widget.id)}` : null;

  useEffect(() => {
    if (href) {
      modalRef.current?.show();
      detailFetcher.load(href);
    } else {
      modalRef.current?.hide();
    }
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
    <Modal ref={modalRef} title={widget?.name ?? "Widget"} onClose={onClose}>
      {!detailWidget ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col">
          <div className="flex flex-col gap-4 pb-6">
            <p className="text-sm text-ink">Type: {detailWidget.type}</p>

            {editFetcher.data?.error && (
              <p className="text-sm text-critical">{editFetcher.data.error}</p>
            )}
            <editFetcher.Form method="post" action={href!} className="flex flex-col gap-4">
              <TextField label="Name" name="name" defaultValue={detailWidget.name} required />
              <Checkbox label="Published" name="published" defaultChecked={detailWidget.published} />
              <div>
                <Button type="submit" variant="primary" loading={editFetcher.state !== "idle"}>
                  Save
                </Button>
              </div>
            </editFetcher.Form>
          </div>

          <div className="flex flex-col gap-3 border-t border-border py-6">
            {targetFetcher.data?.error && (
              <p className="text-sm text-critical">{targetFetcher.data.error}</p>
            )}
            {targetRule?.type === "all_products" ? (
              <p className="text-sm text-ink">Showing on all products.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm text-ink">Targeting {currentHandles.length} product(s):</p>
                {currentHandles.map((handle) => (
                  <p key={handle} className="text-sm text-muted">
                    {handle}
                  </p>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={handlePickProducts}
                loading={targetFetcher.state !== "idle"}
              >
                Choose products
              </Button>
              {targetRule?.type === "handles" && (
                <Button variant="ghost" onClick={handleClearTarget}>
                  Target all products instead
                </Button>
              )}
            </div>
          </div>

          {(detailWidget.type === "SINGLE_VIDEO" || detailWidget.type === "REEL_POPS") && (
            <div className="flex flex-col gap-3 border-t border-border py-6">
              {featuredReelFetcher.data?.error && (
                <p className="text-sm text-critical">{featuredReelFetcher.data.error}</p>
              )}
              <p className="text-sm text-ink">
                Featured reel:{" "}
                {(() => {
                  const featuredReelId = (detailWidget.config as unknown as WidgetConfig)
                    .featuredReelId;
                  const reels = detailFetcher.data?.reels ?? [];
                  const featured = reels.find((r) => r.id === featuredReelId);
                  return featured ? featured.title : "None chosen yet";
                })()}
              </p>
              <featuredReelFetcher.Form method="post" action={href!} className="flex flex-col gap-3">
                <input type="hidden" name="intent" value="set-featured-reel" />
                <Select label="Choose reel" name="featuredReelId" required>
                  {(detailFetcher.data?.reels ?? []).map((reel) => (
                    <option key={reel.id} value={reel.id}>
                      {reel.title}
                    </option>
                  ))}
                </Select>
                <div>
                  <Button
                    type="submit"
                    variant="secondary"
                    loading={featuredReelFetcher.state !== "idle"}
                  >
                    Save featured reel
                  </Button>
                </div>
              </featuredReelFetcher.Form>
            </div>
          )}

          {(detailWidget.type === "PRODUCT_PAGE_REELS" ||
            detailWidget.type === "CAROUSEL" ||
            detailWidget.type === "STORIES") && (
            <div className="flex flex-col gap-3 border-t border-border py-6">
              {reelsFetcher.data?.error && (
                <p className="text-sm text-critical">{reelsFetcher.data.error}</p>
              )}
              <p className="text-sm text-ink">
                Reels shown by this widget (same set on every targeted product page):
              </p>
              <reelsFetcher.Form method="post" action={href!} className="flex flex-col gap-3">
                <input type="hidden" name="intent" value="set-reels" />
                <div className="flex flex-col gap-2">
                  {(detailFetcher.data?.reels ?? []).map((reel) => (
                    <Checkbox
                      key={reel.id}
                      label={reel.title}
                      name="reelId"
                      value={reel.id}
                      defaultChecked={(
                        (detailWidget.config as unknown as WidgetConfig).reelIds ?? []
                      ).includes(reel.id)}
                    />
                  ))}
                </div>
                <div>
                  <Button
                    type="submit"
                    variant="secondary"
                    loading={reelsFetcher.state !== "idle"}
                  >
                    Save reels
                  </Button>
                </div>
              </reelsFetcher.Form>
            </div>
          )}

          <div className="border-t border-border pt-6">
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
              <Button type="submit" variant="critical" loading={deleteFetcher.state !== "idle"}>
                Delete widget
              </Button>
            </deleteFetcher.Form>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Widgets() {
  const { widgets } = useLoaderData<typeof loader>();
  const publishedCount = widgets.filter((w) => w.published).length;
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const selectedWidget = widgets.find((w) => w.id === selectedWidgetId) ?? null;

  return (
    <PageShell
      heading="Widgets"
      description="Control where and how your reels appear on the storefront."
      actions={
        <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
          Create widget
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <StatTile label="Total widgets" value={widgets.length} />
        <StatTile label="Published" value={publishedCount} />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">All widgets</h2>
        {widgets.length === 0 ? (
          <p className="text-sm text-muted">No widgets yet. Create your first one above.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {widgets.map((widget) => (
              <WidgetCard key={widget.id} widget={widget} onOpen={(w) => setSelectedWidgetId(w.id)} />
            ))}
          </div>
        )}
      </section>

      <CreateWidgetModal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <WidgetDetailModal widget={selectedWidget} onClose={() => setSelectedWidgetId(null)} />
    </PageShell>
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
git commit -m "refactor(admin): rework widgets page onto dashboard layout with modal create flow and template icons"
```

---

### Task 6: Whole-branch verification

**Files:** none (verification-only task).

**Interfaces:** none.

- [ ] **Step 1: Confirm the old custom nav is fully gone**

```bash
grep -rn "AppNav" app/
```
Expected: no output (the component file is deleted and nothing imports it).

- [ ] **Step 2: Confirm no stray `<s-` elements crept into the three reworked routes**

```bash
grep -rn "<s-" app/routes/app._index.tsx app/routes/app.reels.tsx app/routes/app.widgets.tsx
```
Expected: no output. (`app/routes/app.tsx` is expected to contain `<s-app-nav>`/`<s-link>` — that's Task 2's intentional restoration, not a leftover.)

- [ ] **Step 3: Full project checks**

```bash
npm run typecheck
npm run lint
npm run build
```
Expected: all three clean.

- [ ] **Step 4: Manual walkthrough**

Run the dev server and click through: `/app` (stat grid, nav cards) → `/app/reels` (header "Create reel" button opens a modal, create a reel there, confirm the modal closes on success and the new reel appears in the list; upload a video; open/edit/tag/delete a reel in the detail modal, confirming the new section dividers render and delete still works without a 404) → `/app/widgets` (header "Create widget" button opens a modal with the template picker and its new icons; create one of each template kind; open/edit/target/featured-reel-or-reels/delete a widget). Confirm `<s-app-nav>` renders as Shopify's actual sidebar entries (this needs a live embedded-admin session — flag for the user if not available in your environment, same limitation as the prior redesign's final review).

- [ ] **Step 5: Commit (only if Steps 1-3 required a fix)**

If nothing needed fixing, skip committing — this task is verification-only.
