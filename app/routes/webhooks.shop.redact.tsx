import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR webhook — fires ~48h after uninstall. Must erase all data
// this app holds for the shop. BillingCycle has an onDelete: Restrict
// relation to Shop, so it has to be cleared before the Shop row can go;
// ReelEvent has no FK relation at all (schema gap), so it's deleted by
// shopId explicitly or it would be orphaned forever.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const shopRecord = await db.shop.findUnique({ where: { shopDomain: shop } });
  if (shopRecord) {
    await db.billingCycle.deleteMany({ where: { shopId: shopRecord.id } });
    await db.reelEvent.deleteMany({ where: { shopId: shopRecord.id } });
    await db.shop.delete({ where: { id: shopRecord.id } }); // cascades Widget
  }
  await db.session.deleteMany({ where: { shop } });

  return new Response();
};
