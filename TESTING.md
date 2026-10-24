# Testing

Automated tests for the admin app, the database layer and the theme app
extension (Liquid + storefront JS), plus a manual QA checklist for what
automation cannot reach.

## The pyramid

| Layer | Runner | Environment | Lives in | What it covers |
| --- | --- | --- | --- | --- |
| **unit** | Vitest project `unit` | node, no DB | `app/**/*.test.ts` (not `*.integration.test.ts`), `tests/unit/` | Pure logic: widget kinds/style sanitizing, brand kit, reel media/status, Cloudflare client (fetch stubbed), route actions with mocked models, client upload flow |
| **integration** | Vitest project `integration` | node, real Postgres, serial | `app/**/*.integration.test.ts` | Prisma models against a disposable database, incl. raw-SQL constraints (partial unique index) |
| **components** | Vitest project `components` | jsdom + Testing Library | `app/**/*.test.tsx` | Admin React components and hooks (widget editor controls, live preview, charts, editor guards) |
| **storefront** | Vitest project `storefront` | jsdom | `tests/storefront/` | `scripts/extension-assets-src/*.js` (the theme-extension runtime) loaded from SOURCE into jsdom with markup rendered from the real Liquid |
| **liquid** | Vitest project `liquid` | node + liquidjs | `tests/liquid/` | Blocks and snippets rendered with fixture shop/product/metafield data |
| **e2e** | Playwright (Chromium) | real browser | `tests/e2e/` | Shopper flows against a static storefront harness that serves the BUILT extension assets |

Shared helpers live in `tests/support/`:

- `test-database-url.mjs` — the test-database guard (see below).
- `liquid-engine.mjs` — liquidjs configured like Shopify (shims listed below).
- `storefront-fixtures.mjs` — builders for products, reels (metaobjects), widgets and shop metafields.
- `dom-setup.ts` / `integration-setup.ts` — per-project setup files.

## Running

```bash
npm run test:unit
npm run test:components
npm run test:storefront
npm run test:liquid
npm run test:fast          # the four above in one run
npm run test:coverage      # the four above with v8 coverage + thresholds → coverage/
npm run test:integration   # needs a test database (below)
npm run test:e2e           # builds extension assets, then Playwright
npm run test:all           # fast + integration + e2e
npm test                   # legacy: reads .env.test, migrates, runs every Vitest project
npm run test:watch         # Vitest watch mode
```

Single file or test: `npx vitest run --project storefront tests/storefront/cart.test.ts -t "variant"`.
Playwright UI: `npx playwright test --ui`; trace of a failure: `npx playwright show-trace test-results/<test>/trace.zip`.

### Integration tests and the database guard

Integration tests run unscoped `deleteMany()` calls, so the database URL
comes **only** from `TEST_DATABASE_URL` or `DATABASE_URL` in `.env.test`
(never `.env`), and must contain `schema=test` or point at a local host
(`localhost`, `127.0.0.1`, `postgres`, `db`). Anything else makes
`vitest.config.ts` refuse to load. Every other project gets an unreachable
`DATABASE_URL`, so a stray Prisma query there fails instead of reaching a
real database.

Local Postgres:

```bash
docker compose -f docker-compose.test.yml up -d --wait   # postgres:16, data in tmpfs
cp .env.test.example .env.test                            # once
npm run test:integration
docker compose -f docker-compose.test.yml down -v
```

Port 5432 busy? `TEST_DB_PORT=5433 docker compose -f docker-compose.test.yml up -d --wait`
and use port 5433 in `.env.test` (or `TEST_DATABASE_URL=...:5433/...`).

`npm run test:integration` runs `prisma generate`, `prisma migrate deploy`
against the test URL, then the `integration` project.

### E2E

`npm run test:e2e` runs `npm run build:extension` (which rewrites
`extensions/shoppable-video-widgets/assets/*.js` from the sources — don't
commit that output from a test run unless you meant to) and then
Playwright. `tests/e2e/server.mjs` serves:

- `/` — `tests/e2e/fixtures/storefront.html` with the real blocks (app
  embed, filmstrip, stories, add-to-cart video) rendered by liquidjs, and
  their schema `stylesheet`/`javascript` added to `<head>` once, the way
  Shopify injects them;
- `/pages/plain` — the app embed alone, a page without widgets (checks
  that such pages load nothing but the loader);
- `/assets/*` — the built extension assets;
- `/media/sample.webm` — a 3 s clip (regenerate with
  `node tests/e2e/fixtures/make-sample-video.mjs`).

