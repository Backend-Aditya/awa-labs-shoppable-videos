# Widget Template Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 4 new storefront widget templates (Single video, Stacked carousel, Insta-style stories, Reel pops) and replace the admin's plain widget-type dropdown with a visual template-picker gallery.

**Architecture:** Generalize the existing `PRODUCT_PAGE_REELS`-only shop-metafield sync (`syncShopWidgetState`) to work per-kind via a lookup table. 3 templates stay product-page-scoped (same block/targetRule mechanism as today's `product-page-reels.liquid`); Reel pops is site-wide via a theme app-embed block. Two kinds (`SINGLE_VIDEO`, `REEL_POPS`) need a merchant-picked "featured reel," synced as a native `metaobject_reference<$app:reel>` shop metafield (same reason `tagged_products` had to be a native field, not raw JSON — Liquid can't dereference a bare GID string).

**Tech Stack:** React Router 7, Prisma/SQLite, Shopify Admin GraphQL, Liquid (theme app extension), Vitest.

## Global Constraints

- `syncShopWidgetState`'s existing "at most one published widget per `shopId`+`type`" invariant (enforced in `updateWidget`) is unchanged — this plan only changes what gets synced and to which metafield key, not the exclusivity rule itself.
- Every metafield write for a templated kind must derive from the shop's **current DB state** for that kind, never from "whichever widget was just touched" — this is the exact clobbering bug fixed in the previous plan (`docs/superpowers/plans/2026-08-10-widget-storefront-wiring.md`), and the same risk applies to every new kind added here.
- `GRID` stays unimplemented (out of scope, per the design spec) — it must remain a no-op in the sync map, not error.
- No pixel-for-pixel cloning of any third-party product's design or copy — original implementation only, per the design spec's explicit scope note.
- No automated Liquid test harness exists in this repo — new blocks are verified manually in the theme editor, same as the previous plan.

---

### Task 1: Generalize `WidgetKind`, `WidgetConfig`, and `syncShopWidgetState` per-kind

**Files:**
- Modify: `app/models/widget.server.ts`
- Test: `app/models/widget.server.test.ts`

**Interfaces:**
- Produces: `WidgetKind` gains `"SINGLE_VIDEO"`. `WidgetConfig` gains optional `featuredReelId?: string`. `syncShopWidgetState(admin: AdminGraphqlClient, shopId: string, kind: WidgetKind, options?: { force?: boolean }): Promise<void>` — signature changed, now takes `kind` as a required third argument. `updateWidgetFeaturedReel(admin: AdminGraphqlClient, id: string, featuredReelId: string): Promise<Widget>` — new function, same shape as `updateWidgetTargetRule`.
- Consumes (unchanged): `AdminGraphqlClient`, `assertNoGraphqlErrors`, `throwOnUserErrors` from `./reel.server`.

- [ ] **Step 1: Write the failing tests**

Replace every existing call to `syncShopWidgetState(admin, shop.id)` / `syncShopWidgetState(admin, shop.id, { force: true })` in `app/models/widget.server.test.ts` with the new 3-arg form (add `"PRODUCT_PAGE_REELS"` as the third argument — every existing test in this file already uses that kind, so this is a mechanical addition, not a behavior change). For example:

```typescript
await syncShopWidgetState(admin, shop.id, "PRODUCT_PAGE_REELS");
```

and

```typescript
await syncShopWidgetState(admin, shop.id, "PRODUCT_PAGE_REELS", { force: true });
```

Then add these new tests to the `describe("syncShopWidgetState", ...)` block:

```typescript
  it("syncs a different kind to its own metafield key", async () => {
    const shop = await getOrCreateShop("sync-state-carousel.myshopify.com");
    const widget = await createWidget(shop.id, "CAROUSEL", "Live carousel", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
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
      ],
    });
  });

  it("makes no Shopify calls for GRID, which has no sync config", async () => {
    const shop = await getOrCreateShop("sync-state-grid.myshopify.com");
    await createWidget(shop.id, "GRID", "A grid", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "GRID");

    expect(recorder.callCount).toBe(0);
  });

  it("includes the featured-reel reference field for SINGLE_VIDEO when one is set", async () => {
    const shop = await getOrCreateShop("sync-state-single-video.myshopify.com");
    const widget = await createWidget(shop.id, "SINGLE_VIDEO", "Featured video", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
      featuredReelId: "gid://shopify/Metaobject/999",
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "SINGLE_VIDEO");

    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "single_video_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "single_video_featured_reel",
          type: "metaobject_reference",
          value: "gid://shopify/Metaobject/999",
        },
      ],
    });
  });

  it("omits the featured-reel field for SINGLE_VIDEO when none is set", async () => {
    const shop = await getOrCreateShop("sync-state-single-video-none.myshopify.com");
    const widget = await createWidget(shop.id, "SINGLE_VIDEO", "No reel yet", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    await syncShopWidgetState(admin, shop.id, "SINGLE_VIDEO");

    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "single_video_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
      ],
    });
  });
```

Add this new `describe` block for `updateWidgetFeaturedReel`:

