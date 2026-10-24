import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateShop, updateShopPlan } from "../models/shop.server";
import { listReels } from "../models/reel.server";
import { PAID_PLANS, PLANS, planFor, planFromBillingName, usageLevel } from "../models/plans";
import type { Plan } from "../models/plans";
import { log } from "../lib/logger.server";
import styles from "../components/pricing.module.css";

// Plans are Shopify managed pricing: merchants pick and change a plan on a
// page Shopify hosts, so the app never creates charges itself.
const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "awalabs-shoppable-videos";

const plansUrl = (shopDomain: string) =>
  `https://admin.shopify.com/store/${shopDomain.replace(/\.myshopify\.com$/, "")}/charges/${APP_HANDLE}/pricing_plans`;

const ACTIVE_SUBSCRIPTIONS = `#graphql
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        name
        status
        test
      }
    }
  }
`;

function monthStartUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  // Shopify is the source of truth for what the shop pays for; keep the
  // local plan (and its view cap) in step with it.
  const response = await admin.graphql(ACTIVE_SUBSCRIPTIONS);
  const { data } = (await response.json()) as {
    data?: { currentAppInstallation?: { activeSubscriptions?: { name: string; status: string; test: boolean }[] } };
  };
  const subscriptions = data?.currentAppInstallation?.activeSubscriptions ?? [];
  const active = subscriptions.map((s) => planFromBillingName(s.name)).find(Boolean) ?? null;
  const tier = active?.tier ?? "FREE";
  if (shop.plan !== tier) await updateShopPlan(session.shop, tier);

  const [reels, views] = await Promise.allSettled([
    listReels(admin),
    prisma.reelDailyStat.aggregate({
      where: { shopId: shop.id, day: { gte: monthStartUtc() } },
      _sum: { views: true },
    }),
  ]);
  if (reels.status === "rejected") {
    if (reels.reason instanceof Response) throw reels.reason;
    log.error("pricing.reels_failed", { shop: session.shop }, reels.reason);
  }

  return {
    current: tier,
    test: subscriptions.some((s) => s.test),
    plansUrl: plansUrl(session.shop),
    usage: {
      reels: reels.status === "fulfilled" ? reels.value.length : null,
      views: views.status === "fulfilled" ? (views.value._sum.views ?? 0) : null,
    },
  };
};

const money = (n: number) => (n === 0 ? "$0" : `$${n % 1 === 0 ? n : n.toFixed(2)}`);

export default function Pricing() {
  const data = useLoaderData<typeof loader>();
  const current = planFor(data.current);

  return (
    <s-page heading="Plans and pricing" inlineSize="large">
      <div className={styles.page}>
        {data.test && (
          <s-banner tone="info" heading="Test mode">
            Test mode is on. You won&rsquo;t be charged.
          </s-banner>
        )}
        <Usage current={current} usage={data.usage} />
        <div className={styles.grid}>
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.tier}
              plan={plan}
              current={plan.tier === current.tier}
              plansUrl={data.plansUrl}
              hasPaid={current.tier !== "FREE"}
            />
          ))}
        </div>
        <p className={styles.note}>
          Prices are in USD per 30 days and billed by Shopify on your Shopify invoice. Paid plans start with a{" "}
          {PAID_PLANS[0].trialDays}-day free trial. Change or cancel any time; cancelling returns you to Free.
        </p>
      </div>
    </s-page>
  );
}

function Usage({ current, usage }: { current: Plan; usage: { reels: number | null; views: number | null } }) {
  const rows = [
    { label: "Videos", used: usage.reels, cap: current.reelLimit },
    { label: "Views this month", used: usage.views, cap: current.viewCap },
  ];
  return (
    <section className={styles.usage}>
      <h2 className={styles.usageTitle}>Your usage on {current.name}</h2>
      {rows.map((row) => {
        const level = row.used == null ? "ok" : usageLevel(row.used, row.cap);
        const pct = row.used == null ? 0 : Math.min(100, (row.used / row.cap) * 100);
        return (
          <div key={row.label} className={styles.meter}>
            <div className={styles.meterHead}>
              <span>{row.label}</span>
              <span>
                {row.used == null ? "-" : row.used.toLocaleString()} / {row.cap.toLocaleString()}
              </span>
            </div>
            <div
              className={styles.track}
              role="progressbar"
              aria-label={row.label}
              aria-valuemin={0}
              aria-valuemax={row.cap}
              aria-valuenow={row.used ?? 0}
            >
              <div className={styles.fill} data-level={level} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </section>
  );
}

function PlanCard({
  plan,
  current,
  plansUrl,
  hasPaid,
}: {
  plan: Plan;
  current: boolean;
  plansUrl: string;
  hasPaid: boolean;
}) {
  return (
    <section className={styles.card} data-popular={plan.popular || undefined} data-current={current || undefined}>
      {plan.popular && <span className={styles.badge}>Most popular</span>}
      <h2 className={styles.planName}>{plan.name}</h2>
      <p className={styles.tagline}>{plan.tagline}</p>
      <p className={styles.price}>
        <span className={styles.amount}>{money(plan.price)}</span>
        <span className={styles.per}>/month</span>
      </p>
      <p className={styles.trial}>{plan.trialDays > 0 ? `${plan.trialDays}-day free trial` : "Free forever"}</p>
      <ul className={styles.features}>
        {plan.features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <div className={styles.cta}>
        {current ? (
          <s-button disabled>Current plan</s-button>
        ) : plan.billingName === null ? (
          hasPaid ? (
            <s-button href={plansUrl} target="_top">
              Downgrade to Free
            </s-button>
          ) : null
        ) : (
          <s-button variant={plan.popular ? "primary" : undefined} href={plansUrl} target="_top">
            {plan.trialDays > 0 ? "Start free trial" : "Choose plan"}
          </s-button>
        )}
      </div>
    </section>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
