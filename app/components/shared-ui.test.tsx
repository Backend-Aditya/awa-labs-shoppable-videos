// Small shared admin pieces built on Polaris s-* web components. jsdom does
// not know those custom elements; they render as unknown elements, which is
// enough to check the attributes and content we pass them.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatTile } from "./StatTile";
import { EmptyState } from "./EmptyState";
import { ColorField, FIELD_INPUT_STYLE, NumberField, SelectField } from "./form-fields";

describe("StatTile", () => {
  it("renders label, value, icon and caption; accent switches the box styling", () => {
    const { container } = render(<StatTile label="Views" value={1200} icon="view" tone="info" accent caption="This month" />);
    expect(screen.getByText("Views")).toBeInTheDocument();
    expect(screen.getByText("1200")).toBeInTheDocument();
    expect(screen.getByText("This month")).toBeInTheDocument();
    const box = container.querySelector("s-box")!;
    expect(box.getAttribute("background")).toBe("base");
    expect(box.getAttribute("borderColor") ?? box.getAttribute("bordercolor")).toBe("strong");
    expect(container.querySelector("s-icon")!.getAttribute("type")).toBe("view");
    expect(container.querySelector("s-icon")!.getAttribute("tone")).toBe("info");
  });

  it("defaults: subdued box, neutral icon tone, no caption", () => {
    const { container } = render(<StatTile label="Reels" value="3" icon="video" />);
    expect(container.querySelector("s-box")!.getAttribute("background")).toBe("subdued");
    expect(container.querySelector("s-icon")!.getAttribute("tone")).toBe("neutral");
    expect(container.querySelectorAll("s-text")).toHaveLength(1);
  });

  it("omits the icon when none is given", () => {
    const { container } = render(<StatTile label="Orders" value={0} />);
    expect(container.querySelector("s-icon")).toBeNull();
  });
});

describe("EmptyState", () => {
  it("renders heading, body and a button that opens the create modal", () => {
    const { container } = render(
      <EmptyState icon="video" heading="No reels yet" body="Upload your first video." actionLabel="Add reel" actionCommandFor="create-modal" />,
    );
    expect(screen.getByText("No reels yet")).toBeInTheDocument();
    expect(screen.getByText("Upload your first video.")).toBeInTheDocument();
    const button = container.querySelector("s-button")!;
    expect(button).toHaveTextContent("Add reel");
    expect(button.getAttribute("commandFor") ?? button.getAttribute("commandfor")).toBe("create-modal");
    expect(button.getAttribute("command")).toBe("--show");
  });
});

describe("form-fields", () => {
  it("NumberField is a labelled, bounded, uncontrolled number input", () => {
    render(<NumberField id="cols" name="columns" label="Columns" min={1} max={6} defaultValue={4} />);
    const input = screen.getByLabelText("Columns");
    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveAttribute("name", "columns");
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "6");
    expect(input).toHaveValue(4);
    expect(input.style.borderRadius).toBe(FIELD_INPUT_STYLE.borderRadius);
  });

  it("SelectField renders its options with the default selected", () => {
    render(
      <SelectField
        id="pos"
        name="position"
        label="Position"
        defaultValue="bottom_left"
        options={[
          { value: "bottom_right", label: "Bottom right" },
          { value: "bottom_left", label: "Bottom left" },
        ]}
      />,
    );
    const select = screen.getByLabelText("Position");
    expect(select).toHaveValue("bottom_left");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("ColorField is a named color input", () => {
    render(<ColorField id="accent" name="accentColor" label="Accent" defaultValue="#ff0000" />);
    const input = screen.getByLabelText("Accent");
    expect(input).toHaveAttribute("type", "color");
    expect(input).toHaveAttribute("name", "accentColor");
    expect(input).toHaveValue("#ff0000");
  });
});