```typescript
describe("updateWidgetFeaturedReel", () => {
  beforeEach(async () => {
    await prisma.widget.deleteMany();
    await prisma.shop.deleteMany();
  });

  it("sets featuredReelId on the widget's config and syncs", async () => {
    const shop = await getOrCreateShop("featured-reel-set.myshopify.com");
    const widget = await createWidget(shop.id, "SINGLE_VIDEO", "Featured", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await setWidgetPublished(widget.id, true);
    const { admin, recorder } = createRecordingAdmin();

    const updated = await updateWidgetFeaturedReel(admin, widget.id, "gid://shopify/Metaobject/42");

    expect((updated.config as { featuredReelId?: string }).featuredReelId).toBe(
      "gid://shopify/Metaobject/42",
    );
    expect(recorder.variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "single_video_widget",
          type: "json",
          value: JSON.stringify({ published: true, targetRule: { type: "all_products" } }),
        },
        {
          ownerId: "gid://shopify/Shop/1",
          namespace: "$app",
          key: "single_video_featured_reel",
          type: "metaobject_reference",
          value: "gid://shopify/Metaobject/42",
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx dotenv -e .env.test -o -- npx vitest run app/models/widget.server.test.ts` (needs the migrated test DB — run `npm test` once first if `test.sqlite` isn't migrated yet).
Expected: FAIL — `syncShopWidgetState` still takes 2 args, `updateWidgetFeaturedReel` doesn't exist, `SINGLE_VIDEO`/`featuredReelId` aren't valid types.

- [ ] **Step 3: Implement**

In `app/models/widget.server.ts`, change the `WidgetKind` and `WidgetConfig` types:

```typescript
export type WidgetKind =
  | "PRODUCT_PAGE_REELS"
  | "CAROUSEL"
  | "GRID"
  | "STORIES"
  | "REEL_POPS"
  | "SINGLE_VIDEO";

export interface WidgetConfig {
  templateStyle: string;
  targetRule:
    | { type: "all_products" }
    | { type: "handles"; handles: string[] };
  featuredReelId?: string;
}
```

Replace the entire block from `interface WidgetMetafieldValue` to the end of the file with:

```typescript
interface WidgetMetafieldValue {
  published: boolean;
  targetRule: WidgetConfig["targetRule"];
}

interface WidgetKindSyncConfig {
  metafieldKey: string;
  featuredReelMetafieldKey?: string;
}

const WIDGET_KIND_SYNC_CONFIG: Partial<Record<WidgetKind, WidgetKindSyncConfig>> = {
  PRODUCT_PAGE_REELS: { metafieldKey: "product_page_reels_widget" },
  SINGLE_VIDEO: {
    metafieldKey: "single_video_widget",
    featuredReelMetafieldKey: "single_video_featured_reel",
  },
  CAROUSEL: { metafieldKey: "stacked_carousel_widget" },
  STORIES: { metafieldKey: "insta_stories_widget" },
  REEL_POPS: {
    metafieldKey: "reel_pops_widget",
    featuredReelMetafieldKey: "reel_pops_featured_reel",
  },
};

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

// Mirrors the shop's *current* state for one widget kind into that kind's
// shop-level metafield, so the storefront Liquid block for that kind (which
// has no access to this app's DB) can read it. Kinds absent from
// WIDGET_KIND_SYNC_CONFIG (GRID) are a no-op — no theme implementation
// reads a metafield for them yet, so writing one would just be dead data.
//
// The value is always DERIVED from the DB (the shop's one published widget
// of this kind, if any) rather than from whichever widget was just written
// — syncing "the widget that was just touched" would let an edit to an
// unrelated draft widget of the same kind clobber the live widget's state
// (this exact bug was fixed for PRODUCT_PAGE_REELS in the previous plan;
// every kind added here is subject to the same risk).
//
// `force` writes the metafield even when the shop has no widgets of this
// kind at all — needed by `deleteWidget`, which may have just removed the
// last one and still has to clear what it wrote.
export async function syncShopWidgetState(
  admin: AdminGraphqlClient,
  shopId: string,
  kind: WidgetKind,
  options: { force?: boolean } = {},
): Promise<void> {
  const syncConfig = WIDGET_KIND_SYNC_CONFIG[kind];
  if (!syncConfig) return;

  const live = await prisma.widget.findFirst({
    where: { shopId, type: kind, published: true },
  });

  if (!live && !options.force) {
    const everOfKind = await prisma.widget.count({ where: { shopId, type: kind } });
    if (everOfKind === 0) return;
  }

  const liveConfig = live ? (live.config as unknown as WidgetConfig) : null;
  const value: WidgetMetafieldValue = liveConfig
    ? { published: true, targetRule: liveConfig.targetRule }
    : { published: false, targetRule: { type: "all_products" } };

  const shopGid = await getShopGid(admin);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- metafieldsSet input shape varies per entry (json vs metaobject_reference)
  const metafields: any[] = [
    {
      ownerId: shopGid,
      namespace: "$app",
      key: syncConfig.metafieldKey,
      type: "json",
      value: JSON.stringify(value),
    },
  ];

  if (syncConfig.featuredReelMetafieldKey && liveConfig?.featuredReelId) {
    metafields.push({
      ownerId: shopGid,
      namespace: "$app",
      key: syncConfig.featuredReelMetafieldKey,
      type: "metaobject_reference",
      value: liveConfig.featuredReelId,
    });
  }

  const response = await admin.graphql(
    `#graphql
    mutation SetWidgetConfigMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    { variables: { metafields } },
  );
  const json = await response.json();
  assertNoGraphqlErrors(json);
  throwOnUserErrors(json.data.metafieldsSet.userErrors);
}

export async function updateWidgetFeaturedReel(
  admin: AdminGraphqlClient,
  id: string,
  featuredReelId: string,
): Promise<Widget> {
  const existing = await prisma.widget.findUniqueOrThrow({ where: { id } });
  const existingConfig = existing.config as unknown as WidgetConfig;
  const mergedConfig: WidgetConfig = { ...existingConfig, featuredReelId };

  const widget = await prisma.widget.update({
    where: { id },
    data: { config: mergedConfig as unknown as Prisma.InputJsonValue },
  });
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
  return widget;
}
```

Update the three existing call sites in the same file to pass `kind`:

In `deleteWidget`:
```typescript
    await syncShopWidgetState(admin, existing.shopId, existing.type as WidgetKind, {
      force: true,
    });
```

(Note: `force` is now unconditionally `true` here, not `existing.type === "PRODUCT_PAGE_REELS"` — every kind needs the same "clear it, the last one may have just been deleted" behavior, not just PRODUCT_PAGE_REELS.)

In `updateWidget`:
```typescript
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
```

In `updateWidgetTargetRule`:
```typescript
  await syncShopWidgetState(admin, widget.shopId, widget.type as WidgetKind);
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
git commit -m "feat(widget.server): generalize shop-metafield sync to work per widget kind"
```

---

### Task 2: Declare the new shop metafields in `shopify.app.toml`

**Files:**
- Modify: `shopify.app.toml`

**Interfaces:**
- Produces: metafield definitions matching the keys `syncShopWidgetState` writes in Task 1 — `single_video_widget`, `single_video_featured_reel`, `stacked_carousel_widget`, `insta_stories_widget`, `reel_pops_widget`, `reel_pops_featured_reel`.

- [ ] **Step 1: Add the definitions**

In `shopify.app.toml`, after the existing `[shop.metafields.app.product_page_reels_widget]` block (and its nested `.access` block), add:

```toml
[shop.metafields.app.single_video_widget]
type = "json"
name = "Single video widget"
description = "Published state and target rule for the SINGLE_VIDEO widget"

  [shop.metafields.app.single_video_widget.access]
  admin = "merchant_read"
  storefront = "public_read"

[shop.metafields.app.single_video_featured_reel]
type = "metaobject_reference<$app:reel>"
name = "Single video featured reel"
description = "The one reel the SINGLE_VIDEO widget plays"

  [shop.metafields.app.single_video_featured_reel.access]
  admin = "merchant_read"
  storefront = "public_read"

