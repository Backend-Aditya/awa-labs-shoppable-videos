# Rebuild admin on Shopify Polaris web components

## Problem

The admin app currently renders on a custom Tailwind CSS design system
(built across two prior redesigns this project). The request is to move
back to Shopify's own Polaris web components (`s-page`, `s-modal`,
`s-button`, etc.) — the framework the app originally used before either
Tailwind redesign — while **keeping every UX improvement** made since:
the wider dashboard layout, the page-header "Create" action pattern, the
unified reel create+upload form, the richer widget cards, and the
sectioned detail modals.

## Non-goals

- No loader/action/business-logic changes anywhere — this is markup-only,
  same discipline as every prior redesign this session.
- No pixel-matching the current Tailwind visuals. Per explicit
  confirmation: bespoke effects with no direct Polaris equivalent
  (gradient title overlay on reel thumbnails, custom SVG template icons,
  hover-elevate card animation, custom circular avatar crops) are
  replaced by Polaris's own native equivalents, not recreated by hand.
- `app/routes/app.reels.$id.tsx`, `app.widgets.$id.tsx`, and
  `app.settings.tsx` stay out of scope, as in every prior redesign.
- `app/routes/app.tsx` is **already** on Polaris (`<s-app-nav>`,
  untouched by any Tailwind redesign) — no change needed there.

## Design

### Verified current API (not assumed from memory)

The custom Tailwind rebuild replaced an *earlier* Polaris implementation
that used a ref-based `modalRef.current?.showOverlay()`/`.hideOverlay()`
pattern. Live documentation lookup (`shopify-dev-mcp`, `polaris-app-home`
API, current version) confirms the **current** mechanism is different —
this plan uses the confirmed-current API, not the old ref pattern:

- **Opening a modal**: a `<s-button command="--show" commandFor="modal-id">`
  — the browser-native Invoker Commands pattern Shopify's web components
  adopt. Requires a real user gesture (Shopify's own docs: "Modals can
  only be opened by user interaction, not programmatically on page
  load").
- **Closing a modal**: either the same declarative pattern
  (`command="--hide"` on a button inside the modal, e.g. a Cancel/Close
  button) for user-driven closes, or — for *programmatic* closes (e.g.
  auto-closing the create-reel modal after a successful upload) — the
  App Bridge Modal API via `useAppBridge()`: `shopify.modal.hide(id)`.
  Only opening is gesture-restricted; hiding is not.
- **Syncing React state on close** (so `selectedReelId`/`isCreateOpen`
  reset regardless of *how* the modal closed — X button, backdrop, ESC,
  or the programmatic auto-close above): the modal's `onHide` event prop
  (confirmed via docs: the component fires a `hide` DOM event, exposed
  to React as `onHide`).
- **Page header actions**: `<s-page heading="...">` supports named slots
  — `slot="primary-action"` (one `s-button`) and `slot="secondary-actions"`
  — confirmed via docs. The "Create reel"/"Create widget" buttons move
  into `slot="primary-action"`.

### Component mapping

| Current (Tailwind) | Polaris replacement |
|---|---|
| `PageShell` (heading/description/actions) | `<s-page heading="...">`, description as an `<s-paragraph tone="subdued">` inside the first section, actions via `slot="primary-action"` |
| `StatTile` | `<s-box padding="base" background="subdued" borderRadius="base"><s-stack gap="small-200"><s-text color="subdued">label</s-text><s-heading>value</s-heading></s-stack></s-box>` — this exact composition already proven working in this project's pre-Tailwind code |
| `Card` / `CARD_INTERACTIVE_CLASSES` (reel/widget grid cells) | `<s-clickable>` as the primary choice (a native Polaris interactive container); if MCP validation rejects an attribute on it, fall back to a `<s-button variant="tertiary">` wrapping the row content — both achieve the same "clickable card" role |
| `Modal` (custom) | `<s-modal>` directly, per the verified API above — the custom wrapper component is deleted entirely, no replacement abstraction needed |
| `Button` | `<s-button variant="primary\|secondary\|tertiary" tone="critical" loading={bool}>` |
| `TextField` | `<s-text-field label name defaultValue required>` |
| `Checkbox` | `<s-checkbox label name defaultChecked>` |
| `Select` + native `<option>` | `<s-select label name required><s-option value>...</s-option></s-select>` |
| `Badge` | `<s-badge tone="success\|warning\|critical\|info\|neutral">` |
| Custom CSS grid (`grid-template-columns: repeat(auto-fill, minmax(...))`) | `<s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">` — Polaris's grid component forwards the value straight to CSS |
| Custom SVG template icons (widgets) | Dropped — Polaris has no equivalent slot for custom per-item SVGs in this composition; the template picker instead relies on the name + description text, which is what the very first pre-Tailwind version did |
| Gradient overlay reel-card caption | Dropped — the reel title renders as plain text below the thumbnail (`s-thumbnail` or a plain `s-image`), same information, Polaris's own visual language |

### Modal-driven forms keep their exact current behavior

The unified reel create+upload form (title + published + required video
file, one submission, auto-closes on success) and the sectioned detail
modals (preview/status → edit → tag-products/target/featured-reel/reels
→ delete) keep their **exact current field set, fetcher wiring, and
section order** — only the JSX tags change from `<div>`/Tailwind classes
to Polaris equivalents (`<s-stack gap="base">` for vertical stacks,
`<s-box>`/plain `<hr>`-equivalent... Polaris has no divider primitive in
this catalog, so section breaks use `<s-divider>`, confirmed present in
the component catalog). All the load-bearing comments (the `armedRef`
upload guard, the delete-form race-condition fix, the `e instanceof
Response` rethrow) transfer verbatim — this is a markup change, not a
logic change.

### Tailwind removal

Once every screen is back on Polaris, nothing references Tailwind:
- Uninstall `tailwindcss` and `@tailwindcss/vite` from `package.json`.
- Delete `app/tailwind.css`.
- Revert `app/root.tsx`'s Tailwind import and `font-sans`/Tailwind body
  classes back to the pre-Tailwind version (plain `<html>`/`<body>`, no
  stylesheet import needed — Polaris web components carry their own
  styling).
- Delete `vite.config.ts`'s `@tailwindcss/vite` plugin registration.
- Delete every file under `app/components/ui/` (`Badge.tsx`, `Button.tsx`,
  `Card.tsx`, `Checkbox.tsx`, `Modal.tsx`, `PageShell.tsx`, `Select.tsx`,
  `StatTile.tsx`, `TextField.tsx`) — none of them are needed once every
  route is on native Polaris tags.

## Verification discipline (why this plan is different from prior ones)

Shopify's Polaris web components are the one part of this codebase with
a real, versioned, externally-maintained API surface that can't be
verified just by reading this repo's own git history. Every task in the
implementation plan that emits Polaris component JSX **must** call
`mcp__shopify-dev-mcp__learn_shopify_api` (api: `polaris-app-home`) to
get its own conversation id, then
`mcp__shopify-dev-mcp__validate_component_codeblocks` on its final code
before committing — iterating on any reported error — rather than
trusting hand-written/remembered component props. This is the tool's own
stated mandatory usage, and it's how this spec's own API claims above
were verified rather than assumed.

## Testing

No automated UI test suite exists (same as every prior admin redesign).
Verification is `npm run typecheck` / `npm run lint` / `npm run build`
staying clean, the MCP validation above, and a manual click-through of
every fetcher-driven action (create with upload, edit, publish toggle,
target/featured-reel/reels pickers, delete) on both Reels and Widgets,
confirming modals open/close correctly via the new native `<s-modal>`
mechanism.

## Out of scope

- `app.reels.$id.tsx` / `app.widgets.$id.tsx` / `app.settings.tsx`.
- `app.tsx` (already Polaris, untouched).
- Storefront extension files.
- Any new admin functionality.
