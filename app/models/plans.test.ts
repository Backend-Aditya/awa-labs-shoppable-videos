import { describe, expect, it } from "vitest";
import { PAID_PLANS, PLANS, planFor, planFromBillingName, usageLevel } from "./plans";

describe("plans", () => {
  it("prices every paid tier 20% below the reference prices", () => {
    const reference = { BASIC: 29.99, PREMIUM: 99.99, ELITE: 199 };
    for (const plan of PAID_PLANS) {
      const ref = reference[plan.tier as keyof typeof reference];
      expect(plan.price).toBeCloseTo(ref * 0.8, 1);
    }
  });

  it("is free at the bottom and strictly increasing above it", () => {
    expect(PLANS[0].price).toBe(0);
    expect(PLANS[0].billingName).toBeNull();
    for (let i = 1; i < PLANS.length; i++) {
      expect(PLANS[i].price).toBeGreaterThan(PLANS[i - 1].price);
      expect(PLANS[i].reelLimit).toBeGreaterThan(PLANS[i - 1].reelLimit);
      expect(PLANS[i].viewCap).toBeGreaterThan(PLANS[i - 1].viewCap);
    }
  });

  it("lists each plan's real limits first, so the copy can't drift from them", () => {
    for (const plan of PLANS) {
      expect(plan.features[0]).toBe(`Up to ${plan.reelLimit.toLocaleString("en-US")} videos`);
      expect(plan.features[1]).toBe(`${plan.viewCap.toLocaleString("en-US")} monthly views`);
    }
  });

  it("promises no plan perk the app doesn't have (analytics and attribution are on every plan)", () => {
    for (const plan of PLANS) {
      expect(plan.features.join(" ")).not.toMatch(/sales attributed|advanced analytics|analytics suite|dedicated|custom integration/i);
    }
    expect(PLANS[0].features).toContain("Analytics and tracking integrations");
  });

  it("gives every paid plan a 7-day trial", () => {
    expect(PAID_PLANS.every((p) => p.trialDays === 7)).toBe(true);
  });

  it("looks plans up by billing name and tier, falling back to Free", () => {
    expect(planFromBillingName("Premium")?.tier).toBe("PREMIUM");
    expect(planFromBillingName("elite")?.tier).toBe("ELITE");
    expect(planFromBillingName("Nope")).toBeNull();
    expect(planFromBillingName(undefined)).toBeNull();
    expect(planFor("ELITE").name).toBe("Elite");
    expect(planFor("garbage").tier).toBe("FREE");
  });

  it("flags usage at 80% and 100% of a cap", () => {
    expect(usageLevel(79, 100)).toBe("ok");
    expect(usageLevel(80, 100)).toBe("near");
    expect(usageLevel(100, 100)).toBe("over");
  });
});
