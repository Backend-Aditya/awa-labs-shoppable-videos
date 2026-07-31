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
