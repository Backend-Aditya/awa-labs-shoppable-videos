// One-off maintenance script: deletes every reel metaobject, clears every
// $app-namespaced shop metafield this app writes, and deletes every Widget
// row — for every shop this app has an offline session for. Does NOT touch
// Session, ReelEvent, or OrderAttribution rows (analytics/revenue history
// and the app's own install token aren't part of "flush reels/widgets").
//
// Run with: npx dotenv -e .env -- node scripts/flush-app-data.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const API_VERSION = "2026-07";

const WIDGET_METAFIELD_KEYS = [
  "product_page_reels_widget",
  "product_page_reels_widget_reels",
  "single_video_widget",
  "single_video_featured_reel",
  "stacked_carousel_widget",
  "stacked_carousel_widget_reels",
  "insta_stories_widget",
  "insta_stories_widget_reels",
  "reel_pops_widget",
  "reel_pops_featured_reel",
  "add_to_cart_video_widget",
  "add_to_cart_video_featured_reel",
];

async function adminGraphql(shop, accessToken, query, variables) {
  const response = await fetch(
    `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  const bodyText = await response.text();
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`Non-JSON response (status ${response.status}): ${bodyText.slice(0, 300)}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${bodyText.slice(0, 300)}`);
  }
  if (json.errors) {
    const message = Array.isArray(json.errors)
      ? json.errors.map((e) => e.message).join(", ")
      : JSON.stringify(json.errors);
    throw new Error(`GraphQL error: ${message}`);
  }
  return json.data;
}

async function deleteAllReels(shop, accessToken) {
  let deleted = 0;
  let cursor = null;
  for (;;) {
    const data = await adminGraphql(
      shop,
      accessToken,
      `#graphql
      query ListReels($first: Int!, $after: String) {
        metaobjects(type: "$app:reel", first: $first, after: $after) {
          nodes { id }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { first: 50, after: cursor },
    );
    const nodes = data.metaobjects.nodes;
    for (const node of nodes) {
      await adminGraphql(
        shop,
        accessToken,
        `#graphql
        mutation DeleteReel($id: ID!) {
          metaobjectDelete(id: $id) { deletedId userErrors { message } }
        }`,
        { id: node.id },
      );
      deleted += 1;
    }
    if (!data.metaobjects.pageInfo.hasNextPage) break;
    cursor = data.metaobjects.pageInfo.endCursor;
  }
  return deleted;
}

async function clearShopMetafields(shop, accessToken) {
  const shopData = await adminGraphql(
    shop,
    accessToken,
    `#graphql
    query GetShopId {
      shop { id }
    }`,
  );
  const ownerId = shopData.shop.id;

  const metafields = WIDGET_METAFIELD_KEYS.map((key) => ({
    ownerId,
    namespace: "$app",
    key,
  }));

  const result = await adminGraphql(
    shop,
    accessToken,
    `#graphql
    mutation ClearWidgetMetafields($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        deletedMetafields { key }
        userErrors { message }
      }
    }`,
    { metafields },
  );
  return result.metafieldsDelete.deletedMetafields.length;
}

async function main() {
  const sessions = await prisma.session.findMany({ where: { isOnline: false } });
  const shopsSeen = new Set();

  for (const session of sessions) {
    if (shopsSeen.has(session.shop)) continue;
    shopsSeen.add(session.shop);

    console.log(`--- ${session.shop} ---`);
    try {
      const reelsDeleted = await deleteAllReels(session.shop, session.accessToken);
      console.log(`  deleted ${reelsDeleted} reel metaobject(s)`);

      const metafieldsCleared = await clearShopMetafields(session.shop, session.accessToken);
      console.log(`  cleared ${metafieldsCleared} shop metafield(s)`);
    } catch (e) {
      console.error(`  failed: ${e.message}`);
    }
  }

  const { count } = await prisma.widget.deleteMany();
  console.log(`\nDeleted ${count} Widget row(s) across all shops.`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});