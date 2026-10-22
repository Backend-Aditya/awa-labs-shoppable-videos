import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { PLAN_BY_TIER } from "./models/plans";

// A missing secret used to surface as a confusing OAuth or upload failure
// long after boot. In production, refuse to start instead, naming exactly
// what's missing so the Render deploy log says what to fix.
const REQUIRED_ENV = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "DATABASE_URL"];
// Needed for video upload/processing only — the rest of the app still works
// without them, so warn rather than refuse to boot.
const FEATURE_ENV = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_STREAM_WEBHOOK_SECRET"];
if (process.env.NODE_ENV === "production") {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  const missingFeature = FEATURE_ENV.filter((name) => !process.env[name]);
  if (missingFeature.length > 0) {
    console.warn(`Video uploads are disabled until these are set: ${missingFeature.join(", ")}`);
  }
}

// Recurring Billing API subscriptions, one per paid plan. Free has none.
// Shopify tracks each shop's used trial days per app, so a reinstall can't
// restart the 7-day trial.
const planConfig = (tier: "BASIC" | "PREMIUM" | "ELITE") => ({
  trialDays: PLAN_BY_TIER[tier].trialDays,
  lineItems: [
    {
      amount: PLAN_BY_TIER[tier].price,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days as const,
    },
  ],
});
const billing = {
  Basic: planConfig("BASIC"),
  Premium: planConfig("PREMIUM"),
  Elite: planConfig("ELITE"),
};

// True charges are only created when this is not "true"; dev and review
// stores must run with BILLING_TEST_MODE=true to get test charges.
export const isBillingTest = () => process.env.BILLING_TEST_MODE === "true";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
