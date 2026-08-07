# Admin Video Preview + Widget Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a merchant watch an uploaded reel from the admin, see at a glance from the reels list whether a reel has tagged products, and manage widgets (edit, delete, target specific products) with the same functionality reels already have.

**Architecture:** Reel preview uses Cloudflare's own iframe embed (`iframe.videodelivery.net/{uid}`) — no custom player, no vendored JS, admin-only so performance constraints don't apply. Widgets get a new `/app/widgets/$id` detail route mirroring the already-shipped `/app/reels/$id` pattern (loader fetches + 404s, action handles named intents, App Bridge `ResourcePicker` for targeting) — three new model functions (`getWidget`, `updateWidget`, `updateWidgetTargetRule`) added to the existing `widget.server.ts`, whose `WidgetConfig.targetRule` type already supports the `{ type: "handles", handles: string[] }` shape this needs.

**Tech Stack:** React Router file routes (existing convention), Polaris web components (`s-*`), `@shopify/app-bridge-react`'s `useAppBridge`/`resourcePicker` (already used in `app.reels.$id.tsx`, same pattern reused here), Prisma (widgets are DB-backed, not metaobject-backed like reels), Vitest with a real SQLite test database (existing `widget.server.test.ts` pattern — NOT mocked `admin.graphql`, since widgets have no Shopify Admin API dependency).

## Global Constraints

- **Widget targeting uses `handles: string[]`, NOT product GIDs.** This is the single most important distinction from the reels plan: `WidgetConfig.targetRule` (already defined in `widget.server.ts:13-15`, unmodified by this plan) is `{ type: "all_products" } | { type: "handles", handles: string[] }`. The App Bridge resource picker's selected-product objects carry both `id` (GID) and `handle` (string) — this plan's picker code must map to `.handle`, NOT `.id`, when constructing `targetRule`. Copying reels' `config.productIds` pattern (which uses `.id`) verbatim into the widget picker is the exact bug this constraint exists to prevent — call this out explicitly in your own report if you catch yourself about to do it.
- **"Clear targeting" resets to `{ type: "all_products" }`, not `{ type: "handles", handles: [] }`.** These are two different valid states in the existing type; an empty-handles-array is NOT the same as all-products and must never be silently substituted for it.
- **Reel preview is a Cloudflare iframe embed, not a custom player.** URL: `https://iframe.videodelivery.net/{cloudflareStreamUid}`. No hls.js, no vendored assets, no lazy-loading logic — this is deliberately simple because it's an admin-only, single-instance-per-page embed, unlike the storefront's performance-driven custom player.
- **No new Shopify scope, no new Prisma migration.** `Widget`'s existing schema (`prisma/schema.prisma:64-76`) already has every field this plan needs (`id`, `shopId`, `name`, `type`, `config`, `published`) — do not add a migration.
- **No feature work beyond spec:** no bulk actions, no widget "template style" editor, no per-widget-type settings beyond targeting, no change to `WidgetConfig`'s shape (it already supports everything needed).

---

## File Structure

- `app/models/widget.server.ts` — modify: add `getWidget(shopId, id)`, `updateWidget(id, updates)`, `updateWidgetTargetRule(id, targetRule)`.
- `app/models/widget.server.test.ts` — modify: add tests for the three new functions (file already exists with real-Prisma-DB test pattern for `createWidget`/`listWidgetsForShop`/`setWidgetPublished`/`deleteWidget`).
- `app/routes/app.widgets.tsx` — modify: add Published-status badge column, make Name cell a link to `/app/widgets/$id`.
- `app/routes/app.widgets.$id.tsx` — create: widget detail page (edit name, published toggle, delete, product targeting).
- `app/routes/app.reels.$id.tsx` — modify: add video preview section (Cloudflare iframe embed).
- `app/routes/app.reels.tsx` — modify: add "Products" tagged-count column to the list table.

---

### Task 1: Widget model layer — `getWidget`, `updateWidget`, `updateWidgetTargetRule`

