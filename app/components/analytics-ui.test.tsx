import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const router = vi.hoisted(() => ({ setSearchParams: vi.fn() }));
vi.mock("react-router", () => ({ useSearchParams: () => [new URLSearchParams(), router.setSearchParams] }));

import { Kpi, RangePicker, change, formatMoney, pointChange } from "./analytics-ui";

beforeEach(() => {
  router.setSearchParams.mockReset();
});

describe("formatting", () => {
  it("money in the shop's currency, falling back to a plain amount for an unknown code", () => {
    expect(formatMoney(1234.5, "USD")).toMatch(/\$1,23[45]/);
    expect(formatMoney(12.5, "USD", 2)).toContain("12.50");
    expect(formatMoney(12, "NOT-A-CURRENCY")).toBe("12 NOT-A-CURRENCY");
  });

  it("change is relative; new and unchanged-from-zero are special", () => {
    expect(change(150, 100)).toEqual({ label: "+50%", up: true });
    expect(change(50, 100)).toEqual({ label: "-50%", up: false });
    expect(change(5, 0)).toEqual({ label: "New", up: true });
    expect(change(0, 0)).toBeNull();
  });

  it("rate changes are in points, and nothing for no data or a negligible move", () => {
    expect(pointChange(3, 2)).toEqual({ label: "+1.0 pt", up: true });
    expect(pointChange(1.5, 2)).toEqual({ label: "-0.5 pt", up: false });
    expect(pointChange(2.02, 2)).toBeNull();
    expect(pointChange(null, 2)).toBeNull();
    expect(pointChange(4, null)).toEqual({ label: "New", up: true });
    expect(pointChange(0, null)).toBeNull();
  });
});

describe("Kpi", () => {
  it("says which way a change went for screen readers", () => {
    render(<Kpi label="Views" value="10" sub="per day" delta={{ label: "-5%", up: false }} />);
    expect(screen.getByText("Down")).toBeTruthy();
    expect(screen.getByText("per day")).toBeTruthy();
  });
});

describe("RangePicker", () => {
  it("is a radio group that switches the period in the URL (30 days is the default, so no param)", () => {
    render(<RangePicker days={30} />);
    const thirty = screen.getByRole("radio", { name: "30 days" });
    expect(thirty.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(thirty);
    expect(router.setSearchParams).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "7 days" }));
    expect(router.setSearchParams).toHaveBeenLastCalledWith({ days: "7" }, { preventScrollReset: true });
  });

  it("arrow keys move the choice", () => {
    render(<RangePicker days={7} />);
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(router.setSearchParams).toHaveBeenLastCalledWith({}, { preventScrollReset: true });
  });
});
