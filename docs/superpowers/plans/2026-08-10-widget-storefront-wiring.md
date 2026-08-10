# Widget Storefront Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin's `PRODUCT_PAGE_REELS` widget (publish toggle, target rule) actually control whether the storefront's "Product page reels" block renders, instead of the block ignoring `Widget` entirely.

**Architecture:** Mirror `Widget.published`/`config.targetRule` into a shop-level `$app` metafield (`product_page_reels_widget`, type `json`) whenever the widget changes in admin — same pattern the codebase already uses for reel-to-product tagging (`syncProductReelMetafields`). The Liquid block reads that metafield at render time and gates on it before its existing per-reel loop.

**Tech Stack:** React Router 7 (admin routes), Prisma (Postgres), Shopify Admin GraphQL API, Liquid (theme app extension), Vitest.

## Global Constraints

- At most one published `PRODUCT_PAGE_REELS` widget per shop — publishing one auto-unpublishes any other published widget of the same `type` for that shop (spec, "Multiple widgets").
- No published `PRODUCT_PAGE_REELS` widget for the shop → block renders nothing, regardless of reel-level `published`/ready state (spec, "No-widget behavior").
- Metafield sync only applies to `type === "PRODUCT_PAGE_REELS"` widgets — the other 4 kinds are out of scope for this plan and must not write metafields no block reads.
- Deleting a published widget must sync `published: false` so the storefront doesn't keep showing a deleted widget's content.
- Follow the existing codebase pattern: `AdminGraphqlClient`-typed functions in `app/models/*.server.ts`, `metafieldsSet` mutations, `$app` reserved namespace, `assertNoGraphqlErrors`/`throwOnUserErrors` error handling.

---

### Task 1: Export shared GraphQL error helpers from `reel.server.ts`

`widget.server.ts` needs the same `assertNoGraphqlErrors`/`throwOnUserErrors` helpers `reel.server.ts` already has (currently private). Export them instead of duplicating.

**Files:**
- Modify: `app/models/reel.server.ts:38-55`
- Test: existing `app/models/reel.server.test.ts` (no new tests — this is a pure export change, verified by the existing suite still passing)

**Interfaces:**
- Produces: `export function throwOnUserErrors(userErrors: Array<{ field: string[]; message: string }>): void` and `export function assertNoGraphqlErrors(json: { data: unknown; errors?: Array<{ message: string }> }): void`, both importable from `../models/reel.server`.

- [ ] **Step 1: Add `export` to both helper functions**

In `app/models/reel.server.ts`, change:

```typescript
function throwOnUserErrors(
```

to:

```typescript
export function throwOnUserErrors(
```

and change:

```typescript
function assertNoGraphqlErrors(json: {
```

to:

```typescript
export function assertNoGraphqlErrors(json: {
```

- [ ] **Step 2: Run the existing reel test suite to confirm nothing broke**

Run: `npx vitest run app/models/reel.server.test.ts`
Expected: all existing tests still PASS (this step only adds `export` keywords, no behavior change).

- [ ] **Step 3: Commit**

```bash
git add app/models/reel.server.ts
git commit -m "refactor(reel.server): export GraphQL error helpers for reuse by widget.server"
```

---

### Task 2: Add `syncWidgetConfigMetafield` to `widget.server.ts`

Core sync function: writes the shop-level `$app` metafield that the Liquid block will read. Scoped to `PRODUCT_PAGE_REELS` only — no-ops (no GraphQL call at all) for every other widget kind.

**Files:**
- Modify: `app/models/widget.server.ts`
- Test: `app/models/widget.server.test.ts`

**Interfaces:**
- Consumes: `AdminGraphqlClient` (from `./reel.server`, existing type: `{ graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<{ json: () => Promise<any> }> }`); `assertNoGraphqlErrors`, `throwOnUserErrors` (from `./reel.server`, Task 1).
- Produces: `export async function syncWidgetConfigMetafield(admin: AdminGraphqlClient, widget: Pick<Widget, "type" | "published" | "config">): Promise<void>` — used by Tasks 3-5.

