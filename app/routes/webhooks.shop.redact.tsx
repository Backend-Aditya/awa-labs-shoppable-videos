import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR webhook — fires ~48h after uninstall. Must erase all data
// this app holds for the shop. Widget and ReelEvent both have an
// onDelete: Cascade relation to Shop, so deleting the Shop row alone
// takes them with it.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  await db.shop.deleteMany({ where: { shopDomain: shop } });
  await db.session.deleteMany({ where: { shop } });

  return new Response();
};