[shop.metafields.app.stacked_carousel_widget]
type = "json"
name = "Stacked carousel widget"
description = "Published state and target rule for the CAROUSEL widget"

  [shop.metafields.app.stacked_carousel_widget.access]
  admin = "merchant_read"
  storefront = "public_read"

[shop.metafields.app.insta_stories_widget]
type = "json"
name = "Insta-style stories widget"
description = "Published state and target rule for the STORIES widget"

  [shop.metafields.app.insta_stories_widget.access]
  admin = "merchant_read"
  storefront = "public_read"

[shop.metafields.app.reel_pops_widget]
type = "json"
name = "Reel pops widget"
description = "Published state and target rule for the REEL_POPS widget"

  [shop.metafields.app.reel_pops_widget.access]
  admin = "merchant_read"
  storefront = "public_read"

[shop.metafields.app.reel_pops_featured_reel]
type = "metaobject_reference<$app:reel>"
name = "Reel pops featured reel"
description = "The one reel the REEL_POPS floating bubble plays"

  [shop.metafields.app.reel_pops_featured_reel.access]
  admin = "merchant_read"
  storefront = "public_read"
```

- [ ] **Step 2: Commit**

```bash
git add shopify.app.toml
git commit -m "feat(config): declare shop metafield definitions for the 4 new widget templates"
```

(This file change alone does nothing on the live store until a human runs `shopify app deploy` — call that out at the end of this plan's manual verification task, same as the previous plan required.)

---

### Task 3: Wire `set-featured-reel` into the widget detail route

**Files:**
- Modify: `app/routes/app.widgets.$id.tsx`

**Interfaces:**
- Consumes: `updateWidgetFeaturedReel(admin, id, featuredReelId)` (Task 1), `listReels(admin, limit)` (existing, from `../models/reel.server`).
- Produces: loader response gains `reels: Reel[]` (only populated for kinds that need a featured-reel picker — cheap for all others since it's an empty array); action handles a new `intent === "set-featured-reel"`.

- [ ] **Step 1: Update the loader**

In `app/routes/app.widgets.$id.tsx`, add the import:

```typescript
import { listReels } from "../models/reel.server";
```

Replace the loader:

```typescript
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widget = await getWidget(shop.id, params.id!);
  if (!widget) {
    throw new Response("Widget not found", { status: 404 });
  }

  const needsFeaturedReel = widget.type === "SINGLE_VIDEO" || widget.type === "REEL_POPS";
  const reels = needsFeaturedReel ? await listReels(admin, 50) : [];

  return { widget, reels };
};
```

- [ ] **Step 2: Add the action branch**

In the same file's `action`, add this branch alongside the existing `set-target`/`clear-target`/`delete` branches (before the trailing name/published update):

```typescript
  if (intent === "set-featured-reel") {
    const featuredReelId = String(formData.get("featuredReelId") ?? "");
    if (!featuredReelId) {
      return { error: "Choose a reel first" };
    }
    await updateWidgetFeaturedReel(admin, widget.id, featuredReelId);
    return { error: null };
  }
```

Update the import from `../models/widget.server` to include `updateWidgetFeaturedReel`:

```typescript
import { deleteWidget, getWidget, updateWidget, updateWidgetFeaturedReel, updateWidgetTargetRule } from "../models/widget.server";
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the standalone route file, `app.widgets.$id.tsx`, isn't rendered directly anymore since the app moved to the popup-modal pattern — but it must still typecheck cleanly, and its loader/action are what the modal's fetchers call).

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.widgets.$id.tsx
git commit -m "feat(admin): wire set-featured-reel intent into the widget detail action"
```

---

### Task 4: Template picker gallery + featured-reel picker in `app.widgets.tsx`

**Files:**
- Modify: `app/routes/app.widgets.tsx`

**Interfaces:**
- Consumes: `WidgetKind` (Task 1, now includes `SINGLE_VIDEO`), the loader's `reels` field (Task 3).

- [ ] **Step 1: Add template metadata and replace the dropdown**

In `app/routes/app.widgets.tsx`, replace:

```typescript
const WIDGET_KINDS: WidgetKind[] = [
  "PRODUCT_PAGE_REELS",
  "CAROUSEL",
  "GRID",
  "STORIES",
  "REEL_POPS",
];
```

with:

```typescript
interface WidgetTemplateMeta {
  kind: WidgetKind;
  name: string;
  description: string;
}

const WIDGET_TEMPLATES: WidgetTemplateMeta[] = [
  {
    kind: "PRODUCT_PAGE_REELS",
    name: "Product page reels",
    description: "A row of tagged reels on the product page.",
  },
  {
    kind: "SINGLE_VIDEO",
    name: "Single video",
    description: "One featured video, no carousel.",
  },
  {
    kind: "CAROUSEL",
    name: "Stacked carousel",
    description: "Tagged reels as a swipeable stacked deck.",
  },
  {
    kind: "STORIES",
    name: "Insta-style stories",
    description: "Circular avatars that open a full-screen story viewer.",
  },
  {
    kind: "REEL_POPS",
    name: "Reel pops",
    description: "A site-wide floating bubble that expands into a video.",
  },
];

const WIDGET_KINDS: WidgetKind[] = WIDGET_TEMPLATES.map((t) => t.kind);
```

Add a `TemplatePicker` component (place it above the `Widgets` default export function):

```typescript
function TemplatePicker({
  value,
  onChange,
}: {
  value: WidgetKind;
  onChange: (kind: WidgetKind) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: "8px",
      }}
    >
      {WIDGET_TEMPLATES.map((template) => (
        <button
          key={template.kind}
          type="button"
          onClick={() => onChange(template.kind)}
          style={{
            textAlign: "left",
            cursor: "pointer",
            padding: "10px",
            borderRadius: "8px",
            border: template.kind === value ? "2px solid #111" : "1px solid #d9d9d9",
            background: "#ffffff",
            font: "inherit",
            color: "inherit",
          }}
        >
          <div
            style={{
              height: "56px",
              borderRadius: "6px",
              background: "#f1f1f1",
              marginBottom: "8px",
            }}
          />
          <div style={{ fontWeight: 600, fontSize: "13px" }}>{template.name}</div>
          <div style={{ color: "#6b6b6b", fontSize: "12px" }}>{template.description}</div>
        </button>
      ))}
    </div>
  );
}
```

Replace the `<s-select>` inside the "Create a widget" `<Form>` — the whole `<s-select>...</s-select>` block — with a controlled hidden input driven by `TemplatePicker`. Since this requires component-level state, convert the "Create a widget" section into its own component. Replace this:

```typescript
      <s-section heading="Create a widget">
        {actionData?.error && (
          <s-paragraph tone="critical">{actionData.error}</s-paragraph>
        )}
        <Form method="post">
          <s-stack gap="base">
            <s-text-field label="Name" name="name" required></s-text-field>
            <s-select
              label="Type"
              name="type"
              placeholder="Select a widget type"
              required
            >
              {WIDGET_KINDS.map((kind) => (
                <s-option key={kind} value={kind}>
                  {kind}
                </s-option>
              ))}
            </s-select>
            <s-button
              type="submit"
              variant="primary"
              {...(isSubmitting ? { loading: true } : {})}
            >
              Create widget
            </s-button>
          </s-stack>
        </Form>
      </s-section>
