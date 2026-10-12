import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ViewsChart } from "./ViewsChart";

const daily = [
  { date: "2026-10-01", views: 10, clicks: 1 },
  { date: "2026-10-02", views: 40, clicks: 3 },
  { date: "2026-10-03", views: 20, clicks: 0 },
];

// Labels use toLocaleDateString(undefined, …); build the expectation the
// same way so the test passes in any locale.
const label = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

describe("ViewsChart", () => {
  it("renders a titled figure with one labelled bar per day, scaled to the peak", () => {
    const { container } = render(<ViewsChart daily={daily} title="Views this week" />);
    expect(screen.getByText("Views this week")).toBeInTheDocument();
    expect(screen.getByText("Peak 40 a day")).toBeInTheDocument();
    const bars = screen.getAllByRole("button");
    expect(bars).toHaveLength(3);
    expect(bars[1]).toHaveAccessibleName(`${label("2026-10-02")}: 40 views, 3 clicks`);
    const heights = Array.from(container.querySelectorAll<HTMLElement>(".bar")).map((b) => b.style.height);
    expect(heights).toEqual(["25%", "100%", "50%"]);
    expect(container.querySelector(".axis")).toHaveTextContent(label("2026-10-01"));
    expect(container.querySelector(".axis")).toHaveTextContent(label("2026-10-03"));
    expect(container.querySelectorAll(".gridline")[1]).toHaveAttribute("data-label", "20");
  });

  it("shows a hovered day's readout and resets on leave", () => {
    const { container } = render(<ViewsChart daily={daily} />);
    expect(screen.getByText("Daily video views")).toBeInTheDocument();
    const bars = screen.getAllByRole("button");
    fireEvent.mouseEnter(bars[0]);
    expect(screen.getByText(`${label("2026-10-01")}: 10 views, 1 clicks`)).toBeInTheDocument();
    expect(bars[0]).toHaveAttribute("data-active", "true");
    fireEvent.mouseLeave(container.querySelector(".bars")!);
    expect(screen.getByText("Peak 40 a day")).toBeInTheDocument();
    expect(bars[0]).not.toHaveAttribute("data-active");
  });

  it("keyboard focus drives the same readout, blur clears it", () => {
    render(<ViewsChart daily={daily} />);
    const bars = screen.getAllByRole("button");
    fireEvent.focus(bars[2]);
    expect(screen.getByText(`${label("2026-10-03")}: 20 views, 0 clicks`)).toBeInTheDocument();
    fireEvent.blur(bars[2]);
    expect(screen.getByText("Peak 40 a day")).toBeInTheDocument();
  });

  it("formats large numbers", () => {
    render(<ViewsChart daily={[{ date: "2026-10-01", views: 12345, clicks: 2000 }]} />);
    fireEvent.focus(screen.getByRole("button"));
    expect(screen.getByText(new RegExp(`${(12345).toLocaleString()} views, ${(2000).toLocaleString()} clicks`))).toBeInTheDocument();
  });

  it("shows an empty state (no bars, no axis) when there were no views", () => {
    const { container } = render(<ViewsChart daily={daily.map((d) => ({ ...d, views: 0 }))} />);
    expect(screen.getByText("No views yet in this period.")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelector(".axis")).toBeNull();
    // Peak never divides by zero.
    expect(screen.getByText("Peak 1 a day")).toBeInTheDocument();
  });

  it("handles an empty series", () => {
    render(<ViewsChart daily={[]} />);
    expect(screen.getByText("No views yet in this period.")).toBeInTheDocument();
  });
});
