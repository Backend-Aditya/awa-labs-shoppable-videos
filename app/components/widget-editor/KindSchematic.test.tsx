import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { KindSchematic } from "./KindSchematic";
import { WIDGET_KIND_META } from "../../models/widget-kinds";
import type { WidgetKind } from "../../models/widget-kinds";

const kinds = Object.keys(WIDGET_KIND_META) as WidgetKind[];

describe("KindSchematic", () => {
  it.each(kinds)("draws a decorative schematic for %s", (kind) => {
    const { container } = render(<KindSchematic kind={kind} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("viewBox", "0 0 160 100");
    // Background plus a kind-specific drawing.
    expect(svg.querySelector("g")).not.toBeNull();
    expect(svg.querySelectorAll("rect, circle, path").length).toBeGreaterThan(3);
  });

  it("gives every kind a distinct drawing", () => {
    const markup = kinds.map((kind) => render(<KindSchematic kind={kind} />).container.innerHTML);
    expect(new Set(markup).size).toBe(kinds.length);
  });

  it("renders just the page background for a kind with no drawing (legacy GRID)", () => {
    const { container } = render(<KindSchematic kind="GRID" />);
    expect(container.querySelector("svg g")).toBeNull();
    expect(container.querySelectorAll("svg rect")).toHaveLength(1);
  });
});