```

with:

```typescript
      <CreateWidgetSection actionData={actionData} isSubmitting={isSubmitting} />
```

and add this component (above `export default function Widgets()`):

```typescript
function CreateWidgetSection({
  actionData,
  isSubmitting,
}: {
  actionData: { error: string | null } | undefined;
  isSubmitting: boolean;
}) {
  const [selectedKind, setSelectedKind] = useState<WidgetKind>("PRODUCT_PAGE_REELS");

  return (
    <s-section heading="Create a widget">
      {actionData?.error && (
        <s-paragraph tone="critical">{actionData.error}</s-paragraph>
      )}
      <Form method="post">
        <s-stack gap="base">
          <s-text-field label="Name" name="name" required></s-text-field>
          <input type="hidden" name="type" value={selectedKind} />
          <TemplatePicker value={selectedKind} onChange={setSelectedKind} />
          <s-button
            type="submit"
            variant="primary"
            {...(isSubmitting ? { loading: true } : {})}
          >
            Create widget
          </s-button>
        </s-stack>
      </Form>
    </s-section>
  );
}
```

- [ ] **Step 2: Add the featured-reel picker to the widget detail modal**

In `WidgetDetailModal`, add a `featuredReelFetcher` alongside the existing `editFetcher`/`targetFetcher`/`deleteFetcher`:

```typescript
  const featuredReelFetcher = useFetcher<{ error: string | null }>();