Shopify endpoints (`/cart/add.js`, `/cart.js`, recommendations, analytics)
are mocked per test with `page.route`. Headless Chromium has no native HLS,
so most specs replace `window.ReelupHls` (via `addInitScript`; `reel-hls.js`
returns early when it exists) with a bridge that plays the local WebM.
Specs whose title contains `@real-hls` keep the real bridge and exercise
the playback-error path. hls.js integration itself is unit-tested in
`tests/storefront/hls.test.ts`.

## Conventions

- **Naming:** `*.test.ts(x)` for Vitest, `*.integration.test.ts` for
  anything that needs the database, `*.spec.ts` for Playwright.
- **Placement:** app tests sit next to the code they cover; storefront,
  liquid, e2e and shared support live under `tests/`.
- **No real network.** Stub `fetch` (`vi.stubGlobal`) or use Playwright
  routes. Nothing may call Shopify, Cloudflare or any other host.
- **Time:** use fake timers (`vi.useFakeTimers({ toFake: [...] })`, only
  what you need) for delays, de-dupe windows and auto-advance; always
  restore with `vi.useRealTimers()` in `finally`/`afterEach`. Under fake
  `setTimeout`, settle promises with `vi.advanceTimersByTimeAsync(0)`, not
  a real-timer `flush()`.
- **Selectors:** query by role/label first, then `data-reelup-*`
  attributes. Avoid CSS classes and DOM shape, so markup refactors don't
  break tests. CSS-module class names in the `components` project are
  un-hashed (`.deckSlider` is `styles.deckSlider`).
- **Storefront harness** (`tests/storefront/harness.ts`): `resetPage()` in
  `beforeEach` clears the DOM, storage, run-once globals (`ReelupLightbox`,
  …) and every document/window listener a script added, re-installs the
  stubs (dialog modal API, media playback, `matchMedia` with a mutable
  `media` object, `IntersectionObserver`, `CSS.escape`, `fetch`,
  `window.ReelupHls`) and resets modules. `mount(html, scripts)` puts
  markup plus `[data-reelup-config]` on the page and runs the source
  scripts in theme order. Use `renderBlock()` to get real block markup.
- **Polaris `s-*` elements** are unknown elements in jsdom; assert on their
  attributes and text. Mock `@shopify/app-bridge-react` and `react-router`
  hooks with `vi.mock` (see `useEditorGuards.test.tsx`).
- **Known bugs** are pinned with `it.fails` / `test.fail` and a
  `KNOWN BUG:` comment explaining the behaviour. When the bug is fixed the
  test starts "unexpectedly passing" — drop the `.fails`.

## Adding tests

1. Pick the lowest layer that can catch the bug (unit < components/liquid/storefront < integration < e2e).
2. Put the file where its project's `include` glob finds it (table above).
3. Build fixtures with `tests/support/storefront-fixtures.mjs` instead of hand-written objects/markup.
4. Run the project, then `npm run lint` and `npm run typecheck` (tests are type-checked).
5. If coverage goes up meaningfully, raise the thresholds in `vitest.config.ts`.

## Coverage

`npm run test:coverage` (v8) reports to `coverage/` (HTML, lcov,
json-summary) and enforces per-area thresholds, set just under today's
numbers as a ratchet — raise them, never lower them to merge:

| Area | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| `app/components/**` | 95 | 92 | 92 | 95 |
| client-safe models (`widget-kinds`, `brand`, `reel-media`, `reel-status`) | 95 | 85 | 95 | 95 |
| `scripts/extension-assets-src/**` | 80 | 60 | 77 | 85 |

Thresholds assume all four fast projects ran; coverage for a single
project will report misses in the others. Server models are covered by the
integration layer, which is not part of the coverage run.

## Liquid shims

liquidjs is not Shopify Liquid. `tests/support/liquid-engine.mjs` adds:

| Shopify feature | Shim |
| --- | --- |
| `{% doc %}`, `{% schema %}` | Block tags that skip their body |
| `t` | Reads `locales/en.default.json`; `{{ var }}` interpolation with values HTML-escaped (unless the key ends in `_html`); `count` → `one`/`other`; missing → `translation missing: en.<key>` |
| `money` | Cents → `$1,234.50` (default shop money format) |
| `image_url: width:` | `<src>?width=N` |
| `asset_url`, `stylesheet_tag` | `/assets/<file>`, Shopify's `<link>` markup |
| `color_brightness`, `color_lighten`, `color_darken` | HSL maths (approximate Shopify's) |
| `divided_by` | Integer division when both operands are integers (liquidjs returns floats) |
| Globals in `{% render %}` | Shopify exposes global objects inside rendered snippets; the scope is also passed as liquidjs `globals` |

Not modelled: the theme editor's `<!-- BEGIN app snippet -->` wrappers,
`block.shopify_attributes`, real metafield/metaobject drops, other locales,
and how Shopify's `json` filter escapes `<`/`>` (liquidjs does not; JSON-LD
tests only parse the JSON).

