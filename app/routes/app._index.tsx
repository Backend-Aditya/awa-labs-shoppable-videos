import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { listReels } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import { listWidgetsForShop } from "../models/widget.server";
import { PreserveSearchParams } from "../components/PreserveSearchParams";
import { StatTile } from "../components/StatTile";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const [reels, widgets] = await Promise.all([
    listReels(admin, 50),
    listWidgetsForShop(shop.id),
  ]);

  const readyReels = reels.filter((r) => deriveReelStatus(r.config) === "ready").length;
  const publishedWidgets = widgets.filter((w) => w.published).length;

  return {
    plan: shop.plan,
    viewCapMonthly: shop.viewCapMonthly,
    totalReels: reels.length,
    readyReels,
    totalWidgets: widgets.length,
    publishedWidgets,
  };
};

function NavCard({
  to,
  heading,
  description,
}: {
  to: string;
  heading: string;
  description: string;
}) {
  return (
    <form method="get" action={to} style={{ margin: 0 }}>
      <PreserveSearchParams />
      <button
        type="submit"
        style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}
      >
        <s-box padding="base" background="subdued" borderRadius="base">
          <s-stack gap="small-200">
            <s-text>{heading}</s-text>
            <s-text color="subdued">{description}</s-text>
          </s-stack>
        </s-box>
      </button>
    </form>
  );
}

export default function Index() {
  const {
    plan,
    viewCapMonthly,
    totalReels,
    readyReels,
    totalWidgets,
    publishedWidgets,
  } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Shoppable Videos" inlineSize="large">
      <s-section>
        <s-stack gap="base">
          <s-paragraph color="subdued">
            An overview of your reels and storefront widgets.
          </s-paragraph>
          <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
            <StatTile
              label="Reels"
              value={totalReels}
              icon="video"
              caption={`${readyReels} ready to play`}
            />
            <StatTile
              label="Widgets"
              value={totalWidgets}
              icon="apps"
              caption={`${publishedWidgets} published`}
            />
            <StatTile
              label="Plan"
              value={plan}
              icon="plan"
              caption={`${viewCapMonthly.toLocaleString()} views/mo`}
            />
          </s-grid>
        </s-stack>
      </s-section>
      <s-section heading="Get started">
        <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
          <NavCard
            to="/app/reels"
            heading="Reels library"
            description="Upload videos, tag products, manage status"
          />
          <NavCard
            to="/app/widgets"
            heading="Widgets"
            description="Manage where reels show up on your storefront"
          />
        </s-grid>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
