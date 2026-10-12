import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Card, ChipToggleGroup, ColorInput, Field, Segmented, Slider, TextInput, Toggle } from "./controls";

// Controlled wrapper so typing behaves like it does in the editor.
function Controlled<T>({
  initial,
  children,
  onChange,
}: {
  initial: T;
  onChange?: (value: T) => void;
  children: (value: T, set: (value: T) => void) => JSX.Element;
}) {
  const [value, setValue] = useState(initial);
  return children(value, (next) => {
    setValue(next);
    onChange?.(next);
  });
}

describe("Field", () => {
  it("renders a <label for> when given htmlFor, a plain span otherwise, and an optional hint", () => {
    const { rerender } = render(
      <Field label="Heading" htmlFor="x" hint="Shown above the videos">
        <input id="x" />
      </Field>,
    );
    expect(screen.getByLabelText("Heading")).toHaveAttribute("id", "x");
    expect(screen.getByText("Shown above the videos")).toBeInTheDocument();

    rerender(
      <Field label="Columns">
        <span />
      </Field>,
    );
    expect(screen.getByText("Columns").tagName).toBe("SPAN");
    expect(screen.queryByText("Shown above the videos")).not.toBeInTheDocument();
  });
});

describe("TextInput", () => {
  it("is labelled, controlled, and reports every keystroke", async () => {
    const onChange = vi.fn();
    render(
      <Controlled initial="" onChange={onChange}>
        {(value, set) => <TextInput label="Heading" value={value} onChange={set} placeholder="See it in action" />}
      </Controlled>,
    );
    const input = screen.getByLabelText("Heading");
    expect(input).toHaveAttribute("placeholder", "See it in action");
    expect(input).toHaveAttribute("maxLength", "80");
    await userEvent.type(input, "Hi");
    expect(input).toHaveValue("Hi");
    expect(onChange).toHaveBeenLastCalledWith("Hi");
  });

  it("honours a custom maxLength", () => {
    render(<TextInput label="Label" value="" onChange={() => {}} maxLength={20} />);
    expect(screen.getByLabelText("Label")).toHaveAttribute("maxLength", "20");
  });
});

