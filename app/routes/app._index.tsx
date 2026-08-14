import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { listReels } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import { listWidgetsForShop } from "../models/widget.server";
import { PreserveSearchParams } from "../components/PreserveSearchParams";
import { PageShell } from "../components/ui/PageShell";
import { StatTile } from "../components/ui/StatTile";
import { CARD_INTERACTIVE_CLASSES } from "../components/ui/Card";

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
    <form method="get" action={to} className="m-0">
      <PreserveSearchParams />
      <button type="submit" className={`block w-full ${CARD_INTERACTIVE_CLASSES}`}>
        <div className="mb-1.5 font-semibold text-ink">{heading}</div>
        <div className="text-sm text-muted">{description}</div>
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
    <PageShell heading="Shoppable Videos">
      <div className="flex flex-wrap gap-4">
        <StatTile label="Reels" value={totalReels} sublabel={`${readyReels} ready to play`} />
        <StatTile label="Widgets" value={totalWidgets} sublabel={`${publishedWidgets} published`} />
        <StatTile label="Plan" value={plan} sublabel={`${viewCapMonthly.toLocaleString()} views/mo`} />
      </div>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Get started</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
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
      </section>
    </PageShell>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
