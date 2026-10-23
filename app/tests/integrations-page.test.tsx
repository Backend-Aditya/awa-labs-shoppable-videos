import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TRACKING_DEFAULTS } from "../models/tracking";
import type { TrackingConfig } from "../models/tracking";

const state = vi.hoisted(() => ({
  tracking: {} as TrackingConfig,
  submit: vi.fn(),
  toast: vi.fn(),
  theme: null as { embedOn: boolean; placedBlocks: Set<string> } | null,
}));

vi.mock("react-router", () => ({
  useLoaderData: () => ({ tracking: state.tracking, apiKey: "key" }),
  useFetcher: () => ({ state: "idle", data: undefined, submit: state.submit }),
}));
vi.mock("@shopify/app-bridge-react", () => ({
  SaveBar: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div data-testid="save-bar">{children}</div> : null),
  useAppBridge: () => ({ toast: { show: state.toast } }),
}));
vi.mock("@shopify/shopify-app-react-router/server", () => ({ boundary: { headers: vi.fn() } }));
vi.mock("../shopify.server", () => ({ authenticate: {} }));
vi.mock("../models/shop.server", () => ({ getOrCreateShop: vi.fn() }));
vi.mock("../models/tracking.server", () => ({ getTracking: vi.fn(), saveTracking: vi.fn() }));
vi.mock("../components/useEditorGuards", () => ({ useEditorGuards: vi.fn() }));
vi.mock("../components/useThemeStatus", () => ({ useThemeStatus: () => state.theme }));

import Integrations from "../routes/app.integrations";

const card = (title: string) => screen.getByRole("heading", { name: title }).closest("section")!;
const saveButton = () => within(screen.getByTestId("save-bar")).getByRole("button", { name: "Save" });

beforeEach(() => {
  state.tracking = { ...TRACKING_DEFAULTS };
  state.submit.mockReset();
  state.toast.mockReset();
  state.theme = { embedOn: true, placedBlocks: new Set() };
});

describe("Integrations page", () => {
  it("shows what's on, and nothing to save until something changes", () => {
    render(<Integrations />);
    expect(within(card("Shopify customer events")).getByText("On")).toBeTruthy();
    expect(within(card("Microsoft Clarity")).getByText("Off")).toBeTruthy();
    expect(screen.queryByTestId("save-bar")).toBeNull();
    expect(screen.getByRole("switch", { name: "Publish video events to Shopify" }).getAttribute("aria-checked")).toBe("true");
  });

  it("switching a storefront tag on opens the save bar and saves the whole config", () => {
    render(<Integrations />);
    fireEvent.click(screen.getByRole("switch", { name: "Google Analytics 4" }));
    fireEvent.click(saveButton());
    expect(JSON.parse(state.submit.mock.calls[0][0])).toEqual({ ...TRACKING_DEFAULTS, ga4: true });
  });

  it("a malformed Clarity project ID is flagged and can't be saved", () => {
    render(<Integrations />);
    const input = screen.getByLabelText("Project ID");
    fireEvent.change(input, { target: { value: "ab-1" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("A project ID is 6–20 letters and numbers.")).toBeTruthy();
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    fireEvent.change(input, { target: { value: " K2X9AB4CDE " } });
    expect(input.getAttribute("aria-invalid")).toBeNull();
    fireEvent.click(saveButton());
    expect(JSON.parse(state.submit.mock.calls[0][0]).clarityId).toBe("k2x9ab4cde");
  });

  it("warns when Clarity is set but the app embed is off", () => {
    state.theme = { embedOn: false, placedBlocks: new Set() };
    state.tracking = { ...TRACKING_DEFAULTS, clarityId: "k2x9ab4cde" };
    render(<Integrations />);
    expect(within(card("Microsoft Clarity")).getByText(/app embed, which is off/)).toBeTruthy();
    expect(within(card("Microsoft Clarity")).getByText("On")).toBeTruthy();
  });

  it("builds custom pixel code for the chosen tool and copies it", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<Integrations />);
    const pixel = card("Custom pixel");
    const code = () => within(pixel).getByLabelText("Custom pixel code").textContent!;
    expect(code()).toContain("G-XXXXXXXXXX");
    fireEvent.change(within(pixel).getByLabelText("Measurement ID"), { target: { value: "g-ab12cd34ef" } });
    expect(code()).toContain('gtag("config", "G-AB12CD34EF"');

    fireEvent.click(within(pixel).getByRole("radio", { name: "Meta Pixel" }));
    fireEvent.change(within(pixel).getByLabelText("Pixel ID"), { target: { value: "1234567890123456" } });
    expect(code()).toContain('fbq("init", "1234567890123456");');
    expect(within(pixel).getByText(/set Permission to Marketing/)).toBeTruthy();

    fireEvent.click(within(pixel).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith("Code copied"));
    expect(writeText).toHaveBeenCalledWith(code());
  });

  it("explains that a custom pixel needs Shopify events on", () => {
    state.tracking = { ...TRACKING_DEFAULTS, shopifyEvents: false };
    render(<Integrations />);
    expect(within(card("Custom pixel")).getByText(/Turn on “Publish video events to Shopify”/)).toBeTruthy();
  });
});
