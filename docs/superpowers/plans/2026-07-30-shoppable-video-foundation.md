# Shoppable Video App — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the data model and Shopify custom-data schema that every later subsystem (video ingestion, admin UI, storefront widgets, analytics, billing) builds on top of — nothing merchant-facing yet.

**Architecture:** Reels are modeled as a single Shopify metaobject type (`$app:reel`) with one JSON field holding all reel content/config, so storefront rendering never needs a runtime API call. Products reference their tagged reels via a `list.metaobject_reference` metafield. App-level concerns that aren't tied to a specific Shopify resource (plan/billing state, widget placement config) live in Prisma/SQLite instead, since metafields are for resource-scoped data, not app configuration.

**Tech Stack:** Existing Shopify Remix/React Router template (`@shopify/shopify-app-react-router`), Prisma 6 + SQLite, Vitest (new — no test runner exists in the repo yet), Shopify CLI config-as-code (`shopify.app.toml`).

## Global Constraints

- Pricing tiers are 30% below ReelUp's four tiers, with a 2× view cap at each: FREE 200 views/mo (ReelUp Free: 100), BASIC 6,000 (ReelUp: 3,000), PREMIUM 40,000 (ReelUp: 20,000), ELITE 100,000 (ReelUp: 50,000). These exact cap numbers are the `PLAN_VIEW_CAPS` values below.
- **SQLite has no native enum support in Prisma** — `plan` and widget `type` fields must be plain `String` columns constrained by TypeScript union types at the application layer, not Prisma `enum`. Using `enum` against the sqlite datasource fails migration outright.
- Each reel's full content/config lives in **one JSON field on the reel's own metaobject entry** (`$app:reel.config`) — never duplicated onto the products that reference it. Products hold only a reference.
- Video hosting is Cloudflare Stream; analytics QoE beacon is Mux Data — not built in this plan, but the `Shop`/`Widget` schema here must not preclude them later.
- No feature work belongs in this plan: no widgets, no admin CRUD screens, no ingestion, no billing logic. Schema and definitions only.

---

## File Structure

- `prisma/schema.prisma` — modify: datasource becomes env-driven; add `Shop`, `BillingCycle`, `Widget` models.
- `.env` — create: local dev database URL (gitignored already).
- `.env.test` — create: isolated test database URL.
- `package.json` — modify: add `vitest`, `dotenv-cli`; add `test`, `test:run`, `test:migrate` scripts.
- `vitest.config.ts` — create: Vitest config, node environment.
- `app/models/shop.server.ts` — create: `getOrCreateShop`, `updateShopPlan`, `PLAN_VIEW_CAPS`.
- `app/models/shop.server.test.ts` — create.
- `shopify.app.toml` — modify: remove template demo metaobject/metafield, add `$app:reel` metaobject and `product.metafields.app.reels` reference.
- `app/models/widget.server.ts` — create: `createWidget`, `listWidgetsForShop`, `setWidgetPublished`, `deleteWidget`, `WidgetKind`, `WidgetConfig`.
- `app/models/widget.server.test.ts` — create.
- `app/routes/app._index.tsx` — modify: replace template demo (product generator) with a minimal real dashboard reading `Shop`.

---

### Task 1: Prisma schema — env-driven datasource, `Shop`, `BillingCycle`, `Widget`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `.env`

**Interfaces:**
- Produces: `Shop` model (`id`, `shopDomain` unique, `plan: String`, `viewCapMonthly: Int`, `createdAt`, `updatedAt`, relations `billingCycles`, `widgets`). `BillingCycle` model (`id`, `shopId` FK, `periodStart`, `periodEnd`, `viewsUsed: Int`, `overageViews: Int`, `overageCharged: Boolean`, unique on `[shopId, periodStart]`). `Widget` model (`id`, `shopId` FK, `type: String`, `name: String`, `config: Json`, `published: Boolean`, timestamps). These exact field names/types are consumed by Task 2 and Task 4.

- [ ] **Step 1: Point the datasource at an env var instead of a literal file**

In `prisma/schema.prisma`, replace:

```prisma
datasource db {
  provider = "sqlite"
  url      = "file:dev.sqlite"
}
```

with:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