- [ ] **Step 1: Write the failing tests**

Add to `app/models/widget.server.test.ts` (new `import` for `syncWidgetConfigMetafield`, added to the existing import block from `./widget.server`):

```typescript
import {
  createWidget,
  listWidgetsForShop,
  setWidgetPublished,
  deleteWidget,
  getWidget,
  updateWidget,
  updateWidgetTargetRule,
  syncWidgetConfigMetafield,
} from "./widget.server";
```

New `describe` block, appended before the final closing `});` of the file:

```typescript
describe("syncWidgetConfigMetafield", () => {
  it("writes a shop-level $app metafield with published state and targetRule", async () => {
    let capturedSetVariables: Record<string, unknown> | undefined;
    const admin = {
      graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
        if (query.includes("GetShopId")) {
          return { json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" } } }) };
        }
        capturedSetVariables = options?.variables;
        return { json: async () => ({ data: { metafieldsSet: { userErrors: [] } } }) };
      },
    };

    await syncWidgetConfigMetafield(admin, {
      type: "PRODUCT_PAGE_REELS",
      published: true,
      config: { templateStyle: "classic", targetRule: { type: "all_products" } },
    });

    expect(capturedSetVariables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "product_page_reels_widget",
          type: "json",
          value: JSON.stringify({
            published: true,
            targetRule: { type: "all_products" },
          }),
        },
      ],
    });
  });

  it("does nothing for widget kinds other than PRODUCT_PAGE_REELS", async () => {
    let callCount = 0;
    const admin = {
      graphql: async () => {
        callCount += 1;
        return { json: async () => ({ data: {} }) };
      },
    };

    await syncWidgetConfigMetafield(admin, {
      type: "CAROUSEL",
      published: true,
      config: { templateStyle: "classic", targetRule: { type: "all_products" } },
    });

    expect(callCount).toBe(0);
  });

  it("throws if the metafieldsSet mutation returns userErrors", async () => {
    const admin = {
      graphql: async (query: string) => {
        if (query.includes("GetShopId")) {
          return { json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" } } }) };
        }
        return {
          json: async () => ({
            data: {
              metafieldsSet: {
                userErrors: [{ field: ["metafields", "0", "value"], message: "bad value" }],
              },
            },
          }),
        };
      },
    };

    await expect(
      syncWidgetConfigMetafield(admin, {
        type: "PRODUCT_PAGE_REELS",
        published: false,
        config: { templateStyle: "classic", targetRule: { type: "all_products" } },
      }),
    ).rejects.toThrow("bad value");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/models/widget.server.test.ts`
Expected: FAIL — `syncWidgetConfigMetafield is not a function` (or import error), since it doesn't exist yet.

- [ ] **Step 3: Implement `syncWidgetConfigMetafield`**

In `app/models/widget.server.ts`, update the top imports and add the function:

```typescript
import type { Prisma, Widget } from "@prisma/client";
import prisma from "../db.server";
import type { AdminGraphqlClient } from "./reel.server";
import { assertNoGraphqlErrors, throwOnUserErrors } from "./reel.server";
```

(replaces the existing `import type { Prisma, Widget } from "@prisma/client";` / `import prisma from "../db.server";` pair — keep those two lines, add the two new ones.)

Add near the bottom of the file, after `updateWidgetTargetRule`:

