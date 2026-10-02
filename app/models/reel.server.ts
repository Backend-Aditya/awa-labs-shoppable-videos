export interface ReelConfig {
  cloudflareStreamUid?: string;
  posterUrl?: string;
  durationSeconds?: number;
  hlsManifestUrl?: string;
  dashManifestUrl?: string;
  uploadFailedAt?: string;
  productIds: string[];
  interactions: { ctaLabel?: string; ctaUrl?: string };
  source: { type: "upload" | "instagram" | "tiktok"; originalUrl?: string };
  // Feeds the storefront's VideoObject JSON-LD (schema.org) for this reel —
  // falls back to the reel's title/an empty description when unset. Kept in
  // config rather than as separate metaobject fields since nothing else
  // needs to query by them.
  seoTitle?: string;
  seoDescription?: string;
}

export interface Reel {
  id: string;
  handle: string;
  title: string;
  published: boolean;
  config: ReelConfig;
}

export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL response shape varies per query; this is the external Admin API boundary
  ) => Promise<{ json: () => Promise<any> }>;
}

export function generateReelHandle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const suffix = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  return slug ? `${slug}-${suffix}` : `reel-${suffix}`;
}

export function throwOnUserErrors(
  userErrors: Array<{ field: string[]; message: string }>,
): void {
  if (userErrors.length > 0) {
    throw new Error(userErrors.map((e) => e.message).join(", "));
  }
}

// The Admin API's `jsonValue` for this metaobject's boolean-typed "published"
// field comes back as the STRING "true"/"false", not a JS boolean — despite
// the field being declared `type = "boolean"` in shopify.app.toml. Every
// caller that read `node.published.jsonValue` straight into a `boolean`-typed
// field ended up with a non-empty string, which is truthy regardless of its
// content — so "false" behaved exactly like "true" everywhere (badges, the
// publish checkbox, everything). Confirmed live via debug logging: the raw
// GraphQL response held `"published":{"jsonValue":"false"}` after writing
// published=false.
function toBool(value: unknown): boolean {
  return value === true || value === "true";
}

export function assertNoGraphqlErrors(json: {
  data: unknown;
  errors?: Array<{ message: string }>;
}): void {
  if (json.errors && json.errors.length > 0) {
    throw new Error(
      `GraphQL request failed: ${json.errors.map((e) => e.message).join(", ")}`,
    );
  }
}

export async function upsertReel(
  admin: AdminGraphqlClient,
  handle: string,
  title: string,
  published: boolean,
  config: ReelConfig,
): Promise<Reel> {
  const response = await admin.graphql(
    `#graphql
    mutation UpsertReel($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject {
          id
          handle
          title: field(key: "title") { jsonValue }
          published: field(key: "published") { jsonValue }
          config: field(key: "config") { jsonValue }
        }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        handle: { type: "$app:reel", handle },
        metaobject: {
          fields: [
            { key: "title", value: title },
            { key: "published", value: String(published) },
            { key: "config", value: JSON.stringify(config) },
            // Mirrors config.productIds as native product references — this
            // is what the storefront block resolves into full product data
            // (title/price/image); the JSON config field alone is just raw
            // GID strings Liquid can't dereference.
            { key: "tagged_products", value: JSON.stringify(config.productIds) },
          ],
        },
      },
    },
  );

  const json = await response.json();
  assertNoGraphqlErrors(json);
  const result = json.data.metaobjectUpsert;
  throwOnUserErrors(result.userErrors);

  const node = result.metaobject;
  return {
    id: node.id,
    handle: node.handle,
    title: node.title.jsonValue,
    published: toBool(node.published.jsonValue),
    config: node.config.jsonValue,
  };
}

export async function listReels(
  admin: AdminGraphqlClient,
  first: number,
): Promise<Reel[]> {
  const response = await admin.graphql(
    `#graphql
    query ListReels($first: Int!) {
      metaobjects(type: "$app:reel", first: $first) {
        nodes {
          id
          handle
          title: field(key: "title") { jsonValue }
          published: field(key: "published") { jsonValue }
          config: field(key: "config") { jsonValue }
        }
      }
    }`,
    { variables: { first } },
  );

  const json = await response.json();
  assertNoGraphqlErrors(json);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL response shape varies per query; this is the external Admin API boundary
  return json.data.metaobjects.nodes.map((node: any) => ({
    id: node.id,
    handle: node.handle,
    title: node.title.jsonValue,
    published: toBool(node.published.jsonValue),
    config: node.config.jsonValue,
  }));
}

export async function getReel(
  admin: AdminGraphqlClient,
  id: string,
): Promise<Reel | null> {
  const response = await admin.graphql(
    `#graphql
    query GetReel($id: ID!) {
      metaobject(id: $id) {
        id
        handle
        title: field(key: "title") { jsonValue }
        published: field(key: "published") { jsonValue }
        config: field(key: "config") { jsonValue }
      }
    }`,
    { variables: { id } },
  );

  const json = await response.json();
  assertNoGraphqlErrors(json);

  const node = json.data.metaobject;
  if (!node) return null;

  return {
    id: node.id,
    handle: node.handle,
    title: node.title.jsonValue,
    published: toBool(node.published.jsonValue),
    config: node.config.jsonValue,
  };
}

// Writes ONLY the config (and mirrored tagged_products) fields — never title
// or published. This is called from places that can race with a merchant's
// own edit (the Cloudflare webhook, the upload-failure marker): reading
// title/published here and writing them straight back, as a plain upsertReel
// call would, can silently revert a publish/unpublish that happened in the
// gap between this function's read and write. metaobjectUpsert only touches
// fields present in the mutation's `fields` array, so omitting title/published
// here leaves whatever the merchant most recently saved untouched.
export async function updateReelConfig(
  admin: AdminGraphqlClient,
  id: string,
  partialConfig: Partial<ReelConfig>,
): Promise<Reel> {
  const existing = await getReel(admin, id);
  if (!existing) {
    throw new Error(`Reel not found: ${id}`);
  }

  const definedUpdates = Object.fromEntries(
    Object.entries(partialConfig).filter(([, value]) => value !== undefined),
  );

  const mergedConfig: ReelConfig = { ...existing.config, ...definedUpdates };

  const response = await admin.graphql(
    `#graphql
    mutation UpdateReelConfig($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject {
          id
          handle
          title: field(key: "title") { jsonValue }
          published: field(key: "published") { jsonValue }
          config: field(key: "config") { jsonValue }
        }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        handle: { type: "$app:reel", handle: existing.handle },
        metaobject: {
          fields: [
            { key: "config", value: JSON.stringify(mergedConfig) },
            { key: "tagged_products", value: JSON.stringify(mergedConfig.productIds) },
          ],
        },
      },
    },
  );

  const json = await response.json();
  assertNoGraphqlErrors(json);
  const result = json.data.metaobjectUpsert;
  throwOnUserErrors(result.userErrors);

  const node = result.metaobject;
  return {
    id: node.id,
    handle: node.handle,
    title: node.title.jsonValue,
    published: toBool(node.published.jsonValue),
    config: node.config.jsonValue,
  };
}