- [ ] **Step 2: Create `.env` for local dev**

Create `.env` (already gitignored by the existing `.env` / `.env.*` rules) with:

```
DATABASE_URL="file:./prisma/dev.sqlite"
```

- [ ] **Step 3: Add the `Shop`, `BillingCycle`, `Widget` models**

Append to `prisma/schema.prisma`:

```prisma
// SQLite has no native Prisma enum support, so plan/type are plain strings
// constrained by TS union types in app/models/*.server.ts, not DB enums.
model Shop {
  id             String   @id @default(cuid())
  shopDomain     String   @unique
  plan           String   @default("FREE")
  viewCapMonthly Int      @default(200)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  billingCycles  BillingCycle[]
  widgets        Widget[]
}

model BillingCycle {
  id             String   @id @default(cuid())
  shop           Shop     @relation(fields: [shopId], references: [id])
  shopId         String
  periodStart    DateTime
  periodEnd      DateTime
  viewsUsed      Int      @default(0)
  overageViews   Int      @default(0)
  overageCharged Boolean  @default(false)
  createdAt      DateTime @default(now())

  @@unique([shopId, periodStart])
  @@index([shopId])
}

model Widget {
  id        String   @id @default(cuid())
  shop      Shop     @relation(fields: [shopId], references: [id])
  shopId    String
  type      String
  name      String
  config    Json
  published Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([shopId])
}
```

- [ ] **Step 4: Run the migration**

Run: `npx prisma migrate dev --name foundation_schema`
Expected: prompts to create the migration, succeeds, and regenerates the Prisma client. A new folder appears under `prisma/migrations/` for this migration.

- [ ] **Step 5: Verify the client typechecks**

Run: `npm run typecheck`
Expected: passes with no errors (confirms the regenerated `@prisma/client` types are structurally sound before anything depends on them).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations .env.example 2>/dev/null; git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add Shop, BillingCycle, Widget models; env-driven datasource"
```

Note: `.env` itself is gitignored and won't be staged — that's correct, it's a local file.

---

### Task 2: Test runner + `shop.server.ts`

**Files:**
- Create: `.env.test`
- Create: `vitest.config.ts`
- Modify: `package.json`
- Create: `app/models/shop.server.ts`
- Test: `app/models/shop.server.test.ts`

**Interfaces:**
- Consumes: `Shop` model from Task 1 (`prisma.shop.*`), default export `prisma` from `app/db.server.ts`.
- Produces: `PLAN_VIEW_CAPS: Record<PlanTier, number>`, `type PlanTier = "FREE" | "BASIC" | "PREMIUM" | "ELITE"`, `getOrCreateShop(shopDomain: string): Promise<Shop>`, `updateShopPlan(shopDomain: string, plan: PlanTier): Promise<Shop>` — all consumed by Task 5's dashboard route.

- [ ] **Step 1: Create the isolated test database env file**

Create `.env.test`:

```
DATABASE_URL="file:./prisma/test.sqlite"
```

- [ ] **Step 2: Add Vitest and dotenv-cli, wire up scripts**

Run: `npm install -D vitest dotenv-cli`

In `package.json`, add to `"scripts"`:

```json
"test": "dotenv -e .env.test -- npm run test:run",
"test:run": "npm run test:migrate && vitest run",
"test:migrate": "prisma migrate deploy"
```

`dotenv -e .env.test -- npm run test:run` sets `DATABASE_URL` once for the whole process tree; the nested `npm run` calls inherit it, so both the migration step and the Vitest process itself point at `test.sqlite`, never at the dev database.

- [ ] **Step 3: Add Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 4: Write the failing test**

Create `app/models/shop.server.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../db.server";
import { getOrCreateShop, updateShopPlan, PLAN_VIEW_CAPS } from "./shop.server";

