import type { AdminGraphqlClient } from "./reel.server";
import { assertNoGraphqlErrors, throwOnUserErrors } from "./reel.server";

// Writes one of the app's own JSON shop metafields (`$app` namespace,
// declared in shopify.app.toml) — how shop-wide settings reach the theme
// extension, which reads them in Liquid.
export async function setShopAppMetafield(admin: AdminGraphqlClient, key: string, value: unknown): Promise<void> {
  const shopResponse = await admin.graphql(
    `#graphql
    query GetShopIdForAppMetafield {
      shop { id }
    }`,
  );
  const shopJson = await shopResponse.json();
  assertNoGraphqlErrors(shopJson);

  const response = await admin.graphql(
    `#graphql
    mutation SetShopAppMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [{ ownerId: shopJson.data.shop.id, namespace: "$app", key, type: "json", value: JSON.stringify(value) }],
      },
    },
  );
  const json = await response.json();
  assertNoGraphqlErrors(json);
  throwOnUserErrors(json.data.metafieldsSet.userErrors);
}