```

Add a revalidation effect matching the pattern already used for `editFetcher`/`targetFetcher`:

```typescript
  useEffect(() => {
    if (href && featuredReelFetcher.state === "idle" && featuredReelFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuredReelFetcher.state, featuredReelFetcher.data]);
```

`detailFetcher.data` now includes `reels` (from Task 3's loader change). Add this block inside the modal's main `<s-stack gap="base">`, after the existing target-rule `<s-stack>` block and before the closing of that outer stack (only rendered for kinds that need it):

```typescript
          {(detailWidget.type === "SINGLE_VIDEO" || detailWidget.type === "REEL_POPS") && (
            <s-stack gap="base">
              {featuredReelFetcher.data?.error && (
                <s-paragraph tone="critical">{featuredReelFetcher.data.error}</s-paragraph>
              )}
              <s-paragraph>
                Featured reel:{" "}
                {(() => {
                  const featuredReelId = (detailWidget.config as unknown as WidgetConfig)
                    .featuredReelId;
                  const reels = detailFetcher.data?.reels ?? [];
                  const featured = reels.find((r) => r.id === featuredReelId);
                  return featured ? featured.title : "None chosen yet";
                })()}
              </s-paragraph>
              <featuredReelFetcher.Form method="post" action={href!}>
                <input type="hidden" name="intent" value="set-featured-reel" />
                <s-stack gap="base">
                  <s-select label="Choose reel" name="featuredReelId" required>
                    {(detailFetcher.data?.reels ?? []).map((reel) => (
                      <s-option key={reel.id} value={reel.id}>
                        {reel.title}
                      </s-option>
                    ))}
                  </s-select>
                  <s-button
                    type="submit"
                    {...(featuredReelFetcher.state !== "idle" ? { loading: true } : {})}
                  >
                    Save featured reel
                  </s-button>
                </s-stack>
              </featuredReelFetcher.Form>
            </s-stack>
          )}
```

Update the `WidgetDetailLoaderData` type near the top of the file to include `reels`:

```typescript
type WidgetDetailLoaderData = {
  widget: Widget;
  reels: { id: string; title: string }[];
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

With the dev server running, open Widgets → Create a widget: confirm the gallery renders 5 cards, clicking one highlights it and creates that kind on submit. Open a `SINGLE_VIDEO` or `REEL_POPS` widget's popup: confirm the "Choose reel" section appears, selecting a reel and saving shows it as the featured reel.

- [ ] **Step 5: Commit**

```bash
git add app/routes/app.widgets.tsx
git commit -m "feat(admin): add template picker gallery and featured-reel picker"
```

---

### Task 5: `single-video.liquid` block

**Files:**
- Create: `extensions/shoppable-video-widgets/blocks/single-video.liquid`
- Create: `extensions/shoppable-video-widgets/assets/single-video.js`
- Create: `extensions/shoppable-video-widgets/assets/single-video.css`

**Interfaces:**
- Consumes: shop metafields `single_video_widget` (JSON: `{published, targetRule}`) and `single_video_featured_reel` (native reel reference — resolves to a metaobject with `.title`, `.published.value`, `.config.value.{cloudflareStreamUid, hlsManifestUrl, posterUrl}`), both from Task 1/2.

- [ ] **Step 1: Write the Liquid block**

```liquid
{% doc %}
Renders the shop's SINGLE_VIDEO widget: one merchant-picked featured reel,
no carousel, no product tags. Gated on the shop-level widget metafield
(published + targetRule) exactly like product-page-reels.liquid.
@example
{% content_for 'block', type: 'single-video', id: 'single-video' %}
{% enddoc %}

{{ 'single-video.css' | asset_url | stylesheet_tag }}

{% assign reel_namespace = 'app--404281098241' %}

{% assign widget_field = shop.metafields[reel_namespace].single_video_widget %}
{% assign featured_reel = shop.metafields[reel_namespace].single_video_featured_reel %}

{% assign widget_matches_product = false %}
{% if widget_field.value.published %}
  {% if widget_field.value.targetRule.type == "all_products" %}
    {% assign widget_matches_product = true %}
  {% elsif widget_field.value.targetRule.type == "handles" and widget_field.value.targetRule.handles contains product.handle %}
    {% assign widget_matches_product = true %}
  {% endif %}
{% endif %}

{% assign reel = featured_reel.value %}
{% assign show_reel = false %}
{% if widget_matches_product and reel and reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
  {% assign show_reel = true %}
{% endif %}

{% if show_reel %}
  <div class="reelup-single-video" {{ block.shopify_attributes }}>
    <div
      class="reelup-single-video__frame"
      data-reelup-single-video
      data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
    >
      {% if reel.config.value.posterUrl != blank %}
        <img
          class="reelup-single-video__poster"
          src="{{ reel.config.value.posterUrl | escape }}"
          alt="{{ reel.title.value | escape }}"
          loading="lazy"
          width="480"
          height="854"
        >
      {% endif %}
      <button
        type="button"
        class="reelup-single-video__play"
        aria-label="{{ 'reels.play_label' | t }}"
      >
        <span class="reelup-single-video__play-icon" aria-hidden="true"></span>
      </button>
      <video
        class="reelup-single-video__video"
        playsinline
        muted
        loop
        preload="none"
      ></video>
    </div>
  </div>
  <script src="{{ 'single-video.js' | asset_url }}" defer></script>
{% endif %}

{% schema %}
{
  "name": "Single video",
  "target": "section",
  "settings": [
    { "type": "product", "id": "product", "label": "Product", "autofill": true }
  ]
}
{% endschema %}
```

- [ ] **Step 2: Write the CSS**

```css
.reelup-single-video__frame {
  position: relative;
  width: 100%;
  max-width: 480px;
  aspect-ratio: 9 / 16;
  background: #111;
  border-radius: 12px;
  overflow: hidden;
}

.reelup-single-video__poster,
.reelup-single-video__video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
}

.reelup-single-video__video {
  display: none;
}

.reelup-single-video__frame[data-activated] .reelup-single-video__poster {
  display: none;
}

.reelup-single-video__frame[data-activated] .reelup-single-video__video {
  display: block;
}

.reelup-single-video__play {
  position: absolute;
  inset: 0;
  z-index: 1;
  margin: auto;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.reelup-single-video__frame[data-playing="true"] .reelup-single-video__play {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.reelup-single-video__frame[data-playing="true"]:hover .reelup-single-video__play,
.reelup-single-video__frame[data-playing="true"] .reelup-single-video__play:focus-visible {
  opacity: 1;
}

.reelup-single-video__play-icon {
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 9px 0 9px 16px;
  border-color: transparent transparent transparent #fff;
  margin-left: 3px;
}

.reelup-single-video__frame[data-playing="true"] .reelup-single-video__play-icon {
  width: 5px;
  height: 16px;
  margin-left: 0;
  border-style: none;
  background: #fff;
  box-shadow: 9px 0 0 #fff;
}
```

- [ ] **Step 3: Write the JS**

Same play/pause/HLS mechanics as `product-page-reels.js`'s `activateReel`, adapted for the single-frame markup (no products carousel, no add-to-cart, no IntersectionObserver batching needed since there's at most one frame per page):

```javascript
(() => {
  const currentScriptSrc = document.currentScript?.src ?? "";

  const supportsNativeHls = (video) =>
    video.canPlayType("application/vnd.apple.mpegurl") !== "";

  const attachSource = (frameEl, video, hlsSrc) => {
    if (supportsNativeHls(video)) {
      video.src = hlsSrc;
      return Promise.resolve();
    }

    if (!window.Hls?.isSupported()) {
      return Promise.reject(new Error("HLS not supported"));
    }

    frameEl._reelupHlsInstance?.destroy();
    frameEl._reelupHlsInstance = null;

    return new Promise((resolve, reject) => {
      const hls = new window.Hls();
      frameEl._reelupHlsInstance = hls;
      hls.loadSource(hlsSrc);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => resolve());
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) reject(new Error(data.type));
      });
    });
  };

  const loadHlsJsIfNeeded = () => {
    if (window.Hls || document.querySelector("script[data-reelup-hlsjs]")) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = currentScriptSrc.replace("single-video.js", "hls.min.js");
      script.dataset.reelupHlsjs = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load hls.js"));
      document.head.appendChild(script);
    });
  };

  const activateFrame = (frameEl) => {
    if (frameEl.dataset.reelupBound) return;
    frameEl.dataset.reelupBound = "true";

    const video = frameEl.querySelector(".reelup-single-video__video");
    const playButton = frameEl.querySelector(".reelup-single-video__play");
    const hlsSrc = frameEl.dataset.hlsSrc;

    if (!video || !playButton || !hlsSrc) return;

    video.addEventListener("play", () => frameEl.setAttribute("data-playing", "true"));
    video.addEventListener("pause", () => frameEl.setAttribute("data-playing", "false"));

    playButton.addEventListener("click", async () => {
      if (frameEl.hasAttribute("data-activated")) {
        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
        return;
      }

      try {
        if (!supportsNativeHls(video)) {
          await loadHlsJsIfNeeded();
        }
        await attachSource(frameEl, video, hlsSrc);
        frameEl.setAttribute("data-activated", "true");
        await video.play();
      } catch {
        // Playback failed to initialize; leave the poster/play button visible.
      }
    });
  };

  document.querySelectorAll("[data-reelup-single-video]").forEach((el) => activateFrame(el));
})();
```

- [ ] **Step 4: Manual verification**

No automated Liquid test harness. With `shopify app dev` running: add the "Single video" block to a product template in the theme editor, publish a `SINGLE_VIDEO` widget with a featured reel chosen, confirm it renders and plays/pauses on the product page. Confirm it stays hidden when the widget is unpublished or the featured reel isn't ready.

- [ ] **Step 5: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/single-video.liquid extensions/shoppable-video-widgets/assets/single-video.js extensions/shoppable-video-widgets/assets/single-video.css
git commit -m "feat(storefront): add Single video widget template"
```

---

### Task 6: `stacked-carousel.liquid` block

**Files:**
- Create: `extensions/shoppable-video-widgets/blocks/stacked-carousel.liquid`
- Create: `extensions/shoppable-video-widgets/assets/stacked-carousel.js`
- Create: `extensions/shoppable-video-widgets/assets/stacked-carousel.css`

**Interfaces:**
- Consumes: shop metafield `stacked_carousel_widget`; product metafield `reels` (existing, same data source as `product-page-reels.liquid`).

- [ ] **Step 1: Write the Liquid block**

Same gating logic as `product-page-reels.liquid` lines 1–44 (widget lookup, `widget_matches_product`, `reels_field`, `visible_count`), but reading `stacked_carousel_widget` instead of `product_page_reels_widget`, and rendering a stacked deck instead of a horizontal row:

```liquid
{% doc %}
Renders the product's tagged reels as a stacked, swipeable deck (CAROUSEL
widget kind). Same product-tagging data source and widget-gating pattern as
product-page-reels.liquid; different visual layout.
@example
{% content_for 'block', type: 'stacked-carousel', id: 'stacked-carousel' %}
{% enddoc %}

