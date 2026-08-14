# Admin panel redesign: Polaris web components → Tailwind

## Problem

The admin panel (`app/routes/app.tsx`, `app._index.tsx`, `app.reels.tsx`,
`app.widgets.tsx`) is built on Shopify Polaris web components (`s-page`,
`s-section`, `s-button`, `s-modal`, etc.) with scattered inline `style={}`
objects for anything Polaris doesn't cover. It works, but looks generic
and inconsistent in spots — not a deliberate visual system.

The ask: rebuild it as a clean, minimal, professional-feeling tool —
functionality unchanged, presentation redone from scratch with a real
design system instead of a component library's defaults plus inline
patches.

## Non-goals

- No change to any loader/action/fetcher logic. Every route's data layer
  (`app/models/*.server.ts`) and route handlers stay exactly as they are —
  this is a markup + styling rebuild only.
- `app/routes/app.reels.$id.tsx` and `app.widgets.$id.tsx` (the original
  detail routes, superseded by the popup-modal pattern built earlier in
  this project, only reachable by typing the URL directly) are out of
  scope. They're not part of the active UI.
- No new features. Same forms, same actions, same data — different look.

## Design system

### Tokens

Restrained color strategy (product register: this is a task tool, not a
marketing surface — earned familiarity over decoration). All colors in
OKLCH, defined once in `app/tailwind.css` under `@theme`:

```css
--color-bg: oklch(1 0 0);                 /* pure white */
--color-surface: oklch(0.97 0.004 200);   /* cards, panels, nav */
--color-ink: oklch(0.18 0.01 200);        /* body text, ~15:1 on bg */
--color-muted: oklch(0.55 0.012 200);     /* secondary text, ~4.6:1 on bg */
--color-border: oklch(0.90 0.006 200);
--color-primary: oklch(0.48 0.10 200);    /* steel-teal — buttons, links, focus rings */
--color-primary-ink: oklch(1 0 0);        /* white text on primary fills */
--color-accent: oklch(0.55 0.14 265);     /* indigo — secondary emphasis, selected state */
--color-success: oklch(0.55 0.13 145);
--color-success-bg: oklch(0.95 0.03 145);
--color-warning: oklch(0.65 0.15 80);
--color-warning-bg: oklch(0.96 0.04 80);
--color-critical: oklch(0.55 0.18 25);
--color-critical-bg: oklch(0.95 0.04 25);
```

Typography: one family (`system-ui` stack — matches product-register
permission to use familiar system fonts, and avoids a webfont load inside
an already-heavy embedded iframe). Fixed rem scale (this is a tool viewed
at consistent DPI, not a fluid marketing page): `text-xs` 12px, `text-sm`
13px, `text-base` 14px, `text-lg` 16px, `text-xl` 20px, `text-2xl` 24px —
ratio ≈1.15, tighter than a marketing scale, matching product.md guidance.

Spacing: Tailwind's default 4px scale, used directly — no custom spacing
tokens needed.

### Component primitives

New shared components under `app/components/ui/`, each with every
interactive state the product register requires (default, hover, focus,
active, disabled, loading where applicable):

- **`Button`** — variants `primary` / `secondary` / `critical` / `ghost`;
  supports `loading` (spinner + disabled, replaces Polaris's
  `{...(loading ? {loading:true} : {})}` spread pattern with a plain
  boolean prop).
- **`Card`** — a bordered, padded container (`bg-surface` or `bg-bg` with
  border, per context). Used sparingly per the product register's "cards
  are the lazy answer" guidance — the reel/widget grids use them because
  they genuinely are a card-shaped browsing UI; stat tiles and form
  sections do not need to be cards, they use plain sectioning instead.
- **`Modal`** — replaces `s-modal`. Built on the native `<dialog>` element
  (`showModal()`/`close()`), for accessible focus-trapping and ESC/
  backdrop-dismiss for free. Exposes an imperative ref with `show()`/
  `hide()` methods, matching the existing `modalRef.current?.showOverlay()`
  /`hideOverlay()` call sites in `app.reels.tsx`/`app.widgets.tsx` — those
  call sites only need their two method names updated, not their
  surrounding logic.
- **`TextField`** — labeled text input, error-state styling.
- **`Checkbox`** — labeled checkbox, used for Published toggles and the
  multi-select "Choose reels" list.
- **`Select`** — labeled native `<select>`, styled consistently with
  `TextField`.
- **`Badge`** — status pill (color driven by a `tone` prop: `success` /
  `warning` / `critical` / `neutral`), replaces the ad hoc `PlainBadge`
  components and inline-styled `<span>` badges currently duplicated in
  both `app.reels.tsx` and `app.widgets.tsx`.
- **`PageShell`** — top nav bar (replaces `s-app-nav`) + page heading
  region (replaces `s-page heading=...`), used once in `app.tsx` for the
  nav and once per route for the heading.
- **`StatTile`** — the label+number tiles already present in both list
  pages (currently two near-duplicate implementations) — consolidated
  into one shared component.

### Page-by-page

- **`app.tsx`**: `PageShell`'s nav bar — a left-aligned horizontal set of
  links (Home, Reels library, Widgets, Settings), current route
  highlighted with the primary color, still wrapping `<Outlet />`. The
  `AppProvider embedded` wrapper stays (App Bridge still needs it) — only
  the nav markup inside changes.
- **`app._index.tsx`**: stat tiles (reels/widgets/plan) + the two
  nav-cards, rebuilt as `Card`s with hover state instead of the current
  raw `<div>`+inline-style nav cards.
- **`app.reels.tsx`**: create-reel form, upload form, and the reel grid,
  rebuilt with the new primitives; `ReelDetailModal` rebuilt on the new
  `Modal` component, same fetcher wiring, same three sub-sections
  (edit/tag-products/delete).
- **`app.widgets.tsx`**: template picker gallery, widget grid, and
  `WidgetDetailModal` (edit/target/featured-reel/choose-reels/delete),
  same treatment.

## Testing

No new automated tests — this is a pure presentation change over
already-tested data logic. Verification is manual: run the app, exercise
every fetcher-driven action (create, edit, publish toggle, target
picker, featured-reel picker, choose-reels picker, delete) on both Reels
and Widgets, confirm each still works and the modal opens/closes
correctly via the new `Modal` component.

## Out of scope

- `app.reels.$id.tsx` / `app.widgets.$id.tsx` (legacy detail routes).
- Storefront extension files (`extensions/`) — unrelated surface, already
  redesigned separately in prior work this session.
- Any new admin functionality beyond what already exists.
