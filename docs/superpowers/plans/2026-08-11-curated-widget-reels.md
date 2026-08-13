# Curated Widget Reel Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let merchants pick which reels a `PRODUCT_PAGE_REELS`/`CAROUSEL` widget shows directly from the widget's own admin UI, instead of only via reel→product tagging.

**Architecture:** Add an ordered `reelIds` list to `WidgetConfig`, sync it as a native `list.metaobject_reference<$app:reel>` shop metafield per kind (same pattern already established for `featuredReelId`), and have the two live Liquid blocks read that curated list instead of the product's own tagged-reels metafield. `targetRule` keeps deciding which product pages show the widget; the curated list now decides which reels appear there.

**Tech Stack:** React Router 7, Prisma/SQLite, Shopify Admin GraphQL, Liquid (theme app extension), Vitest.

## Global Constraints

- Reel→product tagging (the existing "Tag products" flow in the Reels library modal) must be completely unaffected — it keeps driving the in-reel shoppable-product carousel. This plan does not touch `syncProductReelMetafields`, `reel.tagged_products`, or anything under `s-section heading="Tagged products"` in `app/routes/app.reels.tsx`.
- The curated list is the same set of reels on every product page the widget is targeted to — not per-product. Order is preserved (matters for `CAROUSEL`'s stack order).
- Every metafield write must derive from the shop's current DB state for that widget kind, same invariant as every other synced field (`syncShopWidgetState` already enforces this structurally — this plan extends the same function, not a new one).
- `STORIES` gets the same data-model plumbing (sync config entry, metafield definition) for future-readiness, but no Liquid block changes — it still has no block, per the prior plan's explicit deferral.
- No automated Liquid test harness exists in this repo — the two block changes are verified manually in the theme editor, same as every prior plan.

---

### Task 1: Add `reelIds` to `WidgetConfig`, `reelListMetafieldKey` to the sync map, and `updateWidgetReels`

**Files:**
- Modify: `app/models/widget.server.ts`
- Test: `app/models/widget.server.test.ts`

**Interfaces:**
- Produces: `WidgetConfig.reelIds?: string[]`. `WIDGET_KIND_SYNC_CONFIG` entries gain an optional `reelListMetafieldKey`. `syncShopWidgetState` (existing signature, unchanged: `(admin, shopId, kind, options?)`) now also writes a `list.metaobject_reference` metafield entry when the live widget's kind has a `reelListMetafieldKey` configured and `config.reelIds` is non-empty. `updateWidgetReels(admin: AdminGraphqlClient, id: string, reelIds: string[]): Promise<Widget>` — new function, same shape as `updateWidgetFeaturedReel`.

- [ ] **Step 1: Write the failing tests**

Add these tests to `app/models/widget.server.test.ts`'s `describe("syncShopWidgetState", ...)` block:

```typescript
  it("includes the reel-list reference field for PRODUCT_PAGE_REELS when non-empty", async () => {
    const shop = await getOrCreateShop("sync-state-reel-list.myshopify.com");
    const widget = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "Curated", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
      reelIds: ["gid://shopify/Metaobject/10", "gid://shopify/Metaobject/11"],
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "PRODUCT_PAGE_REELS");

    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "product_page_reels_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "product_page_reels_widget_reels",
          type: "list.metaobject_reference",
          value: JSON.stringify(["gid://shopify/Metaobject/10", "gid://shopify/Metaobject/11"]),
        },
      ],
    });
  });

  it("omits the reel-list field for PRODUCT_PAGE_REELS when reelIds is empty or unset", async () => {
    const shop = await getOrCreateShop("sync-state-reel-list-empty.myshopify.com");
    const widget = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "No reels yet", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "PRODUCT_PAGE_REELS");

    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "product_page_reels_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
      ],
    });
  });

  it("includes the reel-list reference field for CAROUSEL under its own key", async () => {
    const shop = await getOrCreateShop("sync-state-carousel-reels.myshopify.com");
    const widget = await createWidget(shop.id, "CAROUSEL", "Deck", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
      reelIds: ["gid://shopify/Metaobject/20"],
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "CAROUSEL");

    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "stacked_carousel_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "stacked_carousel_widget_reels",
          type: "list.metaobject_reference",
          value: JSON.stringify(["gid://shopify/Metaobject/20"]),
        },
      ],
    });
  });
```

Add this new `describe` block for `updateWidgetReels`:

```typescript
describe("updateWidgetReels", () => {
  beforeEach(async () => {
    await prisma.widget.deleteMany();
    await prisma.shop.deleteMany();
  });

  it("sets reelIds on the widget's config, preserving order, and syncs", async () => {
    const shop = await getOrCreateShop("reels-set.myshopify.com");
    const widget = await createWidget(shop.id, "CAROUSEL", "Deck", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    const updated = await updateWidgetReels(admin, widget.id, [
      "gid://shopify/Metaobject/2",
      "gid://shopify/Metaobject/1",
    ]);

    expect((updated.config as { reelIds?: string[] }).reelIds).toEqual([
      "gid://shopify/Metaobject/2",
      "gid://shopify/Metaobject/1",
    ]);
    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "stacked_carousel_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "stacked_carousel_widget_reels",
          type: "list.metaobject_reference",
          value: JSON.stringify(["gid://shopify/Metaobject/2", "gid://shopify/Metaobject/1"]),
        },
      ],
    });
  });

  it("syncing an unpublished widget's reel list still omits it (published:false wins)", async () => {
    const shop = await getOrCreateShop("reels-set-unpublished.myshopify.com");
    const widget = await createWidget(shop.id, "CAROUSEL", "Draft deck", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const { admin, recorder } = createRecordingAdmin();

    await updateWidgetReels(admin, widget.id, ["gid://shopify/Metaobject/5"]);

    // Widget was never published, so syncShopWidgetState finds no "live"
    // widget for this kind — it writes published:false and, since `live`
    // is null, no reel-list field at all (the reference field is only
    // ever built from the DB's live/published widget's config, never from
    // whichever widget was just touched).
    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "stacked_carousel_widget",
          type: "json",
          value: JSON.stringify({ published: false, targetRule: { type: "all_products" } }),
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- npx vitest run app/models/widget.server.test.ts` (needs the migrated test DB — run `npm test` once first if `test.sqlite` isn't migrated yet).
Expected: FAIL — `WidgetConfig` has no `reelIds` field (TS error surfaces as a runtime type mismatch in the test data), `reelListMetafieldKey` isn't read by `syncShopWidgetState`, `updateWidgetReels` doesn't exist.

- [ ] **Step 3: Implement**

In `app/models/widget.server.ts`, update `WidgetConfig`:

```typescript
export interface WidgetConfig {
  templateStyle: string;
  targetRule:
    | { type: "all_products" }
    | { type: "handles"; handles: string[] };
  featuredReelId?: string;
  reelIds?: string[];
}
```

Update `WidgetKindSyncConfig` and `WIDGET_KIND_SYNC_CONFIG`:

```typescript
interface WidgetKindSyncConfig {
  metafieldKey: string;
  featuredReelMetafieldKey?: string;
  reelListMetafieldKey?: string;
}

const WIDGET_KIND_SYNC_CONFIG: Partial<Record<WidgetKind, WidgetKindSyncConfig>> = {
  PRODUCT_PAGE_REELS: {
    metafieldKey: "product_page_reels_widget",
    reelListMetafieldKey: "product_page_reels_widget_reels",
  },
  SINGLE_VIDEO: {
    metafieldKey: "single_video_widget",
    featuredReelMetafieldKey: "single_video_featured_reel",
  },
  CAROUSEL: {
    metafieldKey: "stacked_carousel_widget",
    reelListMetafieldKey: "stacked_carousel_widget_reels",
  },
  STORIES: {
    metafieldKey: "insta_stories_widget",
    reelListMetafieldKey: "insta_stories_widget_reels",
  },
  REEL_POPS: {
    metafieldKey: "reel_pops_widget",
    featuredReelMetafieldKey: "reel_pops_featured_reel",
  },
};
```

In `syncShopWidgetState`, right after the existing `featuredReelMetafieldKey` block, add the reel-list block:

```typescript
  if (syncConfig.featuredReelMetafieldKey && liveConfig?.featuredReelId) {
    metafields.push({
      ownerId: shopGid,
      namespace: "$app",
      key: syncConfig.featuredReelMetafieldKey,
      type: "metaobject_reference",
      value: liveConfig.featuredReelId,
    });
  }

  if (syncConfig.reelListMetafieldKey && liveConfig?.reelIds && liveConfig.reelIds.length > 0) {
    metafields.push({
      ownerId: shopGid,
      namespace: "$app",
      key: syncConfig.reelListMetafieldKey,
      type: "list.metaobject_reference",
      value: JSON.stringify(liveConfig.reelIds),
    });
  }
```

Add `updateWidgetReels` right after `updateWidgetFeaturedReel`:

```typescript
export async function updateWidgetReels(
  admin: AdminGraphqlClient,
  id: string,
  reelIds: string[],
): Promise<Widget> {
  const existing = await prisma.widget.findUniqueOrThrow({ where: { id } });
  const existingConfig = existing.config as unknown as WidgetConfig;
  const mergedConfig: WidgetConfig = { ...existingConfig, reelIds };

  const widget = await prisma.widget.update({
    where: { id },
    data: { config: mergedConfig as unknown as Prisma.InputJsonValue },
  });
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
  return widget;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx dotenv -e .env.test -o -- npx vitest run app/models/widget.server.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/models/widget.server.ts app/models/widget.server.test.ts
git commit -m "feat(widget.server): add curated reelIds list, sync as native reference metafield"
```

---

### Task 2: Declare the reel-list metafields in `shopify.app.toml`

**Files:**
- Modify: `shopify.app.toml`

**Interfaces:**
- Produces: metafield definitions matching `product_page_reels_widget_reels`, `stacked_carousel_widget_reels`, `insta_stories_widget_reels` (Task 1's keys).

- [ ] **Step 1: Add the definitions**

In `shopify.app.toml`, after the existing `[shop.metafields.app.product_page_reels_widget]` block and its `.access` sub-block, add:

```toml
[shop.metafields.app.product_page_reels_widget_reels]
type = "list.metaobject_reference<$app:reel>"
name = "Product page reels widget - curated reels"
description = "The reels the PRODUCT_PAGE_REELS widget shows, picked directly in the widget"

  [shop.metafields.app.product_page_reels_widget_reels.access]
  admin = "merchant_read"
  storefront = "public_read"
```

After the existing `[shop.metafields.app.stacked_carousel_widget]` block and its `.access` sub-block, add:

```toml
[shop.metafields.app.stacked_carousel_widget_reels]
type = "list.metaobject_reference<$app:reel>"
name = "Stacked carousel widget - curated reels"
description = "The reels the CAROUSEL widget shows, picked directly in the widget"

  [shop.metafields.app.stacked_carousel_widget_reels.access]
  admin = "merchant_read"
  storefront = "public_read"
```

After the existing `[shop.metafields.app.insta_stories_widget]` block and its `.access` sub-block, add:

```toml
[shop.metafields.app.insta_stories_widget_reels]
type = "list.metaobject_reference<$app:reel>"
name = "Insta-style stories widget - curated reels"
description = "The reels the STORIES widget shows, picked directly in the widget (no Liquid block reads this yet)"

  [shop.metafields.app.insta_stories_widget_reels.access]
  admin = "merchant_read"
  storefront = "public_read"
```

- [ ] **Step 2: Commit**

```bash
git add shopify.app.toml
git commit -m "feat(config): declare curated reel-list metafield definitions"
```

(This file change alone does nothing on the live store until a human runs `shopify app deploy` — call this out in Task 5's manual verification step.)

---

### Task 3: Wire `set-reels` into the widget detail route

**Files:**
- Modify: `app/routes/app.widgets.$id.tsx`

**Interfaces:**
- Consumes: `updateWidgetReels(admin, id, reelIds)` (Task 1).
- Produces: loader's existing `reels` field now also populates for `PRODUCT_PAGE_REELS`/`CAROUSEL`/`STORIES` (not just `SINGLE_VIDEO`/`REEL_POPS`); action handles a new `intent === "set-reels"`.

- [ ] **Step 1: Update the loader's `needsFeaturedReel`/reel-fetch condition**

In `app/routes/app.widgets.$id.tsx`, replace:

```typescript
  const needsFeaturedReel = widget.type === "SINGLE_VIDEO" || widget.type === "REEL_POPS";
  const reels = needsFeaturedReel ? await listReels(admin, 50) : [];
```

with:

```typescript
  const needsReelPicker =
    widget.type === "SINGLE_VIDEO" ||
    widget.type === "REEL_POPS" ||
    widget.type === "PRODUCT_PAGE_REELS" ||
    widget.type === "CAROUSEL" ||
    widget.type === "STORIES";
  const reels = needsReelPicker ? await listReels(admin, 50) : [];
```

- [ ] **Step 2: Add the action branch**

Add this branch alongside the existing `set-featured-reel` branch:

```typescript
  if (intent === "set-reels") {
    const reelIds = formData.getAll("reelId").map(String).filter(Boolean);
    await updateWidgetReels(admin, widget.id, reelIds);
    return { error: null };
  }
```

Update the import to include `updateWidgetReels`:

```typescript
import { deleteWidget, getWidget, updateWidget, updateWidgetFeaturedReel, updateWidgetReels, updateWidgetTargetRule } from "../models/widget.server";
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.widgets.$id.tsx
git commit -m "feat(admin): wire set-reels intent into the widget detail action"
```

---

### Task 4: "Choose reels" picker in the widget detail modal

**Files:**
- Modify: `app/routes/app.widgets.tsx`

**Interfaces:**
- Consumes: `detailFetcher.data.reels` (already loaded, now populated for 3 more kinds per Task 3).

- [ ] **Step 1: Add a `reelsFetcher` and its revalidation effect**

In `WidgetDetailModal`, add alongside the existing `featuredReelFetcher`:

```typescript
  const reelsFetcher = useFetcher<{ error: string | null }>();
```

Add a revalidation effect matching the existing pattern:

```typescript
  useEffect(() => {
    if (href && reelsFetcher.state === "idle" && reelsFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reelsFetcher.state, reelsFetcher.data]);
```

- [ ] **Step 2: Add the "Choose reels" section**

Add this block inside the modal's outer `<s-stack gap="base">`, after the existing featured-reel `{(detailWidget.type === "SINGLE_VIDEO" || ...` block:

```typescript
          {(detailWidget.type === "PRODUCT_PAGE_REELS" ||
            detailWidget.type === "CAROUSEL" ||
            detailWidget.type === "STORIES") && (
            <s-stack gap="base">
              {reelsFetcher.data?.error && (
                <s-paragraph tone="critical">{reelsFetcher.data.error}</s-paragraph>
              )}
              <s-paragraph>Reels shown by this widget (same set on every targeted product page):</s-paragraph>
              <reelsFetcher.Form method="post" action={href!}>
                <input type="hidden" name="intent" value="set-reels" />
                <s-stack gap="small">
                  {(detailFetcher.data?.reels ?? []).map((reel) => (
                    <s-checkbox
                      key={reel.id}
                      label={reel.title}
                      name="reelId"
                      value={reel.id}
                      defaultChecked={(
                        (detailWidget.config as unknown as WidgetConfig).reelIds ?? []
                      ).includes(reel.id)}
                    ></s-checkbox>
                  ))}
                </s-stack>
                <s-button
                  type="submit"
                  {...(reelsFetcher.state !== "idle" ? { loading: true } : {})}
                >
                  Save reels
                </s-button>
              </reelsFetcher.Form>
            </s-stack>
          )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

With the dev server running, open a `PRODUCT_PAGE_REELS` or `CAROUSEL` widget's popup: confirm the "Choose reels" section lists all reels as checkboxes, checking some and clicking "Save reels" persists the selection (reopen the modal, confirm the same reels stay checked).

- [ ] **Step 5: Commit**

```bash
git add app/routes/app.widgets.tsx
git commit -m "feat(admin): add curated reel picker to widget detail modal"
```

---

### Task 5: Read the curated list in `product-page-reels.liquid` and `stacked-carousel.liquid`

**Files:**
- Modify: `extensions/shoppable-video-widgets/blocks/product-page-reels.liquid`
- Modify: `extensions/shoppable-video-widgets/blocks/stacked-carousel.liquid`

**Interfaces:**
- Consumes: shop metafields `product_page_reels_widget_reels`, `stacked_carousel_widget_reels` (Task 1/2) — each a native `list.metaobject_reference<$app:reel>`, resolving in Liquid the same way `reel.tagged_products.value` already resolves a list of products (a plain array of the referenced objects, no `.value` wrapper needed a second time since the metafield itself already carries `.value`).

- [ ] **Step 1: Update `product-page-reels.liquid`**

Replace:

```liquid
{% assign reels_field = block.settings.product.metafields[reel_namespace].reels %}

{% assign visible_count = 0 %}
{% if widget_matches_product %}
  {% for reel in reels_field.value %}
```

with:

```liquid
{% assign reels_field = shop.metafields[reel_namespace].product_page_reels_widget_reels %}

{% assign visible_count = 0 %}
{% if widget_matches_product %}
  {% for reel in reels_field.value %}
```

Then find the second, identical `{% for reel in reels_field.value %}` loop further down (the one that renders the actual `<div class="reelup-reel"...>` markup) — no change needed there, since `reels_field` is now assigned once at the top and reused by both loops (this matches the existing pattern exactly: the file already reuses one `reels_field` variable across two loops, just previously pointed at a product metafield instead of a shop metafield).

- [ ] **Step 2: Update `stacked-carousel.liquid`**

Replace:

```liquid
{% assign reels_field = block.settings.product.metafields[reel_namespace].reels %}
```

with:

```liquid
{% assign reels_field = shop.metafields[reel_namespace].stacked_carousel_widget_reels %}
```

- [ ] **Step 3: Manual verification**

No automated Liquid test harness. With `shopify app dev` running and the metafield definitions deployed (`shopify app deploy` — do this first if not already done for Task 2's new definitions):

1. In a `PRODUCT_PAGE_REELS` widget's popup, pick 2 reels via "Choose reels," save, publish the widget.
2. Visit a product page the widget targets (per its `targetRule`) that was **never** tagged to either reel via the Reels library's "Tag products" flow — confirm both curated reels show anyway.
3. Visit a **different** targeted product page — confirm the same 2 reels show there too (not per-product).
4. Go back to the widget, uncheck one reel, save — confirm it disappears from both product pages.
5. Confirm reel→product tagging still works unchanged for its actual purpose: open a reel in the Reels library, tag it to a product, confirm that product's page still shows the in-reel "buy this product" carousel for products tagged to a reel that IS in the widget's curated list (tagging no longer controls page visibility, but still controls the in-reel shoppable-product strip).
6. Repeat steps 1-4 for a `CAROUSEL` widget.

- [ ] **Step 4: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/product-page-reels.liquid extensions/shoppable-video-widgets/blocks/stacked-carousel.liquid
git commit -m "feat(storefront): read curated widget reel list instead of per-product tagging"
```

---

### Task 6: Full-suite regression check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Deploy reminder**

`shopify.app.toml`'s new metafield definitions (Task 2) only take effect on the live store after `shopify app deploy` — manual step for a human with store access, same requirement as every prior plan touching this file.

---

## Post-plan note

`insta_stories_widget_reels` is declared and synced (Task 1/2) but has no Liquid block to read it — consistent with `STORIES` having no block at all yet. When a future plan builds the Stories block, it follows the exact same one-line change as Task 5's two blocks: read `shop.metafields[reel_namespace].insta_stories_widget_reels` instead of a per-product lookup.