export async function deleteReel(
  admin: AdminGraphqlClient,
  id: string,
): Promise<void> {
  const response = await admin.graphql(
    `#graphql
    mutation DeleteReel($id: ID!) {
      metaobjectDelete(id: $id) {
        deletedId
        userErrors { field message }
      }
    }`,
    { variables: { id } },
  );

  const json = await response.json();
  assertNoGraphqlErrors(json);
  throwOnUserErrors(json.data.metaobjectDelete.userErrors);
}

// deriveReelStatus is a pure function with no server-only dependencies, so it
// lives in reel-status.ts (no `.server` suffix) — React Router strips
// `.server.ts` modules entirely from the client bundle, and this function is
// called directly from route components' JSX, not just loaders/actions.
export type { ReelStatus } from "./reel-status";
export { deriveReelStatus } from "./reel-status";

export interface ProductSummary {
  id: string;
  title: string;
  handle: string;
  imageUrl: string | null;
  priceRange: { min: string; max: string; currencyCode: string } | null;
}

export async function getProductsByIds(
  admin: AdminGraphqlClient,
  ids: string[],
): Promise<ProductSummary[]> {
  if (ids.length === 0) return [];

  const response = await admin.graphql(
    `#graphql
    query GetProductsByIds($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          handle
          featuredImage {
            url
          }
          priceRangeV2 {
            minVariantPrice { amount currencyCode }
            maxVariantPrice { amount currencyCode }
          }
        }
      }
    }`,
    { variables: { ids } },
  );

  const json = await response.json();
  assertNoGraphqlErrors(json);

  return json.data.nodes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL response shape varies per query; this is the external Admin API boundary
    .filter((node: any) => node?.id != null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same boundary as the filter above
    .map((node: any) => ({
      id: node.id,
      title: node.title,
      handle: node.handle,
      imageUrl: node.featuredImage?.url ?? null,
      priceRange: node.priceRangeV2
        ? {
            min: node.priceRangeV2.minVariantPrice.amount,
            max: node.priceRangeV2.maxVariantPrice.amount,
            currencyCode: node.priceRangeV2.minVariantPrice.currencyCode,
          }
        : null,
    }));
}

export async function syncProductReelMetafields(
  admin: AdminGraphqlClient,
  reelId: string,
  previousProductIds: string[],
  newProductIds: string[],
): Promise<void> {
  const added = newProductIds.filter((id) => !previousProductIds.includes(id));
  const removed = previousProductIds.filter((id) => !newProductIds.includes(id));
  const affectedProductIds = [...new Set([...added, ...removed])];

  if (affectedProductIds.length === 0) return;

  const response = await admin.graphql(
    `#graphql
    query GetProductReelMetafields($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          metafield(namespace: "$app", key: "reels") {
            value
          }
        }
      }
    }`,
    { variables: { ids: affectedProductIds } },
  );
  const json = await response.json();
  assertNoGraphqlErrors(json);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL response shape varies per query; this is the external Admin API boundary
  const metafieldsToSet = json.data.nodes.map((node: any) => {
    const currentReelIds: string[] = node.metafield?.value
      ? JSON.parse(node.metafield.value)
      : [];
    const shouldHaveReel = newProductIds.includes(node.id);
    const withoutThisReel = currentReelIds.filter((id) => id !== reelId);
    const updatedReelIds = shouldHaveReel
      ? [...withoutThisReel, reelId]
      : withoutThisReel;

    return {
      ownerId: node.id,
      namespace: "$app",
      key: "reels",
      type: "list.metaobject_reference",
      value: JSON.stringify(updatedReelIds),
    };
  });

  const setResponse = await admin.graphql(
    `#graphql
    mutation SetProductReelMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    { variables: { metafields: metafieldsToSet } },
  );
  const setJson = await setResponse.json();
  assertNoGraphqlErrors(setJson);
  throwOnUserErrors(setJson.data.metafieldsSet.userErrors);
}
