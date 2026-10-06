import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import {
  extractAttributionsFromOrderPayload,
  recordOrderAttributions,
} from "../models/order-attribution.server";
import type { OrderPaidWebhookPayload } from "../models/order-attribution.server";

// Revenue attribution's data source. The payload carries the customer's
// name/email/address/etc. — deliberately read through
// extractAttributionsFromOrderPayload (which only looks at id/name/
// currency/line_items) rather than passed through wholesale, and nothing
// beyond its narrow return value ever reaches storage or a log line.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const shopRecord = await getOrCreateShop(shop);
  const attributions = extractAttributionsFromOrderPayload(
    payload as unknown as OrderPaidWebhookPayload,
  );

  if (attributions.length > 0) {
    const order = payload as unknown as OrderPaidWebhookPayload;
    await recordOrderAttributions(shopRecord.id, String(order.id), order.name, attributions);
  }

  return new Response();
};
