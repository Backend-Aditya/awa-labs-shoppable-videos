# Admin Panel Production Readiness — Design

**Date:** 2026-08-06

## Problem

A senior-engineer review of the admin panel (`/app/reels`, `/app/widgets`, `/app/settings`) found the app is a functional demo, not production-usable software. Four gaps block real merchant use:

1. **No product-tagging UI.** `productIds: []` is hardcoded at both reel-creation call sites (`app/routes/app.reels.tsx:32,78`). Nothing in the app ever writes to this field after creation. The storefront widget (already shipped) only renders reels that appear in a product's `metafields[...].reels` list — so no reel can ever appear on any product page through this app's UI, regardless of how well upload/playback work.
2. **No reel status visibility.** The reels table shows only Title + Published/Draft. A reel mid-upload, a reel whose Cloudflare transcode failed, and a reel that's fully playable render identically. Merchants can't tell if a video "worked."
3. **No edit/delete UI.** `deleteReel` exists server-side (wired only into upload-failure cleanup) but is never exposed to a merchant. Once created, a reel — typo and all — is permanent. Same for widgets.
4. **Upload is unrecoverable and invisible when it fails.** A dropped connection or closed tab mid-upload leaves a reel permanently stuck as an invisible draft: a metaobject exists, `cloudflareStreamUid` never populates, no cleanup path, no "this failed, retry or delete" affordance.

## Goal

Make the Reels admin surface production-usable: a merchant can tag a reel to product(s), see its real status at a glance, edit or delete any reel, and recover from a failed/stuck upload — all without touching Shopify's raw metafield editor or server logs.

## Non-Goals (explicit)

- Pagination beyond the current `listReels(admin, 50)` cap — real work, separate plan.
- Widget edit/delete UI — same shape as reel edit/delete, deliberately deferred to a follow-up plan so this one stays focused.
- Settings page becoming a real settings surface (Cloudflare connection status, billing) — separate plan.
- Resumable/chunked upload, upload progress percentage, client-side file-size/duration validation — real infra work, not an admin-UI gap. This plan makes a stuck upload *visible and deletable*, not *automatically resumed*.
- Custom confirmation modal for delete — native `confirm()` is sufficient for this scope.

## Architecture

### New route: reel detail page

`app/routes/app.reels.$id.tsx` — a per-reel detail page (Shopify admin's standard "click a row → detail page" pattern). Handles:
- Edit title / published toggle (reuses existing `upsertReel`).
- Product tagging via Shopify's native `ResourcePicker` (App Bridge, client-side `shopify.resourcePicker({ type: 'product', multiple: true })`), writing selected product GIDs into `config.productIds` via `updateReelConfig`.
- Displaying currently-tagged products by name (a small Admin GraphQL lookup by ID list).
- Delete button (confirm() then `deleteReel`, redirect to `/app/reels`).
- Status badge (see below).

No new Shopify API scope needed — `write_products` (already granted) implies read access for the resource picker's product search.

### Status model (derived, not stored)

A reel's displayed status is computed from existing `ReelConfig` fields — no new required field:

| Status | Condition |
|---|---|
| `Draft` | No `cloudflareStreamUid` set (reel created but no upload ever started, or manually created without upload) |
| `Uploading` | Upload flow started (see below) but no `cloudflareStreamUid` yet |
| `Processing` | Has `cloudflareStreamUid`, no `hlsManifestUrl` yet (upload landed at Cloudflare, transcode webhook hasn't fired) |
| `Ready` | Has `hlsManifestUrl` |
| `Failed` | Has `uploadFailedAt` set (new optional field) and no `cloudflareStreamUid` |

**New field:** `ReelConfig.uploadFailedAt?: string` (ISO timestamp) — set when the browser-side upload PUT to Cloudflare's `uploadURL` fails (already-detected client-side in `app.reels.tsx`'s upload effect; currently just sets local React state and discards the information). Persisting it via a new `updateReelConfig` call turns a client-side-only failure into a durable, mechanant-visible status instead of vanishing on page refresh — this is the one piece of new persisted state in this plan, and it directly closes gap #4 (make a stuck upload visible).

Note: `Uploading` is inherently soft — if a merchant closes the tab mid-upload before the failure branch fires, the reel is left in `Uploading` forever with no `uploadFailedAt` written (nothing ran to write it). This is accepted as a known limitation, not silently hidden: the reel is still visible in the list with an `Uploading` badge, and — critically, unlike today — the merchant can now delete it themselves rather than it being invisible. A "stale uploading reel" auto-expiry job is out of scope (needs a background job runner this app doesn't have).

### List page changes (`app.reels.tsx`)

- Add a Status column (badge, tone mapped per table above).
- Make each row a link to `/app/reels/$id`.
- Row-level Delete stays on the detail page only (keeps the list table simple; delete is a deliberate action, one click away).

### Widgets page

Unchanged in this plan (explicit non-goal) — the same edit/delete/status pattern applies there but is scoped to a follow-up plan to keep this one shippable.

## Testing

- `updateReelConfig`'s existing test coverage extends to the new `uploadFailedAt` field (partial-merge behavior already tested; just confirm the new field passes through the same partial-merge path — no new model logic).
- Product-tagging write path (`config.productIds` update via `updateReelConfig`) gets a model-layer test.
- No new route-level tests are introduced as a blanket policy fix — that's a separate, larger testing-infrastructure gap (zero admin route tests exist today) not solved by this plan alone; each task adds a model-layer test for its own new/changed server logic, consistent with this project's existing pattern of testing `.server.ts` files, not routes.

## Self-Review

**Placeholder scan:** none.

**Internal consistency:** Status table matches `ReelConfig` fields exactly as they exist today (`cloudflareStreamUid`, `hlsManifestUrl`) plus the one new field (`uploadFailedAt`), which is defined once and used consistently in both the model and the status-derivation logic.

**Scope check:** Focused — one route added, one route modified, one model field added, one model function's config surface extended. Widget parity explicitly deferred rather than silently expanded into.

**Ambiguity check:** "Failed" status requires `uploadFailedAt` AND absence of `cloudflareStreamUid` (not just presence of the timestamp alone) — stated explicitly so a reel that failed once, was retried, and later succeeded doesn't get mislabeled Failed forever from a stale timestamp. (Note: this plan does not add a "clear uploadFailedAt on retry" flow since there's no retry-upload UI in this plan's scope — a Failed reel's path to Ready is: merchant deletes it and creates a new one. Retry-in-place is deferred with the rest of upload resilience.)
