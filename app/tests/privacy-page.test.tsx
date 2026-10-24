import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ loader: {} as Record<string, unknown> }));

vi.mock("react-router", () => ({ useLoaderData: () => state.loader }));

import Privacy, { loader } from "../routes/privacy/route";

const ENV_KEYS = ["BUSINESS_NAME", "BUSINESS_ADDRESS", "SUPPORT_EMAIL", "APP_STORE_LISTING_URL"] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("privacy policy page", () => {
  it("takes the contact details from the environment, with safe defaults", () => {
    for (const key of ENV_KEYS) vi.stubEnv(key, "");
    expect(loader()).toEqual({
      businessName: "AWAlabs",
      businessAddress: null,
      supportEmail: null,
      listingUrl: "https://apps.shopify.com",
    });
    vi.stubEnv("SUPPORT_EMAIL", "help@example.com");
    vi.stubEnv("BUSINESS_ADDRESS", "1 Example Street");
    expect(loader()).toMatchObject({ supportEmail: "help@example.com", businessAddress: "1 Example Street" });
  });

  it("names every service provider and the deletion timeline", () => {
    state.loader = { businessName: "AWAlabs", businessAddress: null, supportEmail: null, listingUrl: "https://apps.shopify.com" };
    render(<Privacy />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeTruthy();
    for (const provider of ["Cloudflare, Inc.", "Fly.io", "Neon"]) {
      expect(screen.getByText(new RegExp(provider.replace(".", "\\.")))).toBeTruthy();
    }
    expect(screen.getByText(/About 48 hours later/)).toBeTruthy();
  });

  it("links the support email when one is set, otherwise the listing", () => {
    state.loader = { businessName: "AWAlabs", businessAddress: "1 Example Street", supportEmail: "help@example.com", listingUrl: "https://apps.shopify.com/x" };
    const { unmount } = render(<Privacy />);
    expect(screen.getByRole("link", { name: "help@example.com" }).getAttribute("href")).toBe("mailto:help@example.com");
    expect(screen.getByText(/1 Example Street/)).toBeTruthy();
    unmount();

    state.loader = { ...state.loader, businessAddress: null, supportEmail: null };
    render(<Privacy />);
    expect(screen.getByRole("link", { name: "Shopify App Store listing" }).getAttribute("href")).toBe("https://apps.shopify.com/x");
    expect(screen.queryByText(/1 Example Street/)).toBeNull();
  });
});
