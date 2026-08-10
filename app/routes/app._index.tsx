import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { listReels } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import { listWidgetsForShop } from "../models/widget.server";
import { PreserveSearchParams } from "../components/PreserveSearchParams";

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
        style={{
          all: "unset",
          cursor: "pointer",
          display: "block",
          width: "100%",
          boxSizing: "border-box",
          textAlign: "left",
          color: "inherit",
          border: "1px solid #d9d9d9",
          borderRadius: "8px",
          padding: "12px",
          background: "#ffffff",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "6px" }}>{heading}</div>
        <div style={{ color: "#6b6b6b" }}>{description}</div>
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
    <s-page heading="Shoppable Videos">
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-box padding="base" background="subdued" borderRadius="base" minInlineSize="140px">
            <s-stack gap="small-200">
              <s-text color="subdued">Reels</s-text>
              <s-heading>{totalReels}</s-heading>
              <s-text color="subdued">{readyReels} ready to play</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base" minInlineSize="140px">
            <s-stack gap="small-200">
              <s-text color="subdued">Widgets</s-text>
              <s-heading>{totalWidgets}</s-heading>
              <s-text color="subdued">{publishedWidgets} published</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base" minInlineSize="140px">
            <s-stack gap="small-200">
              <s-text color="subdued">Plan</s-text>
              <s-heading>{plan}</s-heading>
              <s-text color="subdued">{viewCapMonthly.toLocaleString()} views/mo</s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
      <s-section heading="Get started">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "12px",
          }}
        >
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
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
