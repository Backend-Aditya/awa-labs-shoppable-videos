import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Mandatory GDPR webhook for Shopify App Store apps. This app never stores
// customer PII — Session rows hold the installing staff member's info, and
// ReelEvent rows are anonymous view/click counters with no customer
// identifier — so there is no customer data to compile. Still must respond
// 200 so Shopify doesn't treat the request as failed/retry it.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  return new Response();
};
