import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateShop, updateShopPlan } from "../models/shop.server";
import { listReels } from "../models/reel.server";
import { fetchShopifyBilling } from "../models/billing.server";
import { pendingPlanFromReturn, plansPageUrl, planMove, readBilling } from "../models/billing";
import type { PlanMove } from "../models/billing";
import { PAID_PLANS, PLANS, PLAN_BY_TIER, planFor, usageLevel } from "../models/plans";
import type { Plan, PlanTier } from "../models/plans";
import { log } from "../lib/logger.server";
import styles from "../components/pricing.module.css";

// Last resort when Shopify can't tell us the app handle. SHOPIFY_APP_HANDLE
// overrides it.
const FALLBACK_HANDLE = "awalabs-shoppable-videos-1";

function monthStartUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  // Shopify is the source of truth for what the shop pays for. When it
  // can't be read, keep the stored plan rather than guessing Free.
  const shopify = await fetchShopifyBilling(admin, session.shop);
  const billing = shopify ? readBilling(shopify.subscriptions, PLAN_BY_TIER.FREE) : null;
  let tier: PlanTier = planFor(shop.plan).tier;
  if (billing?.plan) {
    tier = billing.plan.tier;
    if (shop.plan !== tier) await updateShopPlan(session.shop, tier);
  }
  // Shopify sends the merchant back with `plan_handle` after they choose a
  // plan. It is only a hint (anyone can type it): the plan shown always comes
  // from Shopify's own record above.
  const pendingPlan = pendingPlanFromReturn(new URL(request.url).searchParams.get("plan_handle"), tier);
  const appHandle = process.env.SHOPIFY_APP_HANDLE || shopify?.appHandle || FALLBACK_HANDLE;

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
    lookupFailed: shopify === null,
    pendingPlan: pendingPlan?.name ?? null,
    unrecognized: billing?.unrecognized ?? null,
    test: billing?.test ?? false,
    trialEndsAt: billing?.trialEndsAt?.toISOString() ?? null,
    renewsAt: billing?.renewsAt?.toISOString() ?? null,
    plansUrl: plansPageUrl(session.shop, appHandle),
    usage: {
      reels: reels.status === "fulfilled" ? reels.value.length : null,
      views: views.status === "fulfilled" ? (views.value._sum.views ?? 0) : null,
    },
  };
};

const money = (n: number) => (n === 0 ? "$0" : `$${n % 1 === 0 ? n : n.toFixed(2)}`);

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function Pricing() {
  const data = useLoaderData<typeof loader>();
  const current = planFor(data.current);
  const revalidator = useRevalidator();

  // Plans change on a page Shopify hosts. When the merchant comes back to
  // this tab, re-read what they chose.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") revalidator.revalidate();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [revalidator]);

  // Right after approving a plan, Shopify can take a few seconds to show
  // it. Look again a few times instead of leaving the old plan on screen.
  const waiting = data.pendingPlan !== null;
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (++tries > 6) clearInterval(timer);
      else if (revalidator.state === "idle") revalidator.revalidate();
    }, 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const meta = data.trialEndsAt
    ? `Free trial ends ${dateLabel(data.trialEndsAt)}`
    : current.tier === "FREE"
      ? "Free forever"
      : data.renewsAt
        ? `Renews ${dateLabel(data.renewsAt)}`
        : null;

  return (
    <s-page heading="Plans and pricing" inlineSize="large">
      <div className={styles.page}>
        {data.lookupFailed && (
          <s-banner tone="warning" heading="We couldn't check your plan with Shopify">
            Showing your last known plan. You can still change plans below, and this page updates when you return.
          </s-banner>
        )}
        {data.pendingPlan && (
          <s-banner tone="info" heading={`Switching you to ${data.pendingPlan}`}>
            Shopify is confirming your new plan. This page updates by itself in a few seconds.
          </s-banner>
        )}
        {data.unrecognized && (
          <s-banner tone="warning" heading="We don't recognise your current plan">
            Shopify lists a plan called &ldquo;{data.unrecognized}&rdquo;. Choose one of the plans below, or contact support.
          </s-banner>
        )}
        {data.test && (
          <s-banner tone="info" heading="Test mode">
            This is a test charge. You won&rsquo;t be billed.
          </s-banner>
        )}
        <section className={styles.summary}>
          <div>
            <p className={styles.summaryLabel}>Current plan</p>
            <h2 className={styles.summaryName}>{current.name}</h2>
            {meta && <p className={styles.summaryMeta}>{meta}</p>}
          </div>
          <s-button href={data.plansUrl} target="_top">
            {current.tier === "FREE" ? "Choose a plan" : "Change or cancel plan"}
          </s-button>
        </section>
        <Usage current={current} usage={data.usage} />
        <div className={styles.grid}>
          {PLANS.map((plan) => (
            <PlanCard key={plan.tier} plan={plan} move={planMove(current, plan)} plansUrl={data.plansUrl} />
          ))}
        </div>
        <p className={styles.note}>
          Prices are in USD per 30 days and billed by Shopify on your Shopify invoice. Paid plans start with a{" "}
          {PAID_PLANS[0].trialDays}-day free trial. Changes happen on a Shopify page and take effect straight away.
          Cancelling returns you to Free.
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

const CTA: Record<PlanMove, (plan: Plan) => string> = {
  current: () => "Current plan",
  start: (plan) => (plan.trialDays > 0 ? "Start free trial" : "Choose plan"),
  upgrade: (plan) => `Upgrade to ${plan.name}`,
  downgrade: (plan) => `Switch to ${plan.name}`,
};

function PlanCard({ plan, move, plansUrl }: { plan: Plan; move: PlanMove; plansUrl: string }) {
  const current = move === "current";
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
          <s-button disabled>{CTA.current(plan)}</s-button>
        ) : (
          <s-button variant={plan.popular && move !== "downgrade" ? "primary" : undefined} href={plansUrl} target="_top">
            {CTA[move](plan)}
          </s-button>
        )}
      </div>
    </section>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