```typescript
interface WidgetMetafieldValue {
  published: boolean;
  targetRule: WidgetConfig["targetRule"];
}

async function getShopGid(admin: AdminGraphqlClient): Promise<string> {
  const response = await admin.graphql(
    `#graphql
    query GetShopId {
      shop { id }
    }`,
  );
  const json = await response.json();
  assertNoGraphqlErrors(json);
  return json.data.shop.id;
}

// Mirrors Widget.published/config.targetRule into a shop-level metafield so
// the storefront Liquid block (which has no access to this app's Postgres
// DB) can read it. Scoped to PRODUCT_PAGE_REELS only — the other widget
// kinds have no theme implementation yet, so writing a metafield for them
// would just be dead data no block reads.
export async function syncWidgetConfigMetafield(
  admin: AdminGraphqlClient,
  widget: Pick<Widget, "type" | "published" | "config">,
): Promise<void> {
  if (widget.type !== "PRODUCT_PAGE_REELS") return;

  const shopGid = await getShopGid(admin);
  const config = widget.config as unknown as WidgetConfig;
  const value: WidgetMetafieldValue = {
    published: widget.published,
    targetRule: config.targetRule,
  };

  const response = await admin.graphql(
    `#graphql
    mutation SetWidgetConfigMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopGid,
            namespace: "$app",
            key: "product_page_reels_widget",
            type: "json",
            value: JSON.stringify(value),
          },
        ],
      },
    },
  );
  const json = await response.json();
  assertNoGraphqlErrors(json);
  throwOnUserErrors(json.data.metafieldsSet.userErrors);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/models/widget.server.test.ts`
Expected: all tests PASS, including the three new ones.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/models/widget.server.ts app/models/widget.server.test.ts
git commit -m "feat(widget.server): add syncWidgetConfigMetafield for PRODUCT_PAGE_REELS"
```

---

### Task 3: Wire publish-exclusivity + sync into `updateWidget`

When a widget's `published` flips to `true`, unpublish any other published widget of the same `type`/shop first (enforces "at most one"), then sync both. Every call now needs an `admin` client, so this is a signature change — update the one call site in Task 6.

**Files:**
- Modify: `app/models/widget.server.ts`
- Test: `app/models/widget.server.test.ts`

**Interfaces:**
- Consumes: `syncWidgetConfigMetafield` (Task 2).
- Produces: `export async function updateWidget(admin: AdminGraphqlClient, id: string, updates: { name?: string; published?: boolean }): Promise<Widget>` — signature changed from the old 2-arg version. Existing callers (route in Task 6, tests below) must pass `admin` as the first argument.

- [ ] **Step 1: Write the failing tests**

Replace the existing two `updateWidget` tests in `app/models/widget.server.test.ts` ("updates a widget's name and published flag" and "updates only the provided fields, leaving others unchanged") — they currently call `updateWidget(widget.id, {...})` with no `admin` arg. Replace both call sites plus add two new tests, so the full block reads:

```typescript
  it("updates a widget's name and published flag", async () => {
    const shop = await getOrCreateShop("widget-update.myshopify.com");
    const widget = await createWidget(shop.id, "CAROUSEL", "Original name", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const admin = { graphql: async () => ({ json: async () => ({ data: {} }) }) };

    const updated = await updateWidget(admin, widget.id, {
      name: "Renamed carousel",
      published: true,
    });

    expect(updated.name).toBe("Renamed carousel");
    expect(updated.published).toBe(true);
  });

  it("updates only the provided fields, leaving others unchanged", async () => {
    const shop = await getOrCreateShop("widget-partial-update.myshopify.com");
    const widget = await createWidget(shop.id, "STORIES", "Keep my name", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const admin = { graphql: async () => ({ json: async () => ({ data: {} }) }) };

    const updated = await updateWidget(admin, widget.id, { published: true });

    expect(updated.name).toBe("Keep my name");
    expect(updated.published).toBe(true);
  });

  it("publishing a widget unpublishes another published widget of the same type and shop", async () => {
    const shop = await getOrCreateShop("widget-exclusive.myshopify.com");
    const first = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "First", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const second = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "Second", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await updateWidget(
      { graphql: async () => ({ json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" }, metafieldsSet: { userErrors: [] } } }) }) },
      first.id,
      { published: true },
    );

    const secondPublishedResult = await updateWidget(
      { graphql: async () => ({ json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" }, metafieldsSet: { userErrors: [] } } }) }) },
      second.id,
      { published: true },
    );

    const firstAfter = await getWidget(shop.id, first.id);
    expect(firstAfter?.published).toBe(false);
    expect(secondPublishedResult.published).toBe(true);
  });

  it("publishing a widget does not unpublish a widget of a different type or shop", async () => {
    const shopA = await getOrCreateShop("widget-exclusive-a.myshopify.com");
    const shopB = await getOrCreateShop("widget-exclusive-b.myshopify.com");
    const sameShopDifferentType = await createWidget(shopA.id, "CAROUSEL", "Carousel", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const differentShop = await createWidget(shopB.id, "PRODUCT_PAGE_REELS", "Other shop", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(sameShopDifferentType.id, true);
    await setWidgetPublished(differentShop.id, true);
    const target = await createWidget(shopA.id, "PRODUCT_PAGE_REELS", "Target", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const admin = { graphql: async () => ({ json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" }, metafieldsSet: { userErrors: [] } } }) }) };

    await updateWidget(admin, target.id, { published: true });

    const sameShopDifferentTypeAfter = await getWidget(shopA.id, sameShopDifferentType.id);
    const differentShopAfter = await getWidget(shopB.id, differentShop.id);
    expect(sameShopDifferentTypeAfter?.published).toBe(true);
    expect(differentShopAfter?.published).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/models/widget.server.test.ts`
