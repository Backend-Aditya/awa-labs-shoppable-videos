# Admin: Video Preview + Widget Parity — Design

**Date:** 2026-08-07

## Problem

Follow-up feedback after the first production-readiness pass: the admin still feels "complicated and non-functional" in three specific ways.

1. **No video preview.** A merchant can upload a video and see it go `Ready`, but nowhere in the admin can they actually watch it. `cloudflareStreamUid`/`posterUrl`/`hlsManifestUrl` are all stored and correct — nothing renders them as a player.
2. **Product tagging is invisible from the list.** Tagging itself works (built in the prior plan, on the `/app/reels/$id` detail page) — the gap is discoverability: the reels list gives no hint that clicking a row leads anywhere useful for tagging, so a merchant reasonably assumed the feature didn't exist.
3. **Widgets are still create/list-only.** `deleteWidget`/`setWidgetPublished` already exist in `widget.server.ts`, built in the Foundation plan, never wired to any UI. There's no edit, no delete, no real targeting — `targetRule` is hardcoded to `{ type: "all_products" }` at creation and never touched again.

## Goal

Close all three: a merchant can watch an uploaded video from the admin, can tell from the reels list that tagging is one click away, and can manage widgets (edit, delete, target specific products) with the same level of function reels just got.

## Non-Goals (explicit)

- No custom hls.js player for admin preview — Cloudflare's own iframe embed is used instead (see Architecture). The storefront's custom player (no-iframe, for performance) is a different, already-shipped concern; admin preview has no such constraint.
- No widget "template style" editor, no per-widget-type-specific settings UI beyond targeting — `templateStyle` stays whatever was set at creation.
- No bulk actions (bulk delete, bulk publish) on either reels or widgets list.
- No change to `WidgetConfig`'s shape — `targetRule: { type: "all_products" } | { type: "handles", handles: string[] }` already exists and is sufficient; this plan only wires UI to it.

## Architecture

### Reel video preview

On `/app/reels/$id`, add a "Preview" section above the existing "Details" section. When `reel.config.cloudflareStreamUid` is set, render:

```html
<iframe src="https://iframe.videodelivery.net/{cloudflareStreamUid}" style="border:none;aspect-ratio:9/16;width:100%;max-width:280px" allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture" allowfullscreen></iframe>
```

Cloudflare's iframe embed handles playback (HLS/DASH negotiation, controls, poster) internally — no client JS, no vendored library, no lazy-load logic needed for an admin-only, single-instance-per-page embed. When `cloudflareStreamUid` is absent, render a static placeholder ("No video uploaded yet").

### Tagging discoverability

Reels list (`app.reels.tsx`) gains a "Products" column: `reel.config.productIds.length` reels shown as `"{n} tagged"` or `"Untagged"` (badge, neutral tone). This requires no new data — `productIds` is already loaded via `listReels`. No change to the detail page's picker mechanics; only its section heading text changes for clarity ("Tagged products" → stays, but add a one-line hint paragraph above the picker button: "Click a product to remove it from this reel's storefront placement." — actually simpler: no interaction change needed there, the count column is the fix).

### Widget detail page + targeting

New route `/app/widgets/$id`, mirroring `/app/reels/$id`'s structure:
- Loader: `getWidget(shopId, id)` (new function) — 404 if not found or not owned by this shop.
- Action: `intent=update` (name edit + published toggle via `setWidgetPublished`... actually simpler: fold both into one `updateWidget` call), `intent=set-target` (product picker → `targetRule`), `intent=delete` (`deleteWidget`, redirect to `/app/widgets`).
- New model functions in `widget.server.ts`: `getWidget(shopId, id)`, `updateWidget(id, { name?, published? })`, `updateWidgetTargetRule(id, targetRule)`.
- Targeting UI: same `useAppBridge().resourcePicker({ type: "product", multiple: true })` pattern as reels, writing `{ type: "handles", handles: selected.map(p => p.handle) }` — note **handles**, not GIDs, since `WidgetConfig.targetRule`'s existing shape uses `handles: string[]`, not product IDs (this is a pre-existing, unmodified type — matching it, not changing it). A "Clear (target all products)" action resets to `{ type: "all_products" }`.
- Widgets list (`app.widgets.tsx`) gains a Published-status badge column and makes the Name cell a link to `/app/widgets/$id`, same pattern as reels' Task 2.

### Shared pattern note

Both new detail pages (reels' already exists; widgets' is new) now follow an identical shape: loader fetches by ID + 404s, action handles `update`/`set-X`/`delete` intents, component renders status/preview + edit form + picker + danger zone. This is a deliberate, now-established convention for this admin — not re-derived per entity.

## Testing

- `getWidget`/`updateWidget`/`updateWidgetTargetRule` get model-layer tests in `widget.server.test.ts` (new file — `widget.server.ts` currently has none; existing `createWidget`/`listWidgetsForShop` get baseline coverage added at the same time as a natural side effect of touching this file, not a separate goal).
- No new route-level tests (consistent with the project's existing, previously-established pattern — see prior plan's Testing section).
- Reel preview iframe and Products-count column: no new model logic, so no new tests — purely presentational, reading existing fields.

## Self-Review

**Placeholder scan:** none.

**Internal consistency:** `targetRule`'s `handles: string[]` shape (pre-existing, in `widget.server.ts:15`) is used as-is; the design explicitly calls out that the picker returns `handle` (not `id`) for this field, to prevent a Task implementer from copying reels' `productIds: string[]` (GID-based) pattern verbatim and silently writing the wrong value type.

**Scope check:** Three sub-features (preview, list-column, widget-parity), but all small and touching non-overlapping files except the shared detail-page pattern — appropriately one plan, not a decomposition case.

**Ambiguity check:** "Clear targeting" resets to `all_products` explicitly stated, since `handles: []` (empty array) vs `{type: "all_products"}` are two different valid-but-different states in the existing type and could otherwise be conflated by an implementer.
