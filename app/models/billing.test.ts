import { describe, expect, it } from "vitest";
import { plansPageUrl, planMove, readBilling } from "./billing";
import type { ShopifySubscription } from "./billing";
import { PLAN_BY_TIER } from "./plans";

const sub = (over: Partial<ShopifySubscription> = {}): ShopifySubscription => ({
  name: "premium",
  status: "ACTIVE",
  test: false,
  createdAt: "2026-10-20T00:00:00Z",
  trialDays: 7,
  currentPeriodEnd: "2026-11-19T00:00:00Z",
  ...over,
});
const free = PLAN_BY_TIER.FREE;
const now = new Date("2026-10-22T00:00:00Z");

describe("readBilling", () => {
  it("is Free with no active charge", () => {
    expect(readBilling([], free, now).plan?.tier).toBe("FREE");
    expect(readBilling([sub({ status: "CANCELLED" })], free, now).plan?.tier).toBe("FREE");
  });

  it("reads Shopify's lowercase plan names and reports the trial", () => {
    const state = readBilling([sub()], free, now);
    expect(state.plan?.tier).toBe("PREMIUM");
    expect(state.trialEndsAt?.toISOString()).toBe("2026-10-27T00:00:00.000Z");
    expect(state.renewsAt?.toISOString()).toBe("2026-11-19T00:00:00.000Z");
  });

  it("drops the trial once it has ended", () => {
    expect(readBilling([sub()], free, new Date("2026-11-01T00:00:00Z")).trialEndsAt).toBeNull();
  });

  it("takes the higher tier while a shop holds two charges", () => {
    expect(readBilling([sub({ name: "basic" }), sub({ name: "elite" })], free, now).plan?.tier).toBe("ELITE");
  });

  it("flags a charge it does not recognise instead of assuming Free", () => {
    const state = readBilling([sub({ name: "Gold" })], free, now);
    expect(state.plan).toBeNull();
    expect(state.unrecognized).toBe("Gold");
  });
});

describe("plansPageUrl", () => {
  it("builds Shopify's hosted plan page from the shop and app handle", () => {
    expect(plansPageUrl("awalabs.myshopify.com", "awalabs-shoppable-videos")).toBe(
      "https://admin.shopify.com/store/awalabs/charges/awalabs-shoppable-videos/pricing_plans",
    );
  });
});

describe("planMove", () => {
  it("labels what choosing a plan means", () => {
    expect(planMove(PLAN_BY_TIER.FREE, PLAN_BY_TIER.BASIC)).toBe("start");
    expect(planMove(PLAN_BY_TIER.BASIC, PLAN_BY_TIER.ELITE)).toBe("upgrade");
    expect(planMove(PLAN_BY_TIER.ELITE, PLAN_BY_TIER.FREE)).toBe("downgrade");
    expect(planMove(PLAN_BY_TIER.PREMIUM, PLAN_BY_TIER.PREMIUM)).toBe("current");
  });
});
