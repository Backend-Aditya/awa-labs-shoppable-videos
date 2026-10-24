export type PlanTier = "FREE" | "BASIC" | "PREMIUM" | "ELITE";

// Keys of the `billing` config in shopify.server.ts.
export type BillingPlanName = "Basic" | "Premium" | "Elite";

export interface Plan {
  tier: PlanTier;
  // Name of the plan in the `billing` config (and on the Shopify
  // subscription). Free has none: it's the absence of a subscription.
  billingName: BillingPlanName | null;
  name: string;
  tagline: string;
  // USD per 30 days.
  price: number;
  trialDays: number;
  reelLimit: number;
  viewCap: number;
  features: string[];
  popular?: boolean;
}

export const TRIAL_DAYS = 7;

// What every plan gets: plans differ only in their limits and support, so
// no plan advertises a feature the others lack. The listing's plan text
// must match these lines.
const EVERY_PLAN = ["All six widgets and product moments", "Analytics and tracking integrations"];

// Priced 20% below ReelUp's equivalent tiers ($29.99 / $99.99 / $199).
// Monthly view caps are 2x ReelUp's, matching Shop.viewCapMonthly.
export const PLANS: Plan[] = [
  {
    tier: "FREE",
    billingName: null,
    name: "Free",
    tagline: "For trying out the app",
    price: 0,
    trialDays: 0,
    reelLimit: 10,
    viewCap: 200,
    features: ["Up to 10 videos", "200 monthly views", ...EVERY_PLAN],
  },
  {
    tier: "BASIC",
    billingName: "Basic",
    name: "Basic",
    tagline: "For growing brands",
    price: 23.99,
    trialDays: TRIAL_DAYS,
    reelLimit: 100,
    viewCap: 6000,
    features: ["Up to 100 videos", "6,000 monthly views", ...EVERY_PLAN, "Email support"],
  },
  {
    tier: "PREMIUM",
    billingName: "Premium",
    name: "Premium",
    tagline: "For scaling businesses",
    price: 79.99,
    trialDays: TRIAL_DAYS,
    reelLimit: 250,
    viewCap: 40000,
    features: ["Up to 250 videos", "40,000 monthly views", "Everything in Basic", "Priority support"],
    popular: true,
  },
  {
    tier: "ELITE",
    billingName: "Elite",
    name: "Elite",
    tagline: "For enterprise brands",
    price: 159.2,
    trialDays: TRIAL_DAYS,
    reelLimit: 1000,
    viewCap: 100000,
    features: ["Up to 1,000 videos", "100,000 monthly views", "Everything in Premium", "Priority support"],
  },
];

export const PLAN_BY_TIER = Object.fromEntries(PLANS.map((p) => [p.tier, p])) as Record<PlanTier, Plan>;

export const PAID_PLANS = PLANS.filter((p) => p.billingName !== null);

export function planFromBillingName(name: string | null | undefined): Plan | null {
  return PAID_PLANS.find((p) => p.billingName === name) ?? null;
}

export function planFor(tier: string | null | undefined): Plan {
  return PLAN_BY_TIER[tier as PlanTier] ?? PLAN_BY_TIER.FREE;
}

// How close a shop is to a cap, for banners: "ok" < 80% <= "near" < 100% <= "over".
export function usageLevel(used: number, cap: number): "ok" | "near" | "over" {
  if (cap <= 0) return "ok";
  const ratio = used / cap;
  return ratio >= 1 ? "over" : ratio >= 0.8 ? "near" : "ok";
}
