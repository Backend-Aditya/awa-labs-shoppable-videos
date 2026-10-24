# Launch checklist

Status as of 2026-10-22. `[x]` is done and verified in this repo or on the live
deployment, `[ ]` still needs doing, `[?]` needs a check in the Partner
Dashboard or against the current Shopify docs before submitting.

## Hosting and operations

- [x] Hosted on Fly.io (`awa-shoppable-videos`, region `iad`), one always-on machine.
- [x] Migrations run as a Fly release command; the server starts without migrating.
- [x] `/healthz` checks the database and is used as the Fly health check.
- [x] Secrets set on Fly: `DATABASE_URL`, `DIRECT_URL`, `SHOPIFY_API_KEY`,
      `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `CLOUDFLARE_*`, `CRON_SECRET`.
- [ ] Rotate the Neon password (it was pasted into a chat) and update
      `DATABASE_URL` / `DIRECT_URL` on Fly.
- [x] Old Render service and Supabase project deleted. Recreate any scheduled job that calls the app (uses `CRON_SECRET`) on Fly or an external scheduler.
- [ ] Add a second Fly machine in another zone if uptime matters (`fly scale count 2`).
- [ ] Optional CI deploy: add `FLY_API_TOKEN` to GitHub secrets and a deploy workflow.

## Billing (Shopify Billing API)

- [x] Free, Basic $23.99, Premium $79.99, Elite $159.20 per 30 days (20% under the reference prices).
- [x] 7-day free trial on every paid plan.
- [x] Shopify managed pricing is on (plans published in the Partner Dashboard). `/app/pricing` shows usage meters and sends merchants to Shopify's plan page.
- [x] `app_subscriptions/update` webhook keeps the plan in sync; uninstall resets to Free.
- [x] Reel limit enforced on upload and import; views cap shown as a banner at 80% and 100%.
- [ ] Test the full flow on a development store (Shopify makes those charges test charges). Check that `SHOPIFY_APP_HANDLE` matches the app handle in the plan page URL.
- [ ] Decide whether to hard-limit views. Today the views cap is a warning only.
- [?] Confirm the plan names and prices in the listing match the in-app plans exactly.

## Analytics

- [x] Views, product clicks and add-to-cart events, counted per reel per day.
- [x] Add-to-cart is recorded only after Shopify accepts the line item.
- [x] Dashboard and reel pages show add-to-carts and add-to-cart rate.
- [ ] Revenue attribution needs the `orders/paid` webhook, which needs Protected
      customer data approval (Partner Dashboard > App setup). Re-enable the
      subscription in `shopify.app.toml` once approved.

## Built for Shopify

Criteria from the Partner Dashboard checklist. Automated ones use the last 28 days of data.

Design and functionality (checked in the code)

- [x] Embedded in the Shopify admin (`embedded = true`).
- [x] Session token authentication (`authenticate.admin` on every admin route).
- [x] Latest App Bridge on every page: loaded from Shopify's CDN by `AppProvider` in the `/app` layout.
- [x] Theme app extension for all storefront functionality; nothing is left behind on uninstall.
- [x] Does not use the Asset API (no `read_themes`/`write_themes` scopes, no theme file calls).
- [x] Shopify's web components and default font in the admin.
- [ ] Walk every page against Shopify's design guidelines (spacing, headings, empty states).

Performance (needs real traffic, cannot be verified from code)

- [ ] Admin Core Web Vitals: LCP under 2.5s, CLS under 0.1, INP under 200ms, with 100+ admin calls in 28 days.
      Check the Partner Dashboard > Monitoring after real merchants use the app.
- [ ] Storefront impact: Lighthouse on a dev store with and without the widgets; keep the score drop small.
- [ ] Fly machine is always on (no cold starts), so admin loads are not slowed by boot time.

Category: Analytics

- [ ] Read the Analytics category criteria in the Partner Dashboard before submitting.

Merchant utility (only comes with launch)

- [ ] 50 net installs from active shops on paid plans.
- [ ] 5 reviews since launch, rating of 4 stars or more.

## App Store listing

- [ ] App name, tagline, description and feature list.
- [ ] Icon (1200x1200) and at least 3 screenshots, ideally a short demo video.
- [ ] Privacy policy URL and support email / URL.
- [ ] Pricing section in the listing that matches the in-app plans.
- [ ] Emergency developer contact and review instructions, with a dev store login if needed.
- [ ] Translate or confirm supported languages (theme extension locales exist for 8 languages).

## Before submitting

- [ ] Run `npm run test:all` (fast, integration, e2e) and `npm run lint`.
- [ ] Install on a fresh dev store: onboarding, upload, widget placement, add-to-cart, analytics, plan change, uninstall, reinstall.
- [ ] `shopify app deploy` and confirm the released version shows the right URLs and webhooks.
- [ ] Submit for review in the Partner Dashboard.
