# Widget appearance & behavior customization (theme-editor settings)

## Problem

Every visual and behavioral detail of the five storefront blocks
(Product page reels, Single video, Stacked carousel, Insta-style
stories, Reel pops) is currently hardcoded in shared CSS/JS: play-icon
color, corner radius, trigger size, story ring color, add-to-cart
button color/label, autoplay behavior, mute default, loop, story
auto-advance timing, reel-pop's screen corner, and its arrival pulse.
Merchants have no way to make a widget match their brand or behave the
way they want without editing code.

## Non-goals

- No changes to the app's admin UI (Reels/Widgets pages) and no Prisma/
  metafield changes. Business logic (which reels show where — targeting,
  featured reel, curated reel list) is unaffected; this is purely
  additive Theme Editor settings on top of the existing rendering.
- No settings that only make sense as app-admin config (that's the
  existing targeting/curation system). This spec is scoped to
  appearance + interaction behavior, settable per block placement in
  the Theme Editor with live preview — matching how every other Shopify
  theme app extension exposes customization.
- No redesign of the existing visual language (hover/hover states,
  scroll-snap, spacing) shipped in the prior storefront-polish pass —
  settings *parameterize* those defaults, they don't replace them. Every
  setting's default reproduces today's hardcoded look exactly, so a
  block with no settings touched renders identically to before this
  change.
- No settings requiring a network request or additional data (e.g. no
  "pick from theme's brand color palette" — Shopify's `color` schema
  setting type already gives merchants a native color picker).

## Design

### Why this can't be pure CSS-variable inheritance

The natural approach — set CSS custom properties on each block's own
wrapper `<div>`, let the shared stylesheets consume them via `var()` —
works for the **trigger** (thumbnail/avatar/bubble), which stays inside
the block's own DOM subtree. It does **not** work for the lightbox or
story viewer: both are constructed once and appended straight to
`document.body` (`reel-lightbox.js` line 29, `reel-story.js`
equivalent) the first time they're needed, and reused for every
subsequent open. They are not descendants of any block wrapper, so CSS
custom properties scoped to a block's wrapper never reach them. Two
block instances with different button colors on the same page (e.g. a
blue Product page reels row and a green Reel pops bubble) would
otherwise both render the last-opened color.

**Resolution:** trigger-level settings (corner style, accent color,
size) use plain CSS custom properties on the wrapper — no JS involved.
Viewer-level settings (button color/label, price visibility, title
overlay, mute/loop defaults) are serialized onto the *trigger's*
`data-*` attributes (the same mechanism already carrying
`data-hls-src`/`data-poster-url`/etc.), and `reel-lightbox.js`/
`reel-story.js` copy them onto the dialog element's inline style /
text content at open time, immediately before showing it. This makes
each open() call self-contained regardless of which block or how many
differently-configured instances exist on the page.

### Settings list

**Trigger — shared block setting group, present on all 5 blocks**
(CSS vars set inline on the block wrapper; consumed via `var(--reelup-x,
<current-hardcoded-default>)` in the shared stylesheets so an
unconfigured block is pixel-identical to today):

| Setting id | Type | Options / range | CSS var | Default |
|---|---|---|---|---|
| `corner_style` | select | `sharp` (0px) / `rounded` (12px, current) / `soft` (20px) | `--reelup-corner-radius` | `rounded` |
| `accent_color` | color, **no default (blank allowed)** | — | `--reelup-accent-color` | blank |
| `trigger_size` | range | 120–320px, step 10 (px meaning is block-specific: item width for Product page reels/Stacked carousel, avatar diameter for Stories, bubble diameter for Reel pops; Single video keeps its own `max-width` setting instead, see below) | `--reelup-trigger-size` | current per-block hardcoded value |

`accent_color` recolors three surfaces that each have a *different*
current hardcoded color today (play-icon backdrop `rgba(0,0,0,0.55)`,
story ring `#e1306c`, reel-pop pulse `rgba(255,255,255,0.5)`). A single
literal default couldn't reproduce all three, so the setting itself
defaults to blank and the block only emits the `--reelup-accent-color`
inline style when the merchant actually picks a color (`{% unless
block.settings.accent_color == blank %}`). Left untouched, each surface
keeps its own current color via its own `var(--reelup-accent-color,
<that surface's current value>)` fallback; once set, one accent color
applies uniformly across all three — a deliberate "brand accent"
control, not three independent color pickers.

