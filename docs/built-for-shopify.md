# Built for Shopify readiness

Status as of October 2026. Shopify awards the badge after reviewing the app,
and part of its criteria is measured from real merchant traffic (admin Web
Vitals, installs, reviews). The code can make the app eligible; it can't earn
the badge on its own. Current thresholds are listed in the Partner Dashboard
under the app's Built for Shopify status; check there before applying.

This page maps the criteria to the code. The working launch checklist
(hosting, billing, listing, submission) is [LAUNCH.md](LAUNCH.md).

## Met in the code

| Area | Requirement | Where |
| --- | --- | --- |
| Embedded admin | Runs inside the Shopify admin with App Bridge and Polaris web components; app nav, title bar, loading bar | `app/routes/app.tsx`, every `app.*` route uses `<s-page>` |
| Forms | Contextual save bar with discard confirmation; ⌘/Ctrl+S; leave-page guard | `SaveBar` + `useEditorGuards` on Settings, Integrations, widget and reel editors |
| Onboarding | Setup checklist on Home with the next step's action; theme deep links for blocks and the app embed | `app/routes/app._index.tsx`, `app/components/themeEditor.ts` |
| Theme integration | Theme app extension only (app blocks + app embed), no ScriptTag or theme asset writes; works with the embed off | `extensions/shoppable-video-widgets` |
| Storefront performance | With the embed on, pages without a widget load one 1.7 KB script (0.8 KB gzipped), guarded by an e2e test; the runtime, styles and hls.js load only where a widget is, hls.js only on intent; posters sized, lazy, no layout shift | `scripts/extension-assets-src/reel-loader.js` |
| Admin performance | Route bundles of 3–14 KB gzipped (the widget editor is the largest) over a ~90 KB shared React runtime that's cached across pages; loaders degrade per source instead of failing the page | `npm run build` output |
| APIs | GraphQL Admin API only, current version (2026-07) | `app/shopify.server.ts` |
| Privacy | GDPR webhooks; shop data (incl. tracking settings, analytics) erased on `shop/redact`; analytics hold no customer data | `app/routes/webhooks.*`, `prisma/schema.prisma` |
| Consent | Third-party tracking only with the visitor's consent from Shopify's Customer Privacy API; Shopify customer events for everything else | `scripts/extension-assets-src/reel-tracking.js` |
| Accessibility | Keyboard-operable viewers with focus return, live announcements, labelled controls, reduced-motion support, RTL | storefront and admin components |

## Needs action outside the code

1. **Protected customer data access** for the `orders/paid` webhook
   (Partner Dashboard › App setup). Until it's approved, "Sales from videos"
   shows "-" and add-to-cart is the conversion signal. Once approved,
   uncomment the subscription in `shopify.app.toml` and deploy.
2. **Usage thresholds**: net installs, reviews and rating, as set by Shopify.
3. **Admin Web Vitals** from real traffic (LCP, CLS, INP at the 75th
   percentile): watch them in the Partner Dashboard once merchants use the app.
4. **Storefront impact**: run the Lighthouse check in TESTING.md › Manual QA
   on a store with and without the app.
5. **Billing** runs on Shopify's Billing API (`/app/pricing`, the
   `app_subscriptions/update` webhook); test the full flow with
   `BILLING_TEST_MODE` first, as LAUNCH.md describes.
6. **App listing**: screenshots, demo store, support contact and privacy
   policy that match the app.