## CI

`.github/workflows/ci.yml` runs on every push and pull request, four
parallel jobs on Node 22 with the npm cache:

1. **Lint, typecheck, build** — `npm run lint`, `npm run typecheck`, `npm run build`, `npm run build:extension`.
2. **Fast tests** — `npm run test:coverage` (unit, components, storefront, liquid) with thresholds; `coverage/` uploaded as an artifact.
3. **Integration** — `postgres:16` service, `TEST_DATABASE_URL=…?schema=test`, `npm run test:integration` (migrate deploy + tests).
4. **E2E** — Playwright Chromium (browsers cached); report and traces uploaded on failure.

## Manual QA checklist

Run before a release, on a development store with a Dawn-family theme and
one non-Dawn theme.

**Theme editor**
- [ ] Each block can be added from *Add block → Apps* on its intended template; the app embed toggles under *App embeds*.
- [ ] Blocks render with the embed **off** and **on**, with no duplicate viewers or double add-to-cart.
- [ ] Adding a block in the editor to a page that had none makes it playable without a reload.
- [ ] Selecting/reloading a section in the editor re-binds widgets (deck, filmstrip arrows, stories).
- [ ] The editor's "Add block" deep links from the admin open the right template/target.

**Cloudflare Stream & webhooks**
- [ ] Upload a real video: progress, processing state, then playable; poster appears.
- [ ] Replace and delete a video; the Stream asset is removed in Cloudflare.
- [ ] Stream webhook (signed) marks a reel ready; an unsigned/forged request is rejected.
- [ ] Import from an Instagram/TikTok URL (rights confirmation shown).
- [ ] `orders/paid` webhook attributes revenue to a reel after a real checkout with an add from the viewer.
- [ ] GDPR webhooks (customers/data_request, customers/redact, shop/redact) respond correctly.

**Admin (App Bridge)**
- [ ] Contextual save bar appears on edit; Save/Discard work; Ctrl/Cmd+S saves.
- [ ] Leaving with unsaved changes (breadcrumb, admin nav, list row) asks for confirmation; Cancel stays.
- [ ] Resource picker selects products/collections for targeting and tagging; selections persist.
- [ ] Theme status ("embed on", "block placed") matches the live theme.

**Storefront**
- [ ] Add to cart from the viewer, story drawer and featured-video block updates the theme cart (Dawn: cart drawer/notification and bubble via Section Rendering) without a reload.
- [ ] Variant picker, quantity, sold-out and "You can only add N" messages on a real product.
- [ ] Real HLS playback on iOS Safari (native) and Android Chrome (hls.js); mute choice persists; failed video shows retry.
- [ ] Mobile bottom sheet peek/open, swipe between reels, story tap/hold.
- [ ] Product moments: time two products on a real reel; each pops up at its second for 5 s, a tap opens it in the sheet; the story sticker switches to it.
- [ ] Shared `?reelup=` links open the reel; native share sheet on mobile.
- [ ] RTL locale and a translated locale render labels correctly.
- [ ] Keyboard and screen reader: focus trap in viewers, Escape closes and focus returns, live announcements.

**Tracking integrations**
- [ ] Integrations › Custom pixel: paste the GA4 code as a custom pixel (permission Analytics); opening a video and adding to cart shows `reelup_video_view` / `reelup_add_to_cart` in GA4 DebugView.
- [ ] A Microsoft Clarity project ID with the embed on: Clarity loads on a page without videos once analytics consent is given (not before, with the cookie banner on); video events appear as Clarity custom events.
- [ ] Storefront tag forwarding (e.g. Meta Pixel in theme.liquid): `ReelupVideoView` reaches Meta's Pixel Helper only with marketing consent.
- [ ] Home/Analytics show adds to cart, completions and watch time after a few test views.

**Performance**
- [ ] Lighthouse (mobile) on a product page with the filmstrip: no regression vs. the theme baseline beyond the agreed budget (LCP, TBT, CLS); posters lazy-load; hls.js not loaded before interaction/visibility.
- [ ] With the embed on, a page without any widget (cart, blog) loads `reel-loader.js` and nothing else from the app.
