import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { login } from "../../shopify.server";

// There is no shop-domain form here: merchants install from the Shopify App
// Store. A request that already names a shop (Shopify sends one when it
// re-authenticates) is passed to OAuth; anything else goes to the landing page.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (new URL(request.url).searchParams.get("shop")) {
    const errors = await login(request);
    if (!errors?.shop) return null;
  }
  throw redirect("/");
};

export const action = async () => redirect("/");
