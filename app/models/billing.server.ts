import { log } from "../lib/logger.server";
import type { ShopifySubscription } from "./billing";

interface AdminClient {
  graphql: (query: string) => Promise<Response>;
}

const QUERY = `#graphql
  query BillingState {
    currentAppInstallation {
      app {
        handle
      }
      activeSubscriptions {
        name
        status
        test
        createdAt
        trialDays
        currentPeriodEnd
      }
    }
  }
`;

export interface ShopifyBilling {
  appHandle: string | null;
  subscriptions: ShopifySubscription[];
}

// Reads the app's handle and the shop's active charges. Returns null when
// Shopify can't be reached, so the caller keeps the stored plan instead of
// guessing Free and silently downgrading a paying shop.
export async function fetchShopifyBilling(admin: AdminClient, shop: string): Promise<ShopifyBilling | null> {
  try {
    const response = await admin.graphql(QUERY);
    const body = (await response.json()) as {
      data?: {
        currentAppInstallation?: {
          app?: { handle?: string | null };
          activeSubscriptions?: Partial<ShopifySubscription>[];
        };
      };
      errors?: unknown;
    };
    const installation = body.data?.currentAppInstallation;
    if (!installation) {
      log.error("billing.read_failed", { shop }, new Error(JSON.stringify(body.errors ?? "no installation")));
      return null;
    }
    return {
      appHandle: installation.app?.handle ?? null,
      subscriptions: (installation.activeSubscriptions ?? []).map((s) => ({
        name: String(s.name ?? ""),
        status: String(s.status ?? ""),
        test: Boolean(s.test),
        createdAt: s.createdAt ?? null,
        trialDays: Number(s.trialDays ?? 0),
        currentPeriodEnd: s.currentPeriodEnd ?? null,
      })),
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    log.error("billing.read_failed", { shop }, error);
    return null;
  }
}
