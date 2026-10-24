import { PAID_PLANS, PLAN_BY_TIER, planFromBillingName } from "./plans";
import type { Plan } from "./plans";

// Plans are Shopify managed pricing. Merchants pick and change a plan on a
// page Shopify hosts; the app only reads what they ended up with.

export interface ShopifySubscription {
  name: string;
  status: string;
  test: boolean;
  createdAt: string | null;
  trialDays: number;
  currentPeriodEnd: string | null;
}

export interface BillingState {
  // The plan Shopify says the shop is on. null when Shopify has a charge we
  // don't recognise, so the caller can leave the stored plan alone.
  plan: Plan | null;
  subscription: ShopifySubscription | null;
  // A subscription exists but its name is not one of our plans.
  unrecognized: string | null;
  test: boolean;
  trialEndsAt: Date | null;
  renewsAt: Date | null;
}

const FREE: Pick<BillingState, "subscription" | "unrecognized" | "test" | "trialEndsAt" | "renewsAt"> = {
  subscription: null,
  unrecognized: null,
  test: false,
  trialEndsAt: null,
  renewsAt: null,
};

const rank = (plan: Plan | null) => (plan ? PAID_PLANS.findIndex((p) => p.tier === plan.tier) + 1 : 0);

// A shop can briefly hold two active charges while it switches plans; the
// higher tier is the one it is moving to or paying for.
export function readBilling(subscriptions: ShopifySubscription[], freePlan: Plan, now = new Date()): BillingState {
  const active = subscriptions.filter((s) => s.status === "ACTIVE");
  if (active.length === 0) return { plan: freePlan, ...FREE };

  const known = active
    .map((subscription) => ({ subscription, plan: planFromBillingName(subscription.name) }))
    .filter((entry): entry is { subscription: ShopifySubscription; plan: Plan } => entry.plan !== null)
    .sort((a, b) => rank(b.plan) - rank(a.plan));

  if (known.length === 0) return { plan: null, ...FREE, unrecognized: active[0].name };

  const { subscription, plan } = known[0];
  const created = subscription.createdAt ? new Date(subscription.createdAt) : null;
  const trialEnd =
    created && subscription.trialDays > 0 ? new Date(created.getTime() + subscription.trialDays * 86_400_000) : null;
  return {
    plan,
    subscription,
    unrecognized: null,
    test: subscription.test,
    trialEndsAt: trialEnd && trialEnd > now ? trialEnd : null,
    renewsAt: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null,
  };
}

// The Shopify-hosted page where a merchant chooses, changes or cancels a plan.
export function plansPageUrl(shopDomain: string, appHandle: string): string {
  const store = shopDomain.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${encodeURIComponent(store)}/charges/${encodeURIComponent(appHandle)}/pricing_plans`;
}

export type PlanMove = "current" | "upgrade" | "downgrade" | "start";

// What choosing `target` means for a shop on `current`, for button labels.
export function planMove(current: Plan, target: Plan): PlanMove {
  if (current.tier === target.tier) return "current";
  if (current.tier === "FREE") return "start";
  return target.price > current.price ? "upgrade" : "downgrade";
}

// The plan a merchant just chose, from the `plan_handle` Shopify adds to the
// redirect back to the app. Returns it only while the shop's recorded plan
// hasn't caught up, so the page can say the change is being confirmed.
export function pendingPlanFromReturn(planHandle: string | null, currentTier: Plan["tier"]): Plan | null {
  if (!planHandle) return null;
  const wanted = planHandle.trim().toLowerCase();
  const plan = planFromBillingName(wanted) ?? (wanted === "free" ? PLAN_BY_TIER.FREE : null);
  return plan && plan.tier !== currentTier ? plan : null;
}