describe("Segmented", () => {
  const options = [
    { value: "carousel", label: "Slider" },
    { value: "grid", label: "Grid" },
    { value: "stack", label: "Deck" },
  ] as const;

  it("is a radiogroup with exactly one checked option", () => {
    render(<Segmented label="Layout" value="grid" options={[...options]} onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Layout" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Grid" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Slider" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
  });

  it("calls onChange with the option value", async () => {
    const onChange = vi.fn();
    render(<Segmented label="Layout" value="grid" options={[...options]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Deck" }));
    expect(onChange).toHaveBeenCalledWith("stack");
  });
});

describe("Toggle", () => {
  it("is a labelled switch that flips its value", async () => {
    const onChange = vi.fn();
    render(<Toggle label="Show price" description="Under each product" checked={false} onChange={onChange} />);
    const toggle = screen.getByRole("switch", { name: "Show price" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Under each product")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("turns off when on", async () => {
    const onChange = vi.fn();
    render(<Toggle label="Loop" checked onChange={onChange} />);
    expect(screen.getByRole("switch", { name: "Loop" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("switch", { name: "Loop" }));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe("Slider", () => {
  it("shows value + unit and reports numbers, not strings", () => {
    const onChange = vi.fn();
    render(<Slider label="Card width" value={200} min={140} max={300} step={10} onChange={onChange} />);
    const range = screen.getByLabelText("Card width");
    expect(range).toHaveAttribute("type", "range");
    expect(range).toHaveAttribute("min", "140");
    expect(range).toHaveAttribute("max", "300");
    expect(range).toHaveAttribute("step", "10");
    expect(screen.getByText("200px")).toBeInTheDocument();
    fireEvent.change(range, { target: { value: "250" } });
    expect(onChange).toHaveBeenCalledWith(250);
  });

  it("supports a custom unit", () => {
    render(<Slider label="Delay" value={3} min={0} max={60} unit="s" onChange={() => {}} />);
    expect(screen.getByText("3s")).toBeInTheDocument();
  });
});

describe("ColorInput", () => {
  it("without allowEmpty: no chip, swatch and hex both show the value", () => {
    render(<ColorInput label="Accent" value="#ff0000" onChange={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Accent color")).toHaveValue("#ff0000");
    expect(screen.getByLabelText("Accent hex value")).toHaveValue("#ff0000");
  });

  it("accepts a complete hex, lower-cases it, and ignores partial input", () => {
    const onChange = vi.fn();
    render(<ColorInput label="Accent" value="#ff0000" onChange={onChange} />);
    const hex = screen.getByLabelText("Accent hex value");
    fireEvent.change(hex, { target: { value: "#12" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(hex, { target: { value: " #ABCDEF " } });
    expect(onChange).toHaveBeenCalledWith("#abcdef");
  });

  it("does not allow clearing when allowEmpty is off", () => {
    const onChange = vi.fn();
    render(<ColorInput label="Accent" value="#ff0000" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Accent hex value"), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("picking from the swatch reports the new color", () => {
    const onChange = vi.fn();
    render(<ColorInput label="Accent" value="#ff0000" onChange={onChange} />);
    fireEvent.input(screen.getByLabelText("Accent color"), { target: { value: "#00ff00" } });
    expect(onChange).toHaveBeenCalledWith("#00ff00");
  });

  describe("allowEmpty (inherit) chip", () => {
    it('defaults to a "Theme" chip; empty value shows the fallback swatch and a placeholder', () => {
      render(<ColorInput label="Background" value="" onChange={() => {}} allowEmpty fallback="#ffffff" />);
      const chip = screen.getByRole("button", { name: "Theme" });
      expect(chip).toHaveAttribute("aria-pressed", "true");
      expect(chip).toHaveAttribute("title", "Using the theme color");
      expect(screen.getByLabelText("Background color")).toHaveValue("#ffffff");
      const hex = screen.getByLabelText("Background hex value");
      expect(hex).toHaveValue("");
      expect(hex).toHaveAttribute("placeholder", "Theme");
    });

    it('a "Brand" chip says brand and toggles between inherit and the fallback', async () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <ColorInput label="Button" value="" onChange={onChange} allowEmpty emptyLabel="Brand" fallback="#141414" />,
      );
      const chip = screen.getByRole("button", { name: "Brand" });
      expect(chip).toHaveAttribute("title", "Using the brand color");
      await userEvent.click(chip);
      expect(onChange).toHaveBeenLastCalledWith("#141414");

      rerender(<ColorInput label="Button" value="#336699" onChange={onChange} allowEmpty emptyLabel="Brand" />);
      expect(screen.getByRole("button", { name: "Brand" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "Brand" })).toHaveAttribute("title", "Use the brand color");
      expect(screen.getByLabelText("Button hex value")).toHaveAttribute("placeholder", "#000000");
      await userEvent.click(screen.getByRole("button", { name: "Brand" }));
      expect(onChange).toHaveBeenLastCalledWith("");
    });

    it("clearing the hex box goes back to inherit", () => {
      const onChange = vi.fn();
      render(<ColorInput label="Text" value="#123456" onChange={onChange} allowEmpty />);
      fireEvent.change(screen.getByLabelText("Text hex value"), { target: { value: "  " } });
      expect(onChange).toHaveBeenCalledWith("");
    });
  });
});

describe("ChipToggleGroup", () => {
  const options = [
    { value: "index", label: "Home" },
    { value: "product", label: "Product" },
    { value: "collection", label: "Collection" },
  ];

  it("marks selected chips pressed and adds/removes values", async () => {
    const onChange = vi.fn();
    render(<ChipToggleGroup label="Show on" hint="Empty = everywhere" options={options} selected={["product"]} onChange={onChange} />);
    expect(screen.getByText("Empty = everywhere")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Product" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(onChange).toHaveBeenLastCalledWith(["product", "index"]);
    await userEvent.click(screen.getByRole("button", { name: "Product" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe("Card", () => {
  it("renders title, description, action and body", () => {
    render(
      <Card title="Colors" description="Inherit from your brand" action={<button type="button">Reset</button>}>
        <p>body</p>
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "Colors" })).toBeInTheDocument();
    expect(screen.getByText("Inherit from your brand")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});