{{ 'stacked-carousel.css' | asset_url | stylesheet_tag }}

{% assign reel_namespace = 'app--404281098241' %}

{% assign widget_field = shop.metafields[reel_namespace].stacked_carousel_widget %}
{% assign widget_matches_product = false %}
{% if widget_field.value.published %}
  {% if widget_field.value.targetRule.type == "all_products" %}
    {% assign widget_matches_product = true %}
  {% elsif widget_field.value.targetRule.type == "handles" and widget_field.value.targetRule.handles contains product.handle %}
    {% assign widget_matches_product = true %}
  {% endif %}
{% endif %}

{% assign reels_field = block.settings.product.metafields[reel_namespace].reels %}

{% assign visible_reels = "" | split: "," %}
{% if widget_matches_product %}
  {% for reel in reels_field.value %}
    {% if reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
      {% assign visible_reels = visible_reels | push: reel %}
    {% endif %}
  {% endfor %}
{% endif %}

{% if visible_reels.size > 0 %}
  <div class="reelup-stack" {{ block.shopify_attributes }} data-reelup-stack>
    {% for reel in reels_field.value %}
      {% if reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
        <div
          class="reelup-stack__card"
          style="--reelup-stack-index: {{ forloop.index0 }};"
          data-reelup-stack-card
          data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
        >
          {% if reel.config.value.posterUrl != blank %}
            <img
              class="reelup-stack__poster"
              src="{{ reel.config.value.posterUrl | escape }}"
              alt="{{ reel.title.value | escape }}"
              loading="lazy"
              width="360"
              height="640"
            >
          {% endif %}
          <video class="reelup-stack__video" playsinline muted loop preload="none"></video>
        </div>
      {% endif %}
    {% endfor %}
    {% if visible_reels.size > 1 %}
      <button type="button" class="reelup-stack__next" data-reelup-stack-next aria-label="{{ 'reels.next_product_label' | t }}">›</button>
    {% endif %}
  </div>
  <script src="{{ 'stacked-carousel.js' | asset_url }}" defer></script>
{% endif %}

{% schema %}
{
  "name": "Stacked carousel",
  "target": "section",
  "settings": [
    { "type": "product", "id": "product", "label": "Product", "autofill": true }
  ]
}
{% endschema %}
```

- [ ] **Step 2: Write the CSS**

Cards absolutely stacked on top of each other, front card fully visible, others peeking behind (scaled down + offset), front card advances to the back on tap:

```css
.reelup-stack {
  position: relative;
  width: 100%;
  max-width: 320px;
  aspect-ratio: 9 / 16;
}

.reelup-stack__card {
  position: absolute;
  inset: 0;
  border-radius: 14px;
  overflow: hidden;
  background: #111;
  transform: translateY(calc(var(--reelup-stack-index) * 8px)) scale(calc(1 - var(--reelup-stack-index) * 0.04));
  transition: transform 0.25s ease, opacity 0.25s ease;
  z-index: calc(100 - var(--reelup-stack-index));
}

.reelup-stack__card[data-reelup-stack-sent-back] {
  transform: translateY(-100%) scale(0.9);
  opacity: 0;
}

.reelup-stack__poster,
.reelup-stack__video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.reelup-stack__video {
  display: none;
}

.reelup-stack__card[data-activated] .reelup-stack__poster {
  display: none;
}

.reelup-stack__card[data-activated] .reelup-stack__video {
  display: block;
}

.reelup-stack__next {
  position: absolute;
  z-index: 200;
  right: 8px;
  bottom: 8px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
}
```

- [ ] **Step 3: Write the JS**

Front card auto-plays on activation; tapping "next" (or the front card itself) sends the front card to the back of the stack (CSS handles the visual reorder via re-numbering `--reelup-stack-index`) and activates the new front card:

```javascript
(() => {
  const supportsNativeHls = (video) =>
    video.canPlayType("application/vnd.apple.mpegurl") !== "";

  const attachSource = (cardEl, video, hlsSrc) => {
    if (supportsNativeHls(video)) {
      video.src = hlsSrc;
      return Promise.resolve();
    }
    return Promise.reject(new Error("HLS not supported and no fallback loaded for stacked-carousel"));
  };

  const activateCard = async (cardEl) => {
    if (cardEl.dataset.reelupBound) return;
    cardEl.dataset.reelupBound = "true";

    const video = cardEl.querySelector(".reelup-stack__video");
    const hlsSrc = cardEl.dataset.hlsSrc;
    if (!video || !hlsSrc) return;

    try {
      await attachSource(cardEl, video, hlsSrc);
      cardEl.setAttribute("data-activated", "true");
      await video.play();
    } catch {
      // Leave the poster visible if playback can't start.
    }
  };

  document.querySelectorAll("[data-reelup-stack]").forEach((stackEl) => {
    const cards = Array.from(stackEl.querySelectorAll("[data-reelup-stack-card]"));
    if (cards.length === 0) return;

    let order = cards;
    const reindex = () => {
      order.forEach((card, index) => {
        card.style.setProperty("--reelup-stack-index", String(index));
      });
    };

    const advance = () => {
      const [front, ...rest] = order;
      front.querySelector(".reelup-stack__video")?.pause();
      order = [...rest, front];
      reindex();
      activateCard(order[0]);
    };

    reindex();
    activateCard(order[0]);

    stackEl.querySelector("[data-reelup-stack-next]")?.addEventListener("click", advance);
    order[0].addEventListener("click", () => {
      if (order.length > 1) advance();
    });
  });
})();
```

Note: this MVP doesn't load `hls.min.js` as a fallback (unlike the other blocks) — browsers without native HLS support (older Safari versions aside, most current browsers support it) won't autoplay the stack. Acceptable for this batch; add the same `loadHlsJsIfNeeded` fallback from `single-video.js` in a follow-up if broader browser support is needed.

- [ ] **Step 4: Manual verification**

Add "Stacked carousel" block to a product template with 2+ tagged reels; confirm the front card auto-plays, tapping "›" (or the card) cycles to the next reel, stack visually reorders.

- [ ] **Step 5: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/stacked-carousel.liquid extensions/shoppable-video-widgets/assets/stacked-carousel.js extensions/shoppable-video-widgets/assets/stacked-carousel.css
git commit -m "feat(storefront): add Stacked carousel widget template"
```

---

### Task 7: `insta-stories.liquid` block

**Files:**
- Create: `extensions/shoppable-video-widgets/blocks/insta-stories.liquid`
- Create: `extensions/shoppable-video-widgets/assets/insta-stories.js`
- Create: `extensions/shoppable-video-widgets/assets/insta-stories.css`

**Interfaces:**
- Consumes: shop metafield `insta_stories_widget`; product metafield `reels`.

- [ ] **Step 1: Write the Liquid block**

```liquid
{% doc %}
Renders the product's tagged reels as a row of circular avatars (STORIES
widget kind). Tapping one opens a full-screen story viewer with tap-through
navigation between the product's tagged reels.
@example
{% content_for 'block', type: 'insta-stories', id: 'insta-stories' %}
{% enddoc %}

{{ 'insta-stories.css' | asset_url | stylesheet_tag }}

{% assign reel_namespace = 'app--404281098241' %}

{% assign widget_field = shop.metafields[reel_namespace].insta_stories_widget %}
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
  <div class="reelup-stories" {{ block.shopify_attributes }}>
    {% assign story_index = 0 %}
    {% for reel in reels_field.value %}
      {% if reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
        <button
          type="button"
          class="reelup-stories__avatar-button"
          data-reelup-story-trigger
          data-story-index="{{ story_index }}"
          data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
          aria-label="{{ reel.title.value | escape }}"
        >
          <span class="reelup-stories__ring">
            {% if reel.config.value.posterUrl != blank %}
              <img class="reelup-stories__avatar" src="{{ reel.config.value.posterUrl | image_url: width: 160 }}" alt="" loading="lazy" width="64" height="64">
            {% endif %}
          </span>
          <span class="reelup-stories__label">{{ reel.title.value | truncate: 12 }}</span>
        </button>
        {% assign story_index = story_index | plus: 1 %}
      {% endif %}
    {% endfor %}
  </div>

  <div class="reelup-story-viewer" data-reelup-story-viewer hidden>
    <div class="reelup-story-viewer__progress" data-reelup-story-progress></div>
    <button type="button" class="reelup-story-viewer__close" data-reelup-story-close aria-label="{{ 'reels.play_label' | t }}">✕</button>
    <video class="reelup-story-viewer__video" data-reelup-story-video playsinline muted loop></video>
    <button type="button" class="reelup-story-viewer__nav reelup-story-viewer__nav--prev" data-reelup-story-prev aria-label="{{ 'reels.previous_product_label' | t }}"></button>
    <button type="button" class="reelup-story-viewer__nav reelup-story-viewer__nav--next" data-reelup-story-next aria-label="{{ 'reels.next_product_label' | t }}"></button>
  </div>

  <script src="{{ 'insta-stories.js' | asset_url }}" defer></script>
{% endif %}

{% schema %}
{
  "name": "Insta-style stories",
  "target": "section",
  "settings": [
    { "type": "product", "id": "product", "label": "Product", "autofill": true }
  ]
}
{% endschema %}
```

- [ ] **Step 2: Write the CSS**

```css
.reelup-stories {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  padding-block: 10px;
}

.reelup-stories__avatar-button {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 68px;
  border: none;
  background: none;
  cursor: pointer;
}

.reelup-stories__ring {
  display: block;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  padding: 2px;
  background: linear-gradient(45deg, #f9ce34, #ee2a7b, #6228d7);
  overflow: hidden;
}

.reelup-stories__avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid #fff;
  display: block;
}

.reelup-stories__label {
  font-size: 11px;
  max-width: 68px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reelup-story-viewer {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.reelup-story-viewer[hidden] {
  display: none;
}

.reelup-story-viewer__video {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: 100%;
  object-fit: contain;
}

.reelup-story-viewer__progress {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  height: 3px;
  background: rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  overflow: hidden;
}

.reelup-story-viewer__progress::after {
  content: "";
  display: block;
  height: 100%;
  width: var(--reelup-story-progress, 0%);
  background: #fff;
  transition: width 0.1s linear;
}

.reelup-story-viewer__close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 1001;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  cursor: pointer;
}

.reelup-story-viewer__nav {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 33%;
  border: none;
  background: transparent;
  cursor: pointer;
}

.reelup-story-viewer__nav--prev {
  left: 0;
}

.reelup-story-viewer__nav--next {
  right: 0;
}
```

- [ ] **Step 3: Write the JS**

Story viewer opens on avatar click, autoplays, advances on a fixed duration timer (progress bar fill) or when the current story ends, tap-left/right navigates, close button/ESC exits:

```javascript
(() => {
  const STORY_DURATION_MS = 8000;

  document.querySelectorAll(".reelup-stories").forEach((row) => {
    const viewer = row.parentElement?.querySelector("[data-reelup-story-viewer]");
    if (!viewer) return;

    const video = viewer.querySelector("[data-reelup-story-video]");
    const progress = viewer.querySelector("[data-reelup-story-progress]");
    const triggers = Array.from(row.querySelectorAll("[data-reelup-story-trigger]"));
    let currentIndex = 0;
    let timer = null;

    const clearTimer = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const openStory = (index) => {
      if (index < 0 || index >= triggers.length) {
        closeViewer();
        return;
      }
      currentIndex = index;
      const trigger = triggers[index];
      video.src = trigger.dataset.hlsSrc ?? "";
      video.currentTime = 0;
      video.play().catch(() => {});

      clearTimer();
      const start = Date.now();
      progress.style.setProperty("--reelup-story-progress", "0%");
      timer = setInterval(() => {
        const pct = Math.min(100, ((Date.now() - start) / STORY_DURATION_MS) * 100);
        progress.style.setProperty("--reelup-story-progress", `${pct}%`);
        if (pct >= 100) openStory(currentIndex + 1);
      }, 100);
    };

    const closeViewer = () => {
      clearTimer();
      video.pause();
      video.removeAttribute("src");
      viewer.hidden = true;
    };

    triggers.forEach((trigger, index) => {
      trigger.addEventListener("click", () => {
        viewer.hidden = false;
        openStory(index);
      });
    });

    viewer.querySelector("[data-reelup-story-close]")?.addEventListener("click", closeViewer);
    viewer.querySelector("[data-reelup-story-prev]")?.addEventListener("click", () => openStory(currentIndex - 1));
    viewer.querySelector("[data-reelup-story-next]")?.addEventListener("click", () => openStory(currentIndex + 1));

    document.addEventListener("keydown", (event) => {
      if (viewer.hidden) return;
      if (event.key === "Escape") closeViewer();
      if (event.key === "ArrowLeft") openStory(currentIndex - 1);
      if (event.key === "ArrowRight") openStory(currentIndex + 1);
    });
  });
})();
```

Note: this MVP relies on native HLS support only (same simplification as Task 6's stacked carousel — no `hls.min.js` fallback loading). Acceptable for this batch.

- [ ] **Step 4: Manual verification**

Add "Insta-style stories" block to a product template with 2+ tagged reels; confirm avatars render, tapping one opens the full-screen viewer and autoplays, progress bar fills and auto-advances, prev/next tap zones and Escape/close work, viewer closes after the last story.

- [ ] **Step 5: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/insta-stories.liquid extensions/shoppable-video-widgets/assets/insta-stories.js extensions/shoppable-video-widgets/assets/insta-stories.css
git commit -m "feat(storefront): add Insta-style stories widget template"
```

---

### Task 8: `reel-pops.liquid` app-embed block (site-wide)

**Files:**
- Create: `extensions/shoppable-video-widgets/blocks/reel-pops.liquid`
- Create: `extensions/shoppable-video-widgets/assets/reel-pops.js`
- Create: `extensions/shoppable-video-widgets/assets/reel-pops.css`

**Interfaces:**
- Consumes: shop metafields `reel_pops_widget`, `reel_pops_featured_reel` (Task 1/2).

- [ ] **Step 1: Write the Liquid block**

App-embed blocks use `target: "body"` and have no `block.settings.product` (there's no contextual product on arbitrary pages) — gating is `published` only, no per-product `targetRule` matching, since a floating site-wide bubble isn't scoped to a product page in the first place. (The `targetRule` value still gets written to `reel_pops_widget`'s JSON by `syncShopWidgetState` for consistency with the other kinds, but this block intentionally ignores it — a site-wide bubble has no "current product" to match against.)

```liquid
{% doc %}
Site-wide floating bubble (REEL_POPS widget kind). Enabled once by the
merchant in theme editor's "App embeds" panel, then appears on every page.
Expands into a video overlay showing the merchant's featured reel.
{% enddoc %}

{{ 'reel-pops.css' | asset_url | stylesheet_tag }}

{% assign reel_namespace = 'app--404281098241' %}

{% assign widget_field = shop.metafields[reel_namespace].reel_pops_widget %}
{% assign featured_reel = shop.metafields[reel_namespace].reel_pops_featured_reel %}
{% assign reel = featured_reel.value %}

{% assign show_bubble = false %}
{% if widget_field.value.published and reel and reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
  {% assign show_bubble = true %}
{% endif %}

{% if show_bubble %}
  <button
    type="button"
    class="reelup-pop-bubble"
    data-reelup-pop-trigger
    aria-label="{{ reel.title.value | escape }}"
  >
    {% if reel.config.value.posterUrl != blank %}
      <img class="reelup-pop-bubble__avatar" src="{{ reel.config.value.posterUrl | image_url: width: 160 }}" alt="" loading="lazy" width="56" height="56">
    {% endif %}
  </button>

  <div class="reelup-pop-overlay" data-reelup-pop-overlay hidden>
    <div class="reelup-pop-overlay__frame">
      <button type="button" class="reelup-pop-overlay__close" data-reelup-pop-close aria-label="{{ 'reels.play_label' | t }}">✕</button>
      <video
        class="reelup-pop-overlay__video"
        data-reelup-pop-video
        data-hls-src="{{ reel.config.value.hlsManifestUrl | escape }}"
        playsinline
        muted
        loop
        controls
      ></video>
    </div>
  </div>

  <script src="{{ 'reel-pops.js' | asset_url }}" defer></script>
{% endif %}

{% schema %}
{
  "name": "Reel pops",
  "target": "body"
}
{% endschema %}
```

- [ ] **Step 2: Write the CSS**

```css
.reelup-pop-bubble {
  position: fixed;
  z-index: 900;
  right: 20px;
  bottom: 20px;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 3px solid #fff;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  background: #111;
}

.reelup-pop-bubble__avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.reelup-pop-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
}

.reelup-pop-overlay[hidden] {
  display: none;
}

.reelup-pop-overlay__frame {
  position: relative;
  width: min(90vw, 380px);
  aspect-ratio: 9 / 16;
  background: #111;
  border-radius: 14px;
  overflow: hidden;
}

.reelup-pop-overlay__video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.reelup-pop-overlay__close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1001;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
}
```

- [ ] **Step 3: Write the JS**

```javascript
(() => {
  const trigger = document.querySelector("[data-reelup-pop-trigger]");
  const overlay = document.querySelector("[data-reelup-pop-overlay]");
  const video = document.querySelector("[data-reelup-pop-video]");
  const closeButton = document.querySelector("[data-reelup-pop-close]");
  if (!trigger || !overlay || !video) return;

  let sourceAttached = false;

  const supportsNativeHls = () =>
    video.canPlayType("application/vnd.apple.mpegurl") !== "";

  const open = () => {
    overlay.hidden = false;
    if (!sourceAttached) {
      sourceAttached = true;
      const hlsSrc = video.dataset.hlsSrc;
      if (supportsNativeHls()) {
        video.src = hlsSrc;
      }
      // No hls.js fallback in this MVP — same simplification as the
      // stacked-carousel and insta-stories templates in this batch.
    }
    video.play().catch(() => {});
  };

  const close = () => {
    overlay.hidden = true;
    video.pause();
  };

  trigger.addEventListener("click", open);
  closeButton?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", (event) => {
    if (!overlay.hidden && event.key === "Escape") close();
  });
})();
```

- [ ] **Step 4: Manual verification**

Publish a `REEL_POPS` widget with a featured reel; in theme editor's "App embeds" panel, toggle the Reel pops embed on. Confirm the bubble appears bottom-right on **any** page (not just product pages), clicking it opens the video overlay with controls, close button and clicking outside the frame both dismiss it.

- [ ] **Step 5: Commit**

```bash
git add extensions/shoppable-video-widgets/blocks/reel-pops.liquid extensions/shoppable-video-widgets/assets/reel-pops.js extensions/shoppable-video-widgets/assets/reel-pops.css
git commit -m "feat(storefront): add Reel pops site-wide app-embed widget template"
```

---

### Task 9: Full-suite regression check + deploy reminder

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass (Task 1's widget.server.test.ts changes plus every pre-existing test file).

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Deploy reminder**

`shopify.app.toml`'s new metafield definitions (Task 2) only take effect on the live store after `shopify app deploy` — this is a manual step for a human with store access, same requirement as the previous plan. Note in the final report that this hasn't happened yet as part of this plan; it's the next action after merge.

---

## Post-plan note

`GRID` and the other 15+ templates from the reference screenshot remain unimplemented, per the design spec's explicit scope. This plan's `WIDGET_KIND_SYNC_CONFIG` pattern in `widget.server.ts` is what a future batch extends — add an entry to the map, a metafield definition in `shopify.app.toml`, and a new block, following the same shape as any of Tasks 5–8.
