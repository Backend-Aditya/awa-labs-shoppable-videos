# AWAlabs Shoppable Videos

A Shopify app that turns short videos into a storefront sales channel.
Merchants upload or import videos (Instagram, TikTok, file links), tag the
products shown, and place them on their store as one of six widgets. Shoppers
watch, pick a variant and add to cart without leaving the video.

## What's in it

**Storefront**: a theme app extension (`extensions/shoppable-video-widgets`):

| Widget | Block / embed | Looks like |
| --- | --- | --- |
| Product page reels | `product-page-reels` | Filmstrip of clips with the lead product under each |
| Stacked carousel | `stacked-carousel` | Fanned deck (or slider / grid) |
| Stories | `insta-stories` | Ringed avatars opening a full-screen story viewer |
| Featured video | `single-video` | One video with its products and add to cart beside it |
| Add-to-cart video | `add-to-cart-video` | Compact row under the buy buttons |
| Floating video | app embed `shoppable-videos` | Small player pinned to a corner of every page |

Every widget opens the same video viewer (or the story viewer): HLS
playback, product panel with variant picker, quantity and add to cart
(Section Rendering for the theme's cart), recommendations, share links,
keyboard and screen-reader support, RTL.

**Admin**: an embedded React Router app (`app/`) on Polaris web components
and App Bridge: Home (setup checklist, KPIs), Reels (upload, import, tag,
product moments, cover, SEO), Widgets (live-preview editor), Analytics,
Integrations, Settings (brand kit).

**Product moments**: a reel can time each tagged product; while it plays,
the viewer pops that product up over the video and highlights it in the
list (the story viewer's sticker switches to it).

## How it fits together

```
app/                         React Router admin + server
  routes/app.*.tsx           admin pages (embedded, authenticated)
  routes/api.analytics.ts    storefront events, via the app proxy /apps/reels
  routes/webhooks.*.tsx      app, GDPR, Cloudflare Stream and order webhooks
  models/*.server.ts         Prisma + Admin GraphQL (server only)
  models/*.ts                client-safe shared logic (widget kinds, brand,
                             tracking, KPIs)
extensions/shoppable-video-widgets/
  blocks/ snippets/ locales/ Liquid, read from app-owned shop metafields
  assets/                    BUILT storefront JS/CSS, do not edit
scripts/extension-assets-src/  source of truth for that JS/CSS
prisma/                      schema and migrations (Postgres)
```

- **Content** lives in Shopify: each video is a `$app:reel` metaobject;
  widget settings and the brand kit are mirrored to `$app` shop
  metafields that the Liquid reads. Videos themselves are on Cloudflare
  Stream.
- **Storefront JS**: `reel-loader.js` is the only script the app puts on
  every page (through the app embed). On pages with a widget it loads the runtime (`reel-hls`, `reel-lightbox`,
  `reel-story`, `reel-trigger`, `reel-pop`) and `reel-tracking`; hls.js
  loads on first intent. Edit `scripts/extension-assets-src/`, then
  `npm run build:extension` minifies into the extension's `assets/`.
- **Analytics**: viewers post events to `/apps/reels/analytics`; they're
  counted into daily rollups per reel (`ReelDailyStat`), per widget
  (`WidgetDailyStat`, from the event's widget source) and per product
  (`ProductDailyStat`, taps and adds to cart). Orders are
  attributed from a hidden `_reelup_reel_id` line-item property by the
  `orders/paid` webhook (disabled until protected customer data access is
  approved, see `shopify.app.toml`).
- **Integrations**: `reel-tracking.js` publishes the same events to Shopify
  customer events and, with the visitor's consent, to tags the merchant
  connected (GA4, GTM, Meta, TikTok, Pinterest, Klaviyo, Microsoft
  Clarity). Settings and event names: `app/models/tracking.ts`.

## Development

Requirements: Node 22.18 or later (`@shopify/polaris-types` needs it and
`.npmrc` enforces engines; CI uses Node 22), the
[Shopify CLI](https://shopify.dev/docs/apps/tools/cli), a Postgres database
and, for video uploads, a Cloudflare Stream account.

```bash
npm ci
cp .env.example .env        # fill in the database and Cloudflare values
npx prisma migrate deploy
npm run dev                 # shopify app dev: tunnel, app config, extension
```

Environment (`app/shopify.server.ts` refuses to start in production
without the first four):

| Variable | Needed for |
| --- | --- |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL` | Shopify auth (the CLI sets these in dev) |
| `DATABASE_URL`, `DIRECT_URL` | Postgres; `DIRECT_URL` (no pooler) is used for migrations |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_STREAM_WEBHOOK_SECRET` | Video upload and processing (the rest works without) |
| `SCOPES`, `SHOP_CUSTOM_DOMAIN`, `APP_STORE_LISTING_URL` | Optional |
| `SUPPORT_EMAIL`, `BUSINESS_NAME`, `BUSINESS_ADDRESS` | Contact details on the public privacy policy at `/privacy` (without an email it points to the App Store listing) |
| `SHOPIFY_APP_HANDLE` | App handle used in the Shopify-hosted plan page URL (default `awalabs-shoppable-videos-1`) |

## Testing

`npm run test:fast` runs unit, component, storefront (jsdom) and Liquid
tests; `npm run test:integration` needs a test Postgres; `npm run test:e2e`
runs Playwright against a static storefront harness. Layers, conventions
and the manual QA checklist: [TESTING.md](TESTING.md).

## Deploying

```bash
npm run deploy      # builds extension assets, then shopify app deploy
```

A bare `shopify app deploy` does **not** rebuild the storefront assets.

The web app is hosted on Fly.io (`fly.toml`): `fly deploy` builds the
Dockerfile, runs `prisma migrate deploy` as the release command, then starts
one always-on machine with `/healthz` as its health check. Secrets are set
with `fly secrets set`.

Launch checklist (hosting, billing, listing): [docs/LAUNCH.md](docs/LAUNCH.md).
Built for Shopify criteria mapped to the code:
[docs/built-for-shopify.md](docs/built-for-shopify.md).
