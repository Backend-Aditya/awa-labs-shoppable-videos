import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, isBillingTest } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateShop, updateShopPlan } from "../models/shop.server";
import { listReels } from "../models/reel.server";
import { PAID_PLANS, PLANS, planFor, planFromBillingName, usageLevel } from "../models/plans";
import type { BillingPlanName, Plan } from "../models/plans";
import { log } from "../lib/logger.server";
import styles from "../components/pricing.module.css";

const PAID_NAMES = PAID_PLANS.map((p) => p.billingName as BillingPlanName);

function monthStartUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  // Shopify is the source of truth for what the shop pays for; keep the
  // local plan (and its view cap) in step with it.
  const check = await billing.check({ plans: PAID_NAMES, isTest: isBillingTest() });
  const subscription = check.appSubscriptions[0] ?? null;
  const active = planFromBillingName(subscription?.name);
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
    test: isBillingTest(),
    usage: {
      reels: reels.status === "fulfilled" ? reels.value.length : null,
      views: views.status === "fulfilled" ? (views.value._sum.views ?? 0) : null,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "subscribe") {
    const plan = PAID_PLANS.find((p) => p.tier === form.get("plan"));
    if (!plan) return { error: "Choose a plan." };
    try {
      // Redirects the merchant to Shopify's approval page; they come back here.
      return await billing.request({ plan: plan.billingName as BillingPlanName, isTest: isBillingTest() });
    } catch (error) {
      // The redirect to Shopify's approval page is thrown as a Response.
      if (error instanceof Response) throw error;
      log.error("pricing.subscribe_failed", { shop: session.shop, plan: plan.tier }, error);
      const message = error instanceof Error ? JSON.stringify((error as { errorData?: unknown }).errorData ?? "") : "";
      return {
        error: /public distribution/i.test(message)
          ? "Shopify only allows paid plans once the app's distribution is set to Public in the Partner Dashboard."
          : "We couldn't start your subscription. Try again in a moment.",
      };
    }
  }

  if (intent === "cancel") {
    const check = await billing.check({ plans: PAID_NAMES, isTest: isBillingTest() });
    const subscription = check.appSubscriptions[0];
    if (subscription) {
      await billing.cancel({ subscriptionId: subscription.id, isTest: isBillingTest(), prorate: true });
    }
    await updateShopPlan(session.shop, "FREE");
    return redirect("/app/pricing");
  }

  return { error: "Unknown action." };
};

const money = (n: number) => (n === 0 ? "$0" : `$${n % 1 === 0 ? n : n.toFixed(2)}`);

export default function Pricing() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const current = planFor(data.current);

  return (
    <s-page heading="Plans and pricing" inlineSize="large">
      <div className={styles.page}>
        {result && "error" in result && result.error && (
          <s-banner tone="critical" heading="Couldn't change your plan">
            {result.error}
          </s-banner>
        )}
        {data.test && (
          <s-banner tone="info" heading="Test mode">
            Charges are not real in test mode.
          </s-banner>
        )}
        <Usage current={current} usage={data.usage} />
        <div className={styles.grid}>
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.tier}
              plan={plan}
              current={plan.tier === current.tier}
              busy={busy}
              hasPaid={current.tier !== "FREE"}
              onSubscribe={() => submit({ intent: "subscribe", plan: plan.tier }, { method: "post" })}
              onCancel={() => submit({ intent: "cancel" }, { method: "post" })}
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
  busy,
  hasPaid,
  onSubscribe,
  onCancel,
}: {
  plan: Plan;
  current: boolean;
  busy: boolean;
  hasPaid: boolean;
  onSubscribe: () => void;
  onCancel: () => void;
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
            <s-button onClick={onCancel} disabled={busy}>
              Downgrade to Free
            </s-button>
          ) : null
        ) : (
          <s-button variant={plan.popular ? "primary" : undefined} onClick={onSubscribe} disabled={busy}>
            {plan.trialDays > 0 ? "Start free trial" : "Choose plan"}
          </s-button>
        )}
      </div>
    </section>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