Single video is the one block where "trigger size" means the whole
block's max-width (it's not a row of items), so it gets its own
`video_max_width` range setting (240–480px) instead of reusing
`trigger_size`.

**Viewer — shared setting group, present on all 5 blocks** (serialized
to `data-cta-color`, `data-cta-text-color`, `data-cta-label`,
`data-show-price`, `data-show-title` on the trigger; read by
`reel-lightbox.js`/`reel-story.js` at open time):

| Setting id | Type | Default |
|---|---|---|
| `cta_color` | color | `#111111` (current add-to-cart bg) |
| `cta_text_color` | color | `#ffffff` |
| `cta_label` | text | blank → falls back to the existing `reels.add_to_cart` translation, exactly as today |
| `show_price` | checkbox | true (current behavior) |
| `show_title_overlay` | checkbox | true (current behavior) — Product page reels/Stacked carousel don't render a title overlay today so this only affects Single video/Stories/Reel pops, which do |

**Behavior — shared where applicable:**

| Setting id | Type | Applies to | Default |
|---|---|---|---|
| `autoplay_mode` | select: `click` / `hover_preview` | Product page reels, Stacked carousel | `click` (current) |
| `muted_default` | checkbox | all | false (current — video opens with sound) |
| `loop` | checkbox | all | false (current) |
| `story_duration` | range, 5–30s | Insta-style stories only | 15 (current `DURATION_MS`) |

**Reel pops only:**

| Setting id | Type | Default |
|---|---|---|
| `position` | select: `bottom_right` / `bottom_left` / `top_right` / `top_left` | `bottom_right` (current) |
| `show_pulse` | checkbox | true (current) |

**Content:**

| Setting id | Type | Applies to | Default |
|---|---|---|---|
| `heading` | text | Product page reels, Stacked carousel, Insta-style stories | blank → no heading rendered (current — none of these render a heading today) |

### Data flow per block

1. Merchant edits a block's settings in the Theme Editor.
2. The block's `{% schema %}` gains a `settings` array with the entries
   above (scoped to what's relevant for that block kind).
3. The block's root wrapper gets an inline `style` attribute setting
   the CSS custom properties (`--reelup-corner-radius`,
   `--reelup-accent-color`, `--reelup-trigger-size` or equivalent).
4. Every `data-reelup-trigger` element additionally carries
   `data-cta-color`, `data-cta-text-color`, `data-cta-label`,
   `data-show-price`, `data-show-title`, `data-muted-default`,
   `data-loop`, and (Product page reels/Stacked carousel only)
   `data-autoplay-mode`.
5. `reel-lightbox.js`/`reel-story.js`, at open time, read these
   attributes off the clicked trigger and apply them to the dialog:
   inline `style="--reelup-cta-color: ...; --reelup-cta-text-color: ..."`
   on the dialog root, `video.muted`/`video.loop` set directly,
   product price/title elements toggled via existing hidden-attribute
   patterns, and the add-to-cart button's `textContent` set from
   `data-cta-label` when non-blank.
6. Reel pops' `position` setting maps to one of four fixed CSS classes
   (`.reelup-pop--bottom-right`, etc.) applied to the embed's root
   `<div>`, replacing the current single hardcoded `right: 20px; bottom:
   20px`.

### Stylesheet changes

Every hardcoded value the settings list above overrides gets rewritten
as `var(--reelup-x, <current value>)` in the relevant shared CSS file
(`reel-lightbox.css` for the trigger/button rules, `reel-story.css` for
the stories ring, `reel-pop.css` for the pulse/position). The fallback
is always today's literal value, so any block that hasn't had its
settings touched renders byte-for-byte the same as before this project
— satisfies the non-goal above without a migration or version flag.

### Testing

- Manual Theme Editor pass per block: change each new setting, confirm
  live preview updates and the storefront (after publish) matches.
- Two-instances-on-one-page check: place two blocks with different
  `cta_color`/`accent_color` values on the same product page, open
  each, confirm neither leaks the other's styling — this is the
  scenario the data-attribute approach (vs. pure CSS inheritance)
  exists to fix, so it's the one regression that actually matters here.
- `prefers-reduced-motion` and focus-visible states added in the prior
  polish pass must keep working regardless of `accent_color`/
  `corner_style` values (verify focus ring and pulse still render,
  just recolored/reshaped).
- No unconfigured block may visually change — spot check one instance
  of each of the 5 blocks with zero settings touched against a
  before-this-change screenshot/description.
