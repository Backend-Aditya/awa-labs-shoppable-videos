import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useRef } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop, setShopEnabled } from "../models/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  return { plan: shop.plan, enabled: shop.enabled };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const enabled = formData.get("enabled") === "true";
  await setShopEnabled(admin, session.shop, enabled);
  return { error: null };
};

export default function Settings() {
  const { plan, enabled } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const enabledRef = useRef<HTMLInputElement>(null);

  return (
    <s-page heading="Settings" inlineSize="large">
      <s-section heading="Account">
        <s-paragraph>
          Current plan: <s-text>{plan}</s-text>
        </s-paragraph>
      </s-section>

      <s-section heading="Storefront">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            One switch for every reel widget on your storefront — product page reels, the
            carousel, stories, single video, and the reel-pops bubble. Turning this off hides
            all of them immediately, without having to remove or disable each one in the theme
            editor. Widgets you&rsquo;ve added still need their own Publish toggle on; this is
            just the master kill switch on top.
          </s-paragraph>
          <fetcher.Form method="post">
            <input
              type="hidden"
              name="enabled"
              ref={enabledRef}
              defaultValue={enabled ? "true" : "false"}
            />
            <s-checkbox
              label="Enable shoppable video widgets storefront-wide"
              defaultChecked={enabled}
              onChange={(event: { currentTarget: { checked: boolean } | null }) => {
                if (!enabledRef.current || !event.currentTarget) return;
                enabledRef.current.value = event.currentTarget.checked ? "true" : "false";
                fetcher.submit(
                  { enabled: enabledRef.current.value },
                  { method: "post" },
                );
              }}
            ></s-checkbox>
          </fetcher.Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
