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
const readout = (date: string, views: number, clicks: number) => `${label(date)}: ${views} views, ${clicks} clicks`;

describe("ViewsChart", () => {
  it("renders a titled chart as ONE keyboard stop, bars scaled to the peak", () => {
    const { container } = render(<ViewsChart daily={daily} title="Views this week" />);
    expect(screen.getByText("Views this week")).toBeInTheDocument();
    expect(screen.getByText("70 views · peak 40 a day")).toBeInTheDocument();
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("tabindex", "0");
    expect(slider).toHaveAccessibleName("Views this week. 70 views over 3 days, peak 40. Arrow keys read each day.");
    expect(slider).toHaveAttribute("aria-valuemin", "1");
    expect(slider).toHaveAttribute("aria-valuemax", "3");
    expect(slider).toHaveAttribute("aria-valuenow", "3");
    expect(slider).toHaveAttribute("aria-valuetext", readout("2026-10-03", 20, 0));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const heights = Array.from(container.querySelectorAll<HTMLElement>(".bar")).map((b) => b.style.height);
    expect(heights).toEqual(["25%", "100%", "50%"]);
    expect(container.querySelector(".axis")).toHaveTextContent(label("2026-10-01"));
    expect(container.querySelector(".axis")).toHaveTextContent(label("2026-10-03"));
    expect(container.querySelectorAll(".gridline")[1]).toHaveAttribute("data-label", "20");
  });

  it("shows a hovered day's readout and resets on leave", () => {
    const { container } = render(<ViewsChart daily={daily} />);
    expect(screen.getByText("Daily video views")).toBeInTheDocument();
    const bars = container.querySelectorAll(".barHit");
    fireEvent.mouseEnter(bars[0]);
    expect(screen.getByText(readout("2026-10-01", 10, 1))).toBeInTheDocument();
    expect(bars[0]).toHaveAttribute("data-active", "true");
    fireEvent.mouseLeave(screen.getByRole("slider"));
    expect(screen.getByText("70 views · peak 40 a day")).toBeInTheDocument();
    expect(bars[0]).not.toHaveAttribute("data-active");
  });

  it("focus starts on the latest day; arrows, Home and End move; blur clears", () => {
    render(<ViewsChart daily={daily} />);
    const slider = screen.getByRole("slider");
    fireEvent.focus(slider);
    expect(screen.getByText(readout("2026-10-03", 20, 0))).toBeInTheDocument();
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByText(readout("2026-10-02", 40, 3))).toBeInTheDocument();
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuenow", "3");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "3");
    expect(fireEvent.keyDown(slider, { key: "a" })).toBe(true);
    fireEvent.blur(slider);
    expect(screen.getByText("70 views · peak 40 a day")).toBeInTheDocument();
  });

  it("formats large numbers", () => {
    render(<ViewsChart daily={[{ date: "2026-10-01", views: 12345, clicks: 2000 }]} />);
    fireEvent.focus(screen.getByRole("slider"));
    expect(screen.getByText(new RegExp(`${(12345).toLocaleString()} views, ${(2000).toLocaleString()} clicks`))).toBeInTheDocument();
  });

  it("shows an empty state (no slider, no axis, no summary) when there were no views", () => {
    const { container } = render(<ViewsChart daily={daily.map((d) => ({ ...d, views: 0 }))} />);
    expect(screen.getByText("No views yet in this period.")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(container.querySelector(".axis")).toBeNull();
    expect(screen.queryByText(/peak/)).toBeNull();
  });

  it("handles an empty series", () => {
    render(<ViewsChart daily={[]} />);
    expect(screen.getByText("No views yet in this period.")).toBeInTheDocument();
  });
});
