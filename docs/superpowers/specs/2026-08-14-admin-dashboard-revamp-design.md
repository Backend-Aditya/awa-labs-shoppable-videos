# Admin dashboard revamp: restore Shopify sidebar nav + spacious dashboard layout

## Problem

The previous redesign (`docs/superpowers/specs/2026-08-14-admin-tailwind-redesign-design.md`)
replaced Shopify's `<s-app-nav>` with a custom top nav bar rendered
inside the app's own iframe. That was a functional regression: `<s-app-nav>`
is the mechanism Shopify uses to populate the app's entry in the admin's
own left sidebar — a top bar inside the iframe is not a substitute, it's
a second, redundant nav that never touches Shopify's real chrome.

Separately, the four screens (Home, Reels library, Widgets, both detail
modals) currently render in a narrow, tightly-spaced centered column
(1024px max-width) that reads more like a settings form than a
production dashboard.

This spec covers restoring the sidebar integration and reworking layout
density/spacing/component polish across the same four screens — no new
pages, no color changes, no loader/action changes.

## Non-goals

- No change to any loader/action/fetcher logic — markup/CSS only, same
  constraint as the prior redesign.
- No new screens or features.
- No palette change — the steel-teal OKLCH token system
  (`app/tailwind.css`) stays as-is.
- `app/routes/app.reels.$id.tsx` and `app.widgets.$id.tsx` stay out of
  scope, as before.

## Design

### 1. Navigation: restore `<s-app-nav>`

`app/routes/app.tsx` gets `<s-app-nav>` back, with the same four
`<s-link>` entries it had before the Tailwind redesign (Home, Reels
library, Widgets, Settings). `app/components/ui/AppNav.tsx` (the custom
top bar built in the prior redesign) is deleted along with its usage —
Shopify's sidebar is the only nav surface now, so an in-page duplicate
adds confusion, not value. `<AppProvider embedded apiKey={apiKey}>` still
wraps `<s-app-nav>` and `<Outlet />`, matching the original pre-Tailwind
structure exactly (this is the one Polaris web component staying in the
app, since it's Shopify's actual sidebar-registration API, not a styled
UI element).

### 2. Layout system: `PageShell` becomes a real dashboard shell

Current `PageShell` (`app/components/ui/PageShell.tsx`): `max-w-5xl`
(1024px), single `<h1>`, `flex flex-col gap-6` content stack.

New `PageShell`:
- Width: `max-w-[1400px]` with fluid horizontal padding
  (`px-6 lg:px-10`), so it reads as a wide dashboard on desktop while
  staying usable at the ~900px embedded-admin iframe width Shopify
  typically gives an app.
- **Page header pattern**: title + optional short description on the
  left, an optional `actions` slot (React node) on the right for a
  primary button — e.g. Reels library's "Create reel" and Widgets'
  "Create widget" move from a mid-page form section header into the page
  header's action slot as a button that reveals the create form (see
  §4).
- Content rhythm: `gap-10` between major sections (was `gap-6`), each
  section still using its own internal spacing.

### 3. Stat tiles: bigger, grid-based

`StatTile` grows from a `min-w-[140px]` flex-wrap item to a proper grid
cell: bigger value text (`text-3xl`, was `text-2xl`), more internal
padding (`p-5`, was `p-4`), and the pages lay them out with
`grid grid-cols-2 lg:grid-cols-4 gap-4` instead of `flex flex-wrap
gap-4` — so on a wide dashboard the tiles align into clean columns
instead of wrapping arbitrarily.

### 4. Page header actions replace inline "Create" sections

Reels library and Widgets currently show their create-form as a
permanently-visible section between the stats and the list. That's a lot
of permanent vertical space for an action used occasionally. New
pattern: the page header's action slot has a "Create reel" / "Create
widget" `Button`; clicking it opens the existing create form inside the
existing `Modal` component (already built) instead of inline — reusing
`Modal`, no new primitive needed. This directly serves "more spacious":
the list is the first thing visible under the stats, not a form.

### 5. Cards: real elevation, bigger thumbnails

`CARD_INTERACTIVE_CLASSES` (in `app/components/ui/Card.tsx`) gets a
proper hover elevation (`hover:shadow-md hover:-translate-y-0.5
transition` alongside the existing border-color hover) instead of only a
border-color change. Reel/widget card thumbnails grow from `h-[140px]`
to `h-[180px]` (reel poster) — more visual weight per card on a wider
grid. Grid columns widen accordingly:
`grid-cols-[repeat(auto-fill,minmax(260px,1fr))]` (was `220px`) so cards
have more room to breathe at the new page width.

`TemplatePicker`'s placeholder block (`h-14 rounded-md bg-surface`) gets
a centered icon glyph per template kind (simple inline SVG or emoji-free
Unicode glyph, keeping with the "no flashy design" brief — a plain
geometric icon, not an illustration) instead of a flat empty rectangle,
so the picker reads as designed rather than unfinished.

### 6. Modal: wider, sectioned

`Modal` grows from `max-w-lg` (512px) to `max-w-2xl` (672px), header
padding increases slightly (`px-6 py-5`, was `px-5 py-4`), and body
padding increases to `px-6 py-6` (was `px-5 py-4`). Within
`ReelDetailModal`/`WidgetDetailModal`, the existing stacked sections
(preview/status, edit form, tag-products or target/featured-reel/reels,
delete) get a `border-t border-border pt-6` divider between each
section (currently just a flex gap) so the modal reads as distinct
panels rather than one long unbroken form.

## Testing

Same as the prior redesign: no automated UI test suite exists
(`npm run typecheck` / `npm run lint` / `npm run build` are the
automated gates). Manual verification: confirm `<s-app-nav>` renders in
Shopify's actual sidebar (requires a live embedded-admin session — flag
for the user to verify, same limitation noted in the prior redesign's
final review), and click through create/edit/delete flows on both Reels
and Widgets to confirm the modal-based create flow and all existing
fetcher actions still work.

## Out of scope

- `app.reels.$id.tsx` / `app.widgets.$id.tsx` (legacy detail routes).
- `app.settings.tsx` (still Polaris, not touched by either redesign).
- Storefront extension files.
- Any palette/token change.