**Files:**
- Modify: `app/models/widget.server.ts`
- Modify: `app/models/widget.server.test.ts`

**Interfaces:**
- Produces: `getWidget(shopId: string, id: string): Promise<Widget | null>`, `updateWidget(id: string, updates: { name?: string; published?: boolean }): Promise<Widget>`, `updateWidgetTargetRule(id: string, targetRule: WidgetConfig["targetRule"]): Promise<Widget>` — all exported, consumed by Task 3 (edit/delete) and Task 4 (targeting).

- [ ] **Step 1: Write the failing tests**

Add to `app/models/widget.server.test.ts`, inside the existing `describe("widget.server", ...)` block:

```ts
  it("gets a widget scoped to its shop, returns null for a different shop or missing id", async () => {
    const shopA = await getOrCreateShop("widget-get-a.myshopify.com");
    const shopB = await getOrCreateShop("widget-get-b.myshopify.com");
    const widget = await createWidget(shopA.id, "GRID", "A grid", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });

    const found = await getWidget(shopA.id, widget.id);
    expect(found?.id).toBe(widget.id);

    const wrongShop = await getWidget(shopB.id, widget.id);
    expect(wrongShop).toBeNull();

    const missing = await getWidget(shopA.id, "nonexistent-id");
    expect(missing).toBeNull();
  });

  it("updates a widget's name and published flag", async () => {
    const shop = await getOrCreateShop("widget-update.myshopify.com");
    const widget = await createWidget(shop.id, "CAROUSEL", "Original name", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });

    const updated = await updateWidget(widget.id, {
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

    const updated = await updateWidget(widget.id, { published: true });

    expect(updated.name).toBe("Keep my name");
    expect(updated.published).toBe(true);
  });

  it("updates a widget's targetRule to specific product handles", async () => {
    const shop = await getOrCreateShop("widget-target-handles.myshopify.com");
    const widget = await createWidget(shop.id, "REEL_POPS", "Targeted pop", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });

    const updated = await updateWidgetTargetRule(widget.id, {
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

    const updated = await updateWidgetTargetRule(widget.id, { type: "all_products" });

    expect(updated.config).toEqual({
      templateStyle: "bold",
      targetRule: { type: "all_products" },
    });
  });
```

Update the import at the top of the file:

```ts
import {
  createWidget,
  listWidgetsForShop,
  setWidgetPublished,
  deleteWidget,
  getWidget,
  updateWidget,
  updateWidgetTargetRule,
} from "./widget.server";
import type { WidgetConfig } from "./widget.server";
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `getWidget`/`updateWidget`/`updateWidgetTargetRule` are not exported yet.

- [ ] **Step 3: Write the implementation**

In `app/models/widget.server.ts`, add after `deleteWidget`:

```ts
export async function getWidget(
  shopId: string,
  id: string,
): Promise<Widget | null> {
  return prisma.widget.findFirst({ where: { id, shopId } });
}

export async function updateWidget(
  id: string,
  updates: { name?: string; published?: boolean },
): Promise<Widget> {
  return prisma.widget.update({ where: { id }, data: updates });
}