Expected: FAIL — `updateWidget` still takes 2 args, TS/runtime mismatch, and the two new exclusivity tests fail since the behavior doesn't exist yet.

- [ ] **Step 3: Implement the new `updateWidget`**

Replace the existing `updateWidget` function in `app/models/widget.server.ts`:

```typescript
export async function updateWidget(
  admin: AdminGraphqlClient,
  id: string,
  updates: { name?: string; published?: boolean },
): Promise<Widget> {
  const current = await prisma.widget.findUniqueOrThrow({ where: { id } });

  if (updates.published === true && !current.published) {
    const siblings = await prisma.widget.findMany({
      where: {
        shopId: current.shopId,
        type: current.type,
        published: true,
        id: { not: id },
      },
    });
    for (const sibling of siblings) {
      const unpublished = await prisma.widget.update({
        where: { id: sibling.id },
        data: { published: false },
      });
      await syncWidgetConfigMetafield(admin, unpublished);
    }
  }

  const widget = await prisma.widget.update({ where: { id }, data: updates });
  await syncWidgetConfigMetafield(admin, widget);
  return widget;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/models/widget.server.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `app/routes/app.widgets.$id.tsx` (still calling the old 2-arg signature) — fixed in Task 6. If there are errors anywhere else, stop and investigate before continuing.

- [ ] **Step 6: Commit**

```bash
git add app/models/widget.server.ts app/models/widget.server.test.ts
git commit -m "feat(widget.server): enforce one published widget per type, sync on publish"
```

---

### Task 4: Sync `updateWidgetTargetRule`

Target-rule changes must reach the shop metafield too, independent of publish state changes.

**Files:**
- Modify: `app/models/widget.server.ts`
- Test: `app/models/widget.server.test.ts`

**Interfaces:**
- Consumes: `syncWidgetConfigMetafield` (Task 2).
- Produces: `export async function updateWidgetTargetRule(admin: AdminGraphqlClient, id: string, targetRule: WidgetConfig["targetRule"]): Promise<Widget>` — signature changed, `admin` added as first argument.

- [ ] **Step 1: Write the failing tests**

Replace the existing two `updateWidgetTargetRule` tests ("updates a widget's targetRule to specific product handles" and "resets a widget's targetRule to all_products, preserving other config keys") to pass an `admin` client, and add a call-verification test:

```typescript
  it("updates a widget's targetRule to specific product handles", async () => {
    const shop = await getOrCreateShop("widget-target-handles.myshopify.com");
    const widget = await createWidget(shop.id, "REEL_POPS", "Targeted pop", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const admin = { graphql: async () => ({ json: async () => ({ data: {} }) }) };

    const updated = await updateWidgetTargetRule(admin, widget.id, {
      type: "handles",
      handles: ["blue-shirt", "red-hat"],
    });

    expect(updated.config).toEqual({
      templateStyle: "classic",
      targetRule: { type: "handles", handles: ["blue-shirt", "red-hat"] },
    });
  });

  it("resets a widget's targetRule to all_products, preserving other config keys", async () => {
    const shop = await getOrCreateShop("widget-target-reset.myshopify.com");
    const widget = await createWidget(shop.id, "REEL_POPS", "Reset pop", {
      templateStyle: "bold",
      targetRule: { type: "handles", handles: ["old-handle"] },
    });
    const admin = { graphql: async () => ({ json: async () => ({ data: {} }) }) };

    const updated = await updateWidgetTargetRule(admin, widget.id, { type: "all_products" });

    expect(updated.config).toEqual({
      templateStyle: "bold",
      targetRule: { type: "all_products" },
    });
  });

  it("syncs the shop metafield when targetRule changes on a published PRODUCT_PAGE_REELS widget", async () => {
    const shop = await getOrCreateShop("widget-target-sync.myshopify.com");
    const widget = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "Synced", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(widget.id, true);
    let capturedSetVariables: Record<string, unknown> | undefined;
    const admin = {
      graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
        if (query.includes("GetShopId")) {
          return { json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" } } }) };
        }
        capturedSetVariables = options?.variables;
        return { json: async () => ({ data: { metafieldsSet: { userErrors: [] } } }) };
      },
    };

    await updateWidgetTargetRule(admin, widget.id, {
      type: "handles",
      handles: ["blue-shirt"],
    });

    expect(capturedSetVariables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "product_page_reels_widget",
          type: "json",
          value: JSON.stringify({
            published: true,
            targetRule: { type: "handles", handles: ["blue-shirt"] },
          }),
        },
      ],
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/models/widget.server.test.ts`
Expected: FAIL — `updateWidgetTargetRule` still takes 2 args.

- [ ] **Step 3: Implement**

Replace the existing `updateWidgetTargetRule` function in `app/models/widget.server.ts`:

```typescript
export async function updateWidgetTargetRule(
  admin: AdminGraphqlClient,
  id: string,
  targetRule: WidgetConfig["targetRule"],
): Promise<Widget> {
  const existing = await prisma.widget.findUniqueOrThrow({ where: { id } });
  const existingConfig = existing.config as unknown as WidgetConfig;
  const mergedConfig: WidgetConfig = { ...existingConfig, targetRule };

  const widget = await prisma.widget.update({
    where: { id },
    data: { config: mergedConfig as unknown as Prisma.InputJsonValue },
  });
  await syncWidgetConfigMetafield(admin, widget);
  return widget;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/models/widget.server.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `app/routes/app.widgets.$id.tsx` — fixed in Task 6.

- [ ] **Step 6: Commit**

```bash
git add app/models/widget.server.ts app/models/widget.server.test.ts
git commit -m "feat(widget.server): sync shop metafield on target-rule changes"
```

---

### Task 5: Sync `deleteWidget`

Deleting a published widget must clear its "published" state from the metafield, otherwise the storefront keeps honoring a widget that no longer exists.

**Files:**
- Modify: `app/models/widget.server.ts`
- Test: `app/models/widget.server.test.ts`

**Interfaces:**
- Consumes: `syncWidgetConfigMetafield` (Task 2).
- Produces: `export async function deleteWidget(admin: AdminGraphqlClient, id: string): Promise<void>` — signature changed, `admin` added as first argument.

- [ ] **Step 1: Write the failing tests**

Replace the existing "publishes and deletes a widget" test (which calls `deleteWidget(widget.id)` with no `admin`) and add a metafield-sync assertion:

```typescript
  it("publishes and deletes a widget", async () => {
    const shop = await getOrCreateShop("widget-c.myshopify.com");
    const widget = await createWidget(shop.id, "REEL_POPS", "Pop", {
      templateStyle: "classic",
      targetRule: { type: "handles", handles: ["a-product"] },
    });
    const admin = { graphql: async () => ({ json: async () => ({ data: {} }) }) };

    const published = await setWidgetPublished(widget.id, true);
    expect(published.published).toBe(true);

    await deleteWidget(admin, widget.id);
    const remaining = await listWidgetsForShop(shop.id);
    expect(remaining).toHaveLength(0);
  });

  it("syncs published:false when deleting a published PRODUCT_PAGE_REELS widget", async () => {
    const shop = await getOrCreateShop("widget-delete-sync.myshopify.com");
    const widget = await createWidget(shop.id, "PRODUCT_PAGE_REELS", "Deleted", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(widget.id, true);
    let capturedSetVariables: Record<string, unknown> | undefined;
    const admin = {
      graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
        if (query.includes("GetShopId")) {
          return { json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" } } }) };
        }
        capturedSetVariables = options?.variables;
        return { json: async () => ({ data: { metafieldsSet: { userErrors: [] } } }) };
      },
    };

    await deleteWidget(admin, widget.id);

    expect(capturedSetVariables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "product_page_reels_widget",
          type: "json",
          value: JSON.stringify({
            published: false,
            targetRule: { type: "all_products" },
          }),
        },
      ],
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/models/widget.server.test.ts`
Expected: FAIL — `deleteWidget` still takes 1 arg.

- [ ] **Step 3: Implement**

Replace the existing `deleteWidget` function in `app/models/widget.server.ts`:

```typescript
export async function deleteWidget(admin: AdminGraphqlClient, id: string): Promise<void> {
  const existing = await prisma.widget.findUnique({ where: { id } });
  await prisma.widget.delete({ where: { id } });
  if (existing) {
    await syncWidgetConfigMetafield(admin, { ...existing, published: false });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/models/widget.server.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `app/routes/app.widgets.$id.tsx` — fixed next in Task 6.

- [ ] **Step 6: Commit**

```bash
git add app/models/widget.server.ts app/models/widget.server.test.ts
git commit -m "feat(widget.server): sync shop metafield on widget delete"
```

---

### Task 6: Wire `admin` into `app.widgets.$id.tsx`

Route currently destructures only `session` from `authenticate.admin(request)`. Now needs `admin` too, to pass into the three model functions whose signatures changed in Tasks 3-5.

**Files:**
- Modify: `app/routes/app.widgets.$id.tsx`

**Interfaces:**
- Consumes: `updateWidget(admin, id, updates)`, `updateWidgetTargetRule(admin, id, targetRule)`, `deleteWidget(admin, id)` (Tasks 3-5).

- [ ] **Step 1: Update the action's destructuring and call sites**

In `app/routes/app.widgets.$id.tsx`, change:

```typescript
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
```

to:

```typescript
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
```

Then update the three call sites further down in the same function:

```typescript
  if (intent === "set-target") {
    const handles = formData.getAll("productHandle").map(String).filter(Boolean);
    const targetRule: WidgetConfig["targetRule"] =
      handles.length > 0 ? { type: "handles", handles } : { type: "all_products" };
    await updateWidgetTargetRule(admin, widget.id, targetRule);
    return { error: null };
  }

  if (intent === "clear-target") {
    await updateWidgetTargetRule(admin, widget.id, { type: "all_products" });
    return { error: null };
  }

  if (intent === "delete") {
    await deleteWidget(admin, widget.id);
    return redirect("/app/widgets");
  }
```

and:

```typescript
  await updateWidget(admin, widget.id, { name, published });
  return { error: null };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the project.

- [ ] **Step 3: Manual smoke test**

With the dev server running (`shopify app dev`), open the Widgets popup for a `PRODUCT_PAGE_REELS` widget, toggle Published on, save, and confirm no error is shown in the modal (the `editFetcher.data?.error` paragraph stays empty). This exercises the full route → model → Shopify GraphQL path with a real `admin` client.

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.widgets.$id.tsx
git commit -m "feat(admin): pass admin client into widget model calls for metafield sync"
```

---

### Task 7: Gate the Liquid block on the widget metafield

The actual storefront-visible behavior change: the block now renders nothing unless a published `PRODUCT_PAGE_REELS` widget exists and its `targetRule` matches the current product.

**Files:**
- Modify: `extensions/shoppable-video-widgets/blocks/product-page-reels.liquid`

**Interfaces:**
- Consumes: shop metafield `namespace: "$app", key: "product_page_reels_widget"`, JSON shape `{ published: boolean, targetRule: { type: "all_products" } | { type: "handles", handles: string[] } }` (written by `syncWidgetConfigMetafield`, Task 2).

- [ ] **Step 1: Add widget gating before the existing reel loop**

In `extensions/shoppable-video-widgets/blocks/product-page-reels.liquid`, replace:

```liquid
{{ 'product-page-reels.css' | asset_url | stylesheet_tag }}

{% capture reel_namespace %}{% render 'reel-namespace' %}{% endcapture %}
{% assign reel_namespace = reel_namespace | strip %}
{% assign reels_field = block.settings.product.metafields[reel_namespace].reels %}

{% assign visible_count = 0 %}
{% for reel in reels_field.value %}
  {% if reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
    {% assign visible_count = visible_count | plus: 1 %}
  {% endif %}
{% endfor %}

{% if visible_count > 0 %}
```

with:

```liquid
{{ 'product-page-reels.css' | asset_url | stylesheet_tag }}

{% capture reel_namespace %}{% render 'reel-namespace' %}{% endcapture %}
{% assign reel_namespace = reel_namespace | strip %}

{% assign widget_field = shop.metafields[reel_namespace].product_page_reels_widget %}
{% assign widget_matches_product = false %}
{% if widget_field.value.published %}
  {% if widget_field.value.targetRule.type == "all_products" %}
    {% assign widget_matches_product = true %}
  {% elsif widget_field.value.targetRule.type == "handles" and widget_field.value.targetRule.handles contains product.handle %}
    {% assign widget_matches_product = true %}
  {% endif %}
{% endif %}

{% assign reels_field = block.settings.product.metafields[reel_namespace].reels %}

{% assign visible_count = 0 %}
{% if widget_matches_product %}
  {% for reel in reels_field.value %}
    {% if reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
      {% assign visible_count = visible_count | plus: 1 %}
    {% endif %}
  {% endfor %}
{% endif %}

{% if visible_count > 0 %}
```

The rest of the file (the `{% for reel in reels_field.value %}` rendering block, and the trailing `{% if visible_count > 0 %}<script ...%}` block) stays exactly as-is — `visible_count` now naturally stays `0` whenever `widget_matches_product` is false, so no other condition needs to change.

- [ ] **Step 2: Manual verification in a real theme**

No automated Liquid test harness exists in this repo. With the dev server running and the app installed on a dev store:

1. Confirm the block renders nothing on a product with tagged, published, ready reels when no `PRODUCT_PAGE_REELS` widget is published (create the widget but leave it unpublished, or don't create one at all).
2. Publish a `PRODUCT_PAGE_REELS` widget with `targetRule: all_products` (the default for a newly created widget) — confirm the block now renders on that product.
3. Edit the widget's target to specific handles that do NOT include the test product — confirm the block stops rendering.
4. Add the test product's handle to the target list — confirm the block renders again.
5. **Verify the namespace resolution assumption**: confirm `shop.metafields[reel_namespace]` actually resolves the shop-owned `$app` metafield the same way `reel-namespace.liquid`'s docstring confirmed it does for product-owned metafields. If it does NOT resolve (block silently never renders even with step 2-4 passing conditions), the `$app` namespace string is owner-type-specific and this task needs a follow-up fix — stop and report back rather than guessing at a workaround.

- [ ] **Step 3: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/product-page-reels.liquid
git commit -m "feat(storefront): gate product-page-reels block on published widget + targetRule"
```

---

## Post-plan note

Tasks 1-7 cover only `PRODUCT_PAGE_REELS`. Carousel, Grid, Stories, and Reel Pops still have zero storefront implementation — that's a separate spec/plan per the brainstorming decomposition.
