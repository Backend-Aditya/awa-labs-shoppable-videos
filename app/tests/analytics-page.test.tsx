import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const state = vi.hoisted(() => ({ loader: {} as Record<string, unknown>, navigate: vi.fn(), toast: vi.fn() }));

vi.mock("react-router", () => ({
  useLoaderData: () => state.loader,
  useNavigate: () => state.navigate,
  useNavigation: () => ({ state: "idle" }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock("@shopify/app-bridge-react", () => ({ useAppBridge: () => ({ toast: { show: state.toast } }) }));
vi.mock("@shopify/shopify-app-react-router/server", () => ({ boundary: { headers: vi.fn() } }));
vi.mock("../shopify.server", () => ({ authenticate: {} }));
vi.mock("../models/shop.server", () => ({ getOrCreateShop: vi.fn() }));
vi.mock("../models/reel.server", () => ({ listReels: vi.fn() }));
vi.mock("../models/analytics.server", () => ({ getDashboardStats: vi.fn(), parseRange: vi.fn(), reelKey: vi.fn() }));
vi.mock("../lib/logger.server", () => ({ log: { error: vi.fn() } }));

import Analytics from "../routes/app.analytics";

const totals = (over: object = {}) => ({
  views: 1000,
  clicks: 150,
  addToCarts: 40,
  completions: 300,
  watchSeconds: 15000,
  orders: 8,
  revenue: [{ currencyCode: "USD", amount: 640 }],
  ...over,
});
const row = (key: string, title: string, over: object = {}) => ({
  key,
  title,
  posterUrl: null,
  views: 0,
  clicks: 0,
  addToCarts: 0,
  completions: 0,
  watchSeconds: 0,
  unitsSold: 0,
  revenue: 0,
  ...over,
});

beforeEach(() => {
  state.navigate.mockReset();
  state.toast.mockReset();
  state.loader = {
    days: 30,
    partial: false,
    stats: {
      current: totals(),
      previous: totals({ views: 800, addToCarts: 20, revenue: [{ currencyCode: "USD", amount: 400 }] }),
      daily: [{ date: "2026-10-01", views: 1000, clicks: 150 }],
    },
    rows: [
      row("1", "Morning routine", { views: 600, clicks: 90, addToCarts: 30, completions: 200, watchSeconds: 9000, revenue: 500, unitsSold: 6 }),
      row("2", "=cmd|' /C calc'!A0", { views: 400, clicks: 60, addToCarts: 10, completions: 100, watchSeconds: 6000, revenue: 140, unitsSold: 2 }),
      row("3", "Not watched yet"),
    ],
  };
});

const kpi = (label: string) => screen.getByText(label, { selector: "span" }).parentElement!;

describe("Analytics page", () => {
  it("shows engagement and shopping KPIs with changes", () => {
    render(<Analytics />);
    expect(within(kpi("Video views")).getByText("1,000")).toBeTruthy();
    expect(within(kpi("Video views")).getByText("+25%")).toBeTruthy();
    expect(within(kpi("Avg. watch time")).getByText("0:15")).toBeTruthy();
    expect(within(kpi("Completion rate")).getByText("30.0%")).toBeTruthy();
    expect(within(kpi("Click rate")).getByText("15.0%")).toBeTruthy();
    expect(within(kpi("Adds to cart")).getByText("40")).toBeTruthy();
    expect(within(kpi("Add-to-cart rate")).getByText("4.0%")).toBeTruthy();
    expect(within(kpi("Add-to-cart rate")).getByText("+1.5 pt")).toBeTruthy();
    expect(within(kpi("Avg. order value")).getByText("$80.00")).toBeTruthy();
    expect(within(kpi("Avg. order value")).getByText("0.80% conversion")).toBeTruthy();
  });

  it("shows how much of the library gets watched and which video drives adds to cart", () => {
    render(<Analytics />);
    expect(within(kpi("Videos with views")).getByText("2")).toBeTruthy();
    expect(within(kpi("Videos with views")).getByText("of 3 in your library")).toBeTruthy();
    // 30 of the 40 adds to cart came from one video.
    expect(within(kpi("Top video's share")).getByText("75%")).toBeTruthy();
    expect(within(kpi("Top video's share")).getByText("of adds to cart: “Morning routine”")).toBeTruthy();
  });

  it("says so when nothing has been added to cart, and shortens long titles", () => {
    state.loader = {
      ...state.loader,
      rows: [row("9", "A very long video title that keeps going and going", { views: 5, addToCarts: 1 })],
    };
    const { unmount } = render(<Analytics />);
    expect(within(kpi("Top video's share")).getByText("of adds to cart: “A very long video title tha…”")).toBeTruthy();
    unmount();

    const stats = state.loader.stats as { current: object; previous: object };
    state.loader = { ...state.loader, stats: { ...stats, current: totals({ addToCarts: 0 }) }, rows: [row("9", "Quiet")] };
    render(<Analytics />);
    expect(within(kpi("Top video's share")).getByText("-")).toBeTruthy();
    expect(within(kpi("Top video's share")).getByText("no adds to cart yet")).toBeTruthy();
  });

  it("walks the funnel step by step", () => {
    render(<Analytics />);
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual(["Watched a video1,000", "Tapped a product15015.0%", "Added to cart4026.7%", "Ordered820.0%"]);
  });

  it("lists every video, unwatched ones too, and ranks by any column", () => {
    render(<Analytics />);
    const titles = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getByRole("rowheader").textContent);
    expect(titles()).toEqual(["Morning routine", "=cmd|' /C calc'!A0", "Not watched yet"]);
    fireEvent.click(screen.getByRole("button", { name: /Views/ }));
    expect(titles()).toEqual(["Not watched yet", "=cmd|' /C calc'!A0", "Morning routine"]);
    fireEvent.click(screen.getByRole("button", { name: /^Completion/ }));
    expect(titles()[0]).toBe("Morning routine");
    expect(screen.getByRole("button", { name: /^Completion/ }).closest("th")!.getAttribute("aria-sort")).toBe("descending");
  });

  it("exports the table as a spreadsheet-safe CSV", async () => {
    let blob: Blob | null = null;
    const createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return "blob:csv";
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<Analytics />);
    fireEvent.click(screen.getByText("Export CSV"));
    expect(click).toHaveBeenCalled();
    // jsdom's Blob has no text().
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob!);
    });
    const lines = text.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe(
      "Video,Views,Avg. watch (s),Completion %,Product taps,Click rate %,Adds to cart,Add-to-cart rate %,Units sold,Sales (USD)",
    );
    expect(lines[1]).toBe("Morning routine,600,15,33.33,90,15,30,5,6,500");
    expect(lines[2].startsWith("'=cmd")).toBe(true);
    expect(lines[3]).toBe("Not watched yet,0,,,0,,0,,0,0");
    expect(state.toast).toHaveBeenCalledWith("Exported");
    click.mockRestore();
  });

  it("an empty library points to uploading", () => {
    state.loader = { ...state.loader, rows: [] };
    render(<Analytics />);
    fireEvent.click(screen.getByText("Upload videos"));
    expect(state.navigate).toHaveBeenCalledWith("/app/reels?upload=1");
    expect(screen.queryByText("Export CSV")).toBeNull();
  });
});