export async function updateWidgetTargetRule(
  id: string,
  targetRule: WidgetConfig["targetRule"],
): Promise<Widget> {
  const existing = await prisma.widget.findUniqueOrThrow({ where: { id } });
  const existingConfig = existing.config as unknown as WidgetConfig;
  const mergedConfig: WidgetConfig = { ...existingConfig, targetRule };

  return prisma.widget.update({
    where: { id },
    data: { config: mergedConfig as unknown as Prisma.InputJsonValue },
  });
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — all tests across all model test files green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add app/models/widget.server.ts app/models/widget.server.test.ts
git commit -m "feat(admin): add getWidget/updateWidget/updateWidgetTargetRule model functions"
```

---

### Task 2: Widgets list — Published-status column, row links to detail page

**Files:**
- Modify: `app/routes/app.widgets.tsx`

**Interfaces:**
- Consumes: `Widget` type (existing, unmodified — Prisma-generated).

- [ ] **Step 1: Update the table to add row links**

In `app/routes/app.widgets.tsx`, replace the `<s-table>` block inside `Widgets` (the one rendering `widgets.map(...)`) with:

```tsx
<s-table variant="list">
  <s-table-header-row>
    <s-table-header listSlot="primary">Name</s-table-header>
    <s-table-header listSlot="labeled">Type</s-table-header>
    <s-table-header listSlot="inline">Status</s-table-header>
  </s-table-header-row>
  <s-table-body>
    {widgets.map((widget) => (
      <s-table-row key={widget.id}>
        <s-table-cell>
          <s-link href={`/app/widgets/${encodeURIComponent(widget.id)}`}>
            {widget.name}
          </s-link>
        </s-table-cell>
        <s-table-cell>{widget.type}</s-table-cell>
        <s-table-cell>
          <s-badge tone={widget.published ? "success" : "neutral"}>
            {widget.published ? "Published" : "Draft"}
          </s-badge>
        </s-table-cell>
      </s-table-row>
    ))}
  </s-table-body>
</s-table>
```

(This is functionally the same table as before — Name/Type/Status columns already existed — the only change is wrapping the Name cell's text in an `<s-link>` pointing at the new detail route. No new column is added in this task; Task 2's job is just making rows navigable, matching what reels' Task 2 did in the prior plan.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes. `s-link` is already used elsewhere in this project (`app.tsx`, `app.reels.tsx`) — no new component types needed.

- [ ] **Step 3: Run the full test suite as a sanity check**

Run: `npm test`
Expected: PASS — this task has no new test file (route-level testing out of scope, established in the prior plan), confirm nothing else broke.

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.widgets.tsx
git commit -m "feat(admin): link widget list rows to detail page"
```

---

### Task 3: Widget detail page — view/edit name, published toggle, delete

**Files:**
- Create: `app/routes/app.widgets.$id.tsx`

**Interfaces:**
- Consumes: `getWidget`, `updateWidget`, `deleteWidget` (Task 1 + existing, unmodified).
- Produces: route `/app/widgets/:id` — extended by Task 4 (targeting) in the same file.

- [ ] **Step 1: Create the detail route**

Create `app/routes/app.widgets.$id.tsx`:

```tsx
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { deleteWidget, getWidget, updateWidget } from "../models/widget.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widget = await getWidget(shop.id, params.id!);
  if (!widget) {
    throw new Response("Widget not found", { status: 404 });
  }
  return { widget };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widget = await getWidget(shop.id, params.id!);
  if (!widget) {
    throw new Response("Widget not found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    await deleteWidget(widget.id);
    return redirect("/app/widgets");
  }

  const name = String(formData.get("name") ?? "").trim();
  const published = formData.get("published") != null;

  if (!name) {
    return { error: "Name is required" };
  }

  await updateWidget(widget.id, { name, published });
  return { error: null };
};

export default function WidgetDetail() {
  const { widget } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting =
    navigation.formData?.get("intent") == null &&
    navigation.state === "submitting";

  return (
    <s-page heading={widget.name}>
      <s-link href="/app/widgets">Back to widgets</s-link>
      <s-section heading="Details">
        <s-stack gap="base">
          {actionData?.error && (
            <s-paragraph tone="critical">{actionData.error}</s-paragraph>
          )}
          <s-paragraph>
            Type: <s-text>{widget.type}</s-text>
          </s-paragraph>
          <Form method="post">
            <s-stack gap="base">
              <s-text-field
                label="Name"
                name="name"
                defaultValue={widget.name}
                required
              ></s-text-field>
              <s-checkbox
                label="Published"
                name="published"
                defaultChecked={widget.published}
              ></s-checkbox>
              <s-button
                type="submit"
                variant="primary"
                {...(isSubmitting ? { loading: true } : {})}
              >
                Save
              </s-button>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>
      <s-section heading="Danger zone">
        <Form
          method="post"
          onSubmit={(e) => {
            if (!confirm("Delete this widget? This can't be undone.")) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <s-button type="submit" variant="secondary" tone="critical">
            Delete widget
          </s-button>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

Note: `getWidget` is called TWICE — once in the loader, once in the action — same pattern as `app.reels.$id.tsx`'s `getReel` calls, for the same reason (loaders and actions run in separate request lifecycles). This is correct, not redundant.

Note: this task deliberately does not yet render product targeting — that's Task 4, added on top of this file.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes. If `s-button`'s `tone="critical"` prop or any other prop fails to typecheck against this project's installed Polaris web component types, drop that specific prop (keep `variant="secondary"` only) and note in your report which form you used — this project's prior task (reels' detail page) hit this exact situation with `s-page`'s `backAction` prop, so check the installed `@shopify/polaris-types` package if anything here doesn't typecheck cleanly, same troubleshooting approach.

- [ ] **Step 3: Run the full test suite as a sanity check**

Run: `npm test`
Expected: PASS — this task has no new test file (route-level testing out of scope), confirm nothing broke.

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.widgets.\$id.tsx
git commit -m "feat(admin): add widget detail page with edit and delete"
```

---

### Task 4: Widget product targeting via ResourcePicker

**Files:**
- Modify: `app/routes/app.widgets.$id.tsx`

**Interfaces:**
- Consumes: `updateWidgetTargetRule` (Task 1), `useAppBridge` from `@shopify/app-bridge-react` (already used in `app.reels.$id.tsx` — same API shape, already verified against the installed package version in the prior plan; no re-investigation needed).

- [ ] **Step 1: Extend the action with a `set-target` intent**

In `app/routes/app.widgets.$id.tsx`, add the import:

```ts
import { deleteWidget, getWidget, updateWidget, updateWidgetTargetRule } from "../models/widget.server";
import type { WidgetConfig } from "../models/widget.server";
```

Add a new intent branch in the `action` function, above the `delete` branch:

```ts
  if (intent === "set-target") {
    const handles = formData.getAll("productHandle").map(String);
    const targetRule: WidgetConfig["targetRule"] =
      handles.length > 0 ? { type: "handles", handles } : { type: "all_products" };
    await updateWidgetTargetRule(widget.id, targetRule);
    return { error: null };
  }

  if (intent === "clear-target") {
    await updateWidgetTargetRule(widget.id, { type: "all_products" });
    return { error: null };
  }
```

(Two intents: `set-target` writes whatever the picker selected — if the merchant deselects everything and submits, it falls back to `all_products` since an empty `handles: []` is not a meaningful "target nothing" state per Global Constraints; `clear-target` is a dedicated one-click reset button, kept separate so a merchant can reset without opening the picker at all.)

- [ ] **Step 2: Add the picker UI**

Add the imports:

```ts
import { useAppBridge } from "@shopify/app-bridge-react";
import { useFetcher } from "react-router";
```

(merge `useFetcher` into the existing `react-router` import line)

Inside `WidgetDetail`, before the `return`, read the current target rule and wire the picker:

```tsx
  const shopify = useAppBridge();
  const targetFetcher = useFetcher();
  const targetRule = (widget.config as unknown as WidgetConfig).targetRule;
  const currentHandles = targetRule.type === "handles" ? targetRule.handles : [];

  const handlePickProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
    });
    if (!selected) return;

    const formData = new FormData();
    formData.set("intent", "set-target");
    for (const product of selected) {
      formData.append("productHandle", product.handle);
    }
    targetFetcher.submit(formData, { method: "post" });
  };

  const handleClearTarget = () => {
    const formData = new FormData();
    formData.set("intent", "clear-target");
    targetFetcher.submit(formData, { method: "post" });
  };
```

Note: unlike `app.reels.$id.tsx`'s picker (which pre-selects currently-tagged products via `selectionIds: taggedProducts.map(p => ({id: p.id}))`, because it has product GIDs on hand from `getProductsByIds`), this picker does NOT pass `selectionIds` — `WidgetConfig.targetRule`'s `handles: string[]` gives us handles, not GIDs, and resolving handles back to GIDs just to pre-select them would require a new Admin GraphQL lookup this task doesn't otherwise need. Opening the picker without pre-selection is an acceptable, deliberate simplification here — the merchant re-picks the full desired set each time, they don't need to see the previous selection highlighted. Do not add a GID-resolution lookup to work around this; it's explicitly out of scope.

Add a new section in the JSX, between "Details" and "Danger zone":

```tsx
      <s-section heading="Target products">
        <s-stack gap="base">
          {targetFetcher.data?.error && (
            <s-paragraph tone="critical">{targetFetcher.data.error}</s-paragraph>
          )}
          {targetRule.type === "all_products" ? (
            <s-paragraph>Showing on all products.</s-paragraph>
          ) : (
            <s-stack gap="small">
              <s-paragraph>Targeting {currentHandles.length} product(s):</s-paragraph>
              {currentHandles.map((handle) => (
                <s-paragraph key={handle}>{handle}</s-paragraph>
              ))}
            </s-stack>
          )}
          <s-button
            onClick={handlePickProducts}
            {...(targetFetcher.state !== "idle" ? { loading: true } : {})}
          >
            Choose products
          </s-button>
          {targetRule.type === "handles" && (
            <s-button onClick={handleClearTarget} variant="secondary">
              Target all products instead
            </s-button>
          )}
        </s-stack>
      </s-section>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Add a model-layer confirmation (no new test needed)**

`updateWidgetTargetRule`'s `all_products`-vs-`handles` behavior is already fully covered by Task 1's two tests (`"updates a widget's targetRule to specific product handles"` and `"resets a widget's targetRule to all_products..."`). This task's route-level `set-target`/`clear-target` branches call that already-tested function directly with no additional merge logic of their own — re-read the action code you just wrote and confirm it doesn't reimplement any of `updateWidgetTargetRule`'s merge behavior inline (it shouldn't; it should be a thin pass-through). If you find yourself duplicating logic, stop and simplify to a direct call instead.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — no new tests this task, confirm nothing broke.

- [ ] **Step 6: Note on verification**

The `ResourcePicker` UI interaction cannot be exercised in this environment (no live Shopify admin session) — state this plainly in your report, consistent with this project's established pattern.

- [ ] **Step 7: Commit**

```bash
git add app/routes/app.widgets.\$id.tsx
git commit -m "feat(admin): add product targeting to widget detail page"
```

---

### Task 5: Reel video preview

**Files:**
- Modify: `app/routes/app.reels.$id.tsx`

**Interfaces:**
- Consumes: `reel.config.cloudflareStreamUid` (existing field, no model change needed).

- [ ] **Step 1: Add the preview section**

In `app/routes/app.reels.$id.tsx`, add a new `<s-section heading="Preview">` as the FIRST section inside `<s-page>` (before the existing "Details" section):

```tsx
      <s-section heading="Preview">
        {reel.config.cloudflareStreamUid ? (
          <iframe
            src={`https://iframe.videodelivery.net/${reel.config.cloudflareStreamUid}`}
            style={{ border: "none", aspectRatio: "9 / 16", width: "100%", maxWidth: "280px" }}
            allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture"
            allowFullScreen
          ></iframe>
        ) : (
          <s-paragraph>No video uploaded yet.</s-paragraph>
        )}
      </s-section>
```

Note: this reads `reel.config.cloudflareStreamUid` directly — the exact same field name Task 1 of the prior plan (`deriveReelStatus`) already reads for its `"processing"`/`"ready"` distinction. No new field, no new model function.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes. A raw `<iframe>` is a standard HTML element (not a Polaris `s-*` web component) — no special typing concerns, but confirm React's inline `style` prop accepts the object literal as written (it should; this is standard React/JSX).

- [ ] **Step 3: Run the full test suite as a sanity check**

Run: `npm test`
Expected: PASS — no new test file (presentational-only change, no new model logic), confirm nothing broke.

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.reels.\$id.tsx
git commit -m "feat(admin): add Cloudflare iframe video preview to reel detail page"
```

---

### Task 6: Reels list — "Products" tagged-count column

**Files:**
- Modify: `app/routes/app.reels.tsx`

**Interfaces:**
- Consumes: `reel.config.productIds` (existing field, no model change needed).

- [ ] **Step 1: Add the Products column**

In `app/routes/app.reels.tsx`, add a new `<s-table-header listSlot="inline">Products</s-table-header>` to the `<s-table-header-row>`, after the existing "Status" header, and a matching `<s-table-cell>` in each row:

```tsx
<s-table-header-row>
  <s-table-header listSlot="primary">Title</s-table-header>
  <s-table-header listSlot="inline">Published</s-table-header>
  <s-table-header listSlot="inline">Status</s-table-header>
  <s-table-header listSlot="inline">Products</s-table-header>
</s-table-header-row>
<s-table-body>
  {reels.map((reel) => {
    const status = deriveReelStatus(reel.config);
    const statusTone =
      status === "ready"
        ? "success"
        : status === "failed"
          ? "critical"
          : status === "processing"
            ? "info"
            : "neutral";
    const productCount = reel.config.productIds.length;
    return (
      <s-table-row key={reel.id}>
        <s-table-cell>
          <s-link href={`/app/reels/${encodeURIComponent(reel.id)}`}>
            {reel.title}
          </s-link>
        </s-table-cell>
        <s-table-cell>
          <s-badge tone={reel.published ? "success" : "neutral"}>
            {reel.published ? "Published" : "Draft"}
          </s-badge>
        </s-table-cell>
        <s-table-cell>
          <s-badge tone={statusTone}>{REEL_STATUS_LABELS[status]}</s-badge>
        </s-table-cell>
        <s-table-cell>
          <s-badge tone={productCount > 0 ? "success" : "neutral"}>
            {productCount > 0 ? `${productCount} tagged` : "Untagged"}
          </s-badge>
        </s-table-cell>
      </s-table-row>
    );
  })}
</s-table-body>
```

(This shows the full row's current content, with only the new Products header + cell added — `REEL_STATUS_LABELS` already exists in this file from a prior fix, use it as-is, do not redefine it.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Run the full test suite as a sanity check**

Run: `npm test`
Expected: PASS — no new test file, confirm nothing broke.

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.reels.tsx
git commit -m "feat(admin): show tagged-product count on reels list"
```

---

## Self-Review

**Spec coverage:** Reel video preview ✓ Task 5. Product-tagging discoverability (count column) ✓ Task 6. Widget edit/delete ✓ Task 3. Widget targeting (specific products, handles-based) ✓ Task 4, built on Task 1's model functions. Widget list status/links ✓ Task 2. All six spec items covered; no gaps found.

**Placeholder scan:** none. The picker's deliberate no-pre-selection simplification (Task 4) is explained inline with its reasoning, not hidden as a TODO.

**Type consistency:** `getWidget(shopId, id)` (Task 1) returns `Widget | null`, consumed identically by Task 3's loader (404 on null) and action (404 on null, re-fetched separately — same dual-fetch pattern as reels). `updateWidgetTargetRule`'s parameter type `WidgetConfig["targetRule"]` (Task 1) is the exact same union Task 4's action branches construct (`{type:"handles", handles} | {type:"all_products"}`) — no drift. `REEL_STATUS_LABELS` (Task 6) references the existing map from `app.reels.tsx` rather than redefining it, avoiding the two-implementations risk called out in the prior plan's own self-review.
