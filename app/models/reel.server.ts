export interface ReelConfig {
  cloudflareStreamUid?: string;
  posterUrl?: string;
  durationSeconds?: number;
  productIds: string[];
  interactions: { ctaLabel?: string; ctaUrl?: string };
  source: { type: "upload" | "instagram" | "tiktok"; originalUrl?: string };
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

function throwOnUserErrors(
  userErrors: Array<{ field: string[]; message: string }>,
): void {
  if (userErrors.length > 0) {
    throw new Error(userErrors.map((e) => e.message).join(", "));
  }
}

function assertNoGraphqlErrors(json: {
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
    published: node.published.jsonValue,
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
    published: node.published.jsonValue,
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
    published: node.published.jsonValue,
    config: node.config.jsonValue,
  };
}

export async function updateReelConfig(
  admin: AdminGraphqlClient,
  id: string,
  partialConfig: Partial<ReelConfig>,
): Promise<Reel> {
  const existing = await getReel(admin, id);
  if (!existing) {
    throw new Error(`Reel not found: ${id}`);
  }

  const mergedConfig: ReelConfig = { ...existing.config, ...partialConfig };

  return upsertReel(
    admin,
    existing.handle,
    existing.title,
    existing.published,
    mergedConfig,
  );
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