describe("shop.server", () => {
  beforeEach(async () => {
    await prisma.shop.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a shop with FREE defaults on first lookup", async () => {
    const shop = await getOrCreateShop("test-shop.myshopify.com");
    expect(shop.plan).toBe("FREE");
    expect(shop.viewCapMonthly).toBe(PLAN_VIEW_CAPS.FREE);
  });

  it("returns the existing shop on a second lookup instead of creating a duplicate", async () => {
    const first = await getOrCreateShop("test-shop.myshopify.com");
    const second = await getOrCreateShop("test-shop.myshopify.com");
    expect(second.id).toBe(first.id);
    const count = await prisma.shop.count({
      where: { shopDomain: "test-shop.myshopify.com" },
    });
    expect(count).toBe(1);
  });

  it("updates plan and view cap together", async () => {
    await getOrCreateShop("test-shop.myshopify.com");
    const updated = await updateShopPlan("test-shop.myshopify.com", "PREMIUM");
    expect(updated.plan).toBe("PREMIUM");
    expect(updated.viewCapMonthly).toBe(PLAN_VIEW_CAPS.PREMIUM);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './shop.server'` (the module doesn't exist yet).

- [ ] **Step 6: Write the implementation**

Create `app/models/shop.server.ts`:

```ts
import type { Shop } from "@prisma/client";
import prisma from "../db.server";

export type PlanTier = "FREE" | "BASIC" | "PREMIUM" | "ELITE";

// 2x ReelUp's equivalent tier (Free 100 / Basic 3,000 / Premium 20,000 / Elite 50,000),
// priced 30% below ReelUp at each tier.
export const PLAN_VIEW_CAPS: Record<PlanTier, number> = {
  FREE: 200,
  BASIC: 6000,
  PREMIUM: 40000,
  ELITE: 100000,
};

export async function getOrCreateShop(shopDomain: string): Promise<Shop> {
  const existing = await prisma.shop.findUnique({ where: { shopDomain } });
  if (existing) return existing;

  return prisma.shop.create({
    data: {
      shopDomain,
      plan: "FREE",
      viewCapMonthly: PLAN_VIEW_CAPS.FREE,
    },
  });
}

export async function updateShopPlan(
  shopDomain: string,
  plan: PlanTier,
): Promise<Shop> {
  return prisma.shop.update({
    where: { shopDomain },
    data: { plan, viewCapMonthly: PLAN_VIEW_CAPS[plan] },
  });
}
```

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — all 3 tests green, migration applied to `prisma/test.sqlite` beforehand by the `test:migrate` step.

- [ ] **Step 8: Commit**

```bash
git add .env.test vitest.config.ts package.json package-lock.json app/models/shop.server.ts app/models/shop.server.test.ts
git commit -m "feat(db): add Vitest, shop.server.ts plan/view-cap helpers"
```

---

### Task 3: Reel metaobject + product metafield reference

**Files:**
- Modify: `shopify.app.toml`

**Interfaces:**
- Produces: metaobject type `$app:reel` with fields `title` (string), `published` (boolean), `config` (json); product metafield `$app.reels` of type `list.metaobject_reference`. Consumed later by the video-ingestion and theme-extension subsystems — not by anything in this plan.

- [ ] **Step 1: Remove the template's demo metaobject and metafield**

In `shopify.app.toml`, delete these blocks (leftover from the base template, no longer needed):

```toml
[product.metafields.app.demo_info]
type = "single_line_text_field"
name = "Demo Source Info"
description = "Tracks products created by the Shopify app template for development"

  [product.metafields.app.demo_info.access]
  admin = "merchant_read_write"

[metaobjects.app.example]
name = "Example"
description = "An example metaobject definition created by this template"

  [metaobjects.app.example.access]
  admin = "merchant_read_write"

[metaobjects.app.example.fields.title]
name = "Title"
type = "single_line_text_field"
required = true

[metaobjects.app.example.fields.description]
name = "Description"
type = "multi_line_text_field"
```

- [ ] **Step 2: Add the reel metaobject definition**

Add in their place:

```toml
[metaobjects.app.reel]
name = "Reel"
description = "A single shoppable video: source, tagged products, poster, and interaction config"

  [metaobjects.app.reel.access]
  admin = "merchant_read_write"

[metaobjects.app.reel.fields.title]
name = "Title"
type = "single_line_text_field"
required = true

[metaobjects.app.reel.fields.published]
name = "Published"
type = "boolean"
required = true

[metaobjects.app.reel.fields.config]
name = "Config"
type = "json"
required = true
description = "cloudflareStreamUid, posterUrl, durationSeconds, productIds, interactions {ctaLabel, ctaUrl}, source {type, originalUrl}"
```

- [ ] **Step 3: Add the product metafield reference**

```toml
[product.metafields.app.reels]
type = "list.metaobject_reference"
name = "Reels"
description = "Reels tagged to this product, referenced by metaobject ID"

  [product.metafields.app.reels.access]
  admin = "merchant_read_write"
  storefront = "public_read"
```

Note: this does not constrain the reference to only `$app:reel` entries — Shopify's config-as-code validation syntax for scoping a `metaobject_reference` to one specific metaobject type isn't confirmed yet. Follow-up: check `shopify app config validate --json`'s own error/warning output (or current Shopify docs) for the exact `validations` block syntax and tighten this once confirmed. Not a blocker — the app's own admin only ever writes `$app:reel` GIDs into this field regardless.

- [ ] **Step 4: Validate the config**

Run: `shopify app config validate --json`
Expected: JSON output showing no errors for `shopify.app.toml`. If it reports an error, fix the reported field and re-run before moving on.

- [ ] **Step 5: Commit**

```bash
git add shopify.app.toml
git commit -m "feat(config): add reel metaobject and product reel-reference metafield"
```

---

### Task 4: `widget.server.ts`

**Files:**
- Create: `app/models/widget.server.ts`
- Test: `app/models/widget.server.test.ts`

**Interfaces:**
- Consumes: `Widget` model from Task 1, `getOrCreateShop` from Task 2 (test setup only).
- Produces: `type WidgetKind = "PRODUCT_PAGE_REELS" | "CAROUSEL" | "GRID" | "STORIES" | "REEL_POPS"`, `interface WidgetConfig { templateStyle: string; targetRule: { type: "all_products" } | { type: "handles"; handles: string[] } }`, `createWidget(shopId: string, type: WidgetKind, name: string, config: WidgetConfig): Promise<Widget>`, `listWidgetsForShop(shopId: string): Promise<Widget[]>`, `setWidgetPublished(id: string, published: boolean): Promise<Widget>`, `deleteWidget(id: string): Promise<void>` — consumed later by the admin-UI subsystem's widget list/editor screens.

- [ ] **Step 1: Write the failing test**

Create `app/models/widget.server.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../db.server";
import { getOrCreateShop } from "./shop.server";
import {
  createWidget,
  listWidgetsForShop,
  setWidgetPublished,
  deleteWidget,
} from "./widget.server";

describe("widget.server", () => {
  beforeEach(async () => {
    await prisma.widget.deleteMany();
    await prisma.shop.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a widget scoped to a shop, unpublished by default", async () => {
    const shop = await getOrCreateShop("widget-test.myshopify.com");
    const widget = await createWidget(shop.id, "CAROUSEL", "Homepage carousel", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });

    expect(widget.type).toBe("CAROUSEL");
    expect(widget.published).toBe(false);
  });

  it("lists only widgets belonging to the given shop", async () => {
    const shopA = await getOrCreateShop("widget-a.myshopify.com");
    const shopB = await getOrCreateShop("widget-b.myshopify.com");
    await createWidget(shopA.id, "GRID", "A grid", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });
    await createWidget(shopB.id, "STORIES", "B stories", {
      templateStyle: "classic",
      targetRule: { type: "all_products" },
    });

    const widgetsForA = await listWidgetsForShop(shopA.id);
    expect(widgetsForA).toHaveLength(1);
    expect(widgetsForA[0].name).toBe("A grid");
  });

  it("publishes and deletes a widget", async () => {
    const shop = await getOrCreateShop("widget-c.myshopify.com");
    const widget = await createWidget(shop.id, "REEL_POPS", "Pop", {
      templateStyle: "classic",
      targetRule: { type: "handles", handles: ["a-product"] },
    });

    const published = await setWidgetPublished(widget.id, true);
    expect(published.published).toBe(true);

    await deleteWidget(widget.id);
    const remaining = await listWidgetsForShop(shop.id);
    expect(remaining).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './widget.server'`.

- [ ] **Step 3: Write the implementation**

Create `app/models/widget.server.ts`:

```ts
import type { Prisma, Widget } from "@prisma/client";
import prisma from "../db.server";

export type WidgetKind =
  | "PRODUCT_PAGE_REELS"
  | "CAROUSEL"
  | "GRID"
  | "STORIES"
  | "REEL_POPS";

export interface WidgetConfig {
  templateStyle: string;
  targetRule:
    | { type: "all_products" }
    | { type: "handles"; handles: string[] };
}

export async function createWidget(
  shopId: string,
  type: WidgetKind,
  name: string,
  config: WidgetConfig,
): Promise<Widget> {
  return prisma.widget.create({
    data: {
      shopId,
      type,
      name,
      config: config as unknown as Prisma.InputJsonValue,
      published: false,
    },
  });
}

export async function listWidgetsForShop(shopId: string): Promise<Widget[]> {
  return prisma.widget.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
}

export async function setWidgetPublished(
  id: string,
  published: boolean,
): Promise<Widget> {
  return prisma.widget.update({ where: { id }, data: { published } });
}

export async function deleteWidget(id: string): Promise<void> {
  await prisma.widget.delete({ where: { id } });
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — all tests across both `shop.server.test.ts` and `widget.server.test.ts` green.

- [ ] **Step 5: Commit**

```bash
git add app/models/widget.server.ts app/models/widget.server.test.ts
git commit -m "feat(db): add widget.server.ts CRUD helpers"
```

---

### Task 5: Replace the template demo home page with a real dashboard shell

**Files:**
- Modify: `app/routes/app._index.tsx`

**Interfaces:**
- Consumes: `getOrCreateShop` from Task 2.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `app/routes/app._index.tsx` with:

```tsx
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  return { plan: shop.plan, viewCapMonthly: shop.viewCapMonthly };
};

export default function Index() {
  const { plan, viewCapMonthly } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Shoppable Videos">
      <s-section heading="Your plan">
        <s-paragraph>
          Current plan: <s-text>{plan}</s-text>
        </s-paragraph>
        <s-paragraph>
          Monthly view cap: <s-text>{viewCapMonthly.toLocaleString()}</s-text>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

This removes the template's "Generate a product" demo entirely — the first real screen of the app now reads a `Shop` row instead.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 3: Manual smoke check**

Run: `npm run dev`
Expected: Shopify CLI opens the embedded app in a dev store. The home page shows "Current plan: FREE" and "Monthly view cap: 200" instead of the old product-generator UI — confirms `getOrCreateShop` runs end-to-end through real Shopify session auth, not just under Vitest.

Note: this route calls `authenticate.admin(request)`, which needs a real or mocked Shopify session to unit-test in isolation. Mocking that harness is out of scope here — flagged as a follow-up for whichever subsystem plan first needs automated route-level tests (likely the admin-UI plan, Task list item 3 in the earlier breakdown).

- [ ] **Step 4: Commit**

```bash
git add app/routes/app._index.tsx
git commit -m "feat(admin): replace template demo home with real Shop-backed dashboard"
```

---

## Self-Review

**Spec coverage:** Prisma schema for plan/billing/widget state ✓ (Task 1). Reel metaobject with single JSON field scoped to the reel, not the product ✓ (Task 3). Product metafield reference ✓ (Task 3). Test infra, since none existed ✓ (Task 2). Widget config CRUD for the later admin/theme-extension subsystems to consume ✓ (Task 4). Scaffold cleanup ✓ (Task 5). `BillingCycle` usage-metering logic (recording views, computing overage) is intentionally **not** built here — it's schema-only in this plan; the actual metering/charging logic belongs to the Billing subsystem plan, which will consume the `BillingCycle` model defined in Task 1.

**Placeholder scan:** none found. The one open item (metaobject-reference type constraint in Task 3) is disclosed as a genuine follow-up with a concrete next step, not a stand-in for missing work — the metafield is fully functional without it.

**Type consistency:** `PlanTier` (Task 2) values match `Shop.plan` defaults and `PLAN_VIEW_CAPS` keys exactly. `WidgetKind` (Task 4) values are passed as plain strings into `Widget.type` (Task 1), consistent with the "no Prisma enum on SQLite" constraint. `WidgetConfig` shape is identical between `widget.server.ts` and its test file.
