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

// The page is built from Shopify's web components, which jsdom treats as
// plain elements: props land as attributes, and a control's value or checked
// state is set on the element before its event fires, as the browser does.
type Control = HTMLElement & { checked?: boolean; value?: string };
const find = (selector: string) => document.querySelector<Control>(selector)!;
const rowBadge = (title: string) =>
  [...document.querySelectorAll("s-text")].find((el) => el.textContent === title)!.parentElement!.querySelector("s-badge")!;
const control = (tag: string, label: string) => find(`${tag}[label="${label}"]`);
const saveButton = () => within(screen.getByTestId("save-bar")).getByRole("button", { name: "Save" });

function toggle(label: string, checked: boolean) {
  const element = control("s-switch", label);
  element.checked = checked;
  fireEvent(element, new Event("input", { bubbles: true }));
}

function type(tag: string, label: string, value: string) {
  const element = control(tag, label);
  element.value = value;
  fireEvent(element, new Event("input", { bubbles: true }));
}

beforeEach(() => {
  state.tracking = { ...TRACKING_DEFAULTS };
  state.submit.mockReset();
  state.toast.mockReset();
  state.theme = { embedOn: true, placedBlocks: new Set() };
});

describe("Integrations page", () => {
  it("shows what's on, and nothing to save until something changes", () => {
    render(<Integrations />);
    expect(rowBadge("Microsoft Clarity").textContent).toBe("Not connected");
    expect(screen.queryByTestId("save-bar")).toBeNull();
    expect(control("s-switch", "Publish video events to Shopify").hasAttribute("checked")).toBe(true);
  });

  it("switching a storefront tag on opens the save bar and saves the whole config", () => {
    render(<Integrations />);
    toggle("Send events to Google Analytics 4", true);
    fireEvent.click(saveButton());
    expect(JSON.parse(state.submit.mock.calls[0][0])).toEqual({ ...TRACKING_DEFAULTS, ga4: true });
  });

  it("a malformed Clarity project ID is flagged and can't be saved", () => {
    render(<Integrations />);
    type("s-text-field", "Project ID", "ab-1");
    expect(control("s-text-field", "Project ID").getAttribute("error")).toBe("A project ID is 6 to 20 letters and numbers.");
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    type("s-text-field", "Project ID", " K2X9AB4CDE ");
    expect(control("s-text-field", "Project ID").hasAttribute("error")).toBe(false);
    fireEvent.click(saveButton());
    expect(JSON.parse(state.submit.mock.calls[0][0]).clarityId).toBe("k2x9ab4cde");
  });

  it("warns when Clarity is set but the app embed is off", () => {
    state.theme = { embedOn: false, placedBlocks: new Set() };
    state.tracking = { ...TRACKING_DEFAULTS, clarityId: "k2x9ab4cde" };
    render(<Integrations />);
    expect(find('s-banner[heading="Turn on the app embed"]')).toBeTruthy();
    expect(rowBadge("Microsoft Clarity").textContent).toBe("Connected");
  });

  it("stays quiet about the app embed when nothing needs it", () => {
    state.theme = { embedOn: false, placedBlocks: new Set() };
    render(<Integrations />);
    expect(document.querySelector('s-banner[heading="Turn on the app embed"]')).toBeNull();
  });

  it("builds custom pixel code for the chosen tool and copies it", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<Integrations />);
    const code = () => control("s-text-area", "Custom pixel code").getAttribute("value")!;
    expect(code()).toContain("G-XXXXXXXXXX");
    type("s-text-field", "Measurement ID", "g-ab12cd34ef");
    expect(code()).toContain('gtag("config", "G-AB12CD34EF"');

    const select = control("s-select", "Send to");
    select.value = "meta";
    fireEvent(select, new Event("input", { bubbles: true }));
    type("s-text-field", "Pixel ID", "1234567890123456");
    expect(code()).toContain('fbq("init", "1234567890123456");');
    expect(screen.getByText(/set Permission to Marketing/)).toBeTruthy();

    fireEvent.click(find('s-modal#custom-pixel-modal s-button[slot="primary-action"]'));
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith("Code copied"));
    expect(writeText).toHaveBeenCalledWith(code());
  });

  it("explains that a custom pixel needs Shopify events on", () => {
    state.tracking = { ...TRACKING_DEFAULTS, shopifyEvents: false };
    render(<Integrations />);
    expect(screen.getByText(/Turn on “Publish video events to Shopify” and save/)).toBeTruthy();
  });
});
