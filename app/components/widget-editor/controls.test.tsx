import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Card, ChipToggleGroup, ColorInput, Field, normalizeHex, Segmented, Slider, TextInput, Toggle } from "./controls";

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

describe("Segmented, roving tabindex keyboard navigation", () => {
  const options = [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
    { value: "c", label: "C" },
  ];

  it("only the chosen option is a tab stop", () => {
    render(<Segmented label="L" value="b" options={options} onChange={() => {}} />);
    expect(screen.getAllByRole("radio").map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it.each([
    ["ArrowRight", "c"],
    ["ArrowDown", "c"],
    ["ArrowLeft", "a"],
    ["ArrowUp", "a"],
    ["Home", "a"],
    ["End", "c"],
  ])("%s chooses %s", (key, expected) => {
    const onChange = vi.fn();
    render(<Segmented label="L" value="b" options={options} onChange={onChange} />);
    const event = fireEvent.keyDown(screen.getByRole("radiogroup"), { key });
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(event).toBe(false); // default prevented
  });

  it("wraps around and moves focus to the new choice", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
    try {
      render(
        <Controlled initial="c">
          {(value, set) => <Segmented label="L" value={value} options={options} onChange={set} />}
        </Controlled>,
      );
      fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
      expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("aria-checked", "true");
      vi.advanceTimersToNextFrame();
      expect(screen.getByRole("radio", { name: "A" })).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores other keys", () => {
    const onChange = vi.fn();
    render(<Segmented label="L" value="b" options={options} onChange={onChange} />);
    expect(fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "a" })).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("normalizeHex", () => {
  it.each([
    ["#abc", "#aabbcc"],
    ["ABC", "#aabbcc"],
    ["#A1B2C3", "#a1b2c3"],
    [" a1b2c3 ", "#a1b2c3"],
    ["#ab", null],
    ["#abcd", null],
    ["#gggggg", null],
    ["", null],
  ])("%j → %j", (input, expected) => {
    expect(normalizeHex(input)).toBe(expected);
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

  it("keeps a partial draft while typing and commits a complete 6-digit hex immediately, lower-cased", () => {
    const onChange = vi.fn();
    render(<ColorInput label="Accent" value="#ff0000" onChange={onChange} />);
    const hex = screen.getByLabelText("Accent hex value");
    fireEvent.change(hex, { target: { value: "#12" } });
    expect(hex).toHaveValue("#12");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(hex, { target: { value: "#ABCDEF" } });
    expect(onChange).toHaveBeenCalledWith("#abcdef");
  });

  it("commits shorthand / unprefixed hex on Enter or blur", () => {
    const onChange = vi.fn();
    render(<ColorInput label="Accent" value="#ff0000" onChange={onChange} />);
    const hex = screen.getByLabelText("Accent hex value");
    fireEvent.change(hex, { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(hex, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("#aabbcc");
    fireEvent.change(hex, { target: { value: " 123456 " } });
    fireEvent.blur(hex);
    expect(onChange).toHaveBeenLastCalledWith("#123456");
  });

  it("an invalid draft is flagged and reverts on blur", () => {
    const onChange = vi.fn();
    render(<ColorInput label="Accent" value="#ff0000" onChange={onChange} />);
    const hex = screen.getByLabelText("Accent hex value");
    fireEvent.change(hex, { target: { value: "#zz" } });
    fireEvent.blur(hex);
    expect(onChange).not.toHaveBeenCalled();
    expect(hex).toHaveValue("#ff0000");
    expect(hex).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Use a hex color like #1a2b3c");
    expect(hex).toHaveAccessibleDescription("Use a hex color like #1a2b3c");
    // Typing again clears the error.
    fireEvent.change(hex, { target: { value: "#1" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Enter on an invalid draft flags it without committing", () => {
    const onChange = vi.fn();
    render(<ColorInput label="Accent" value="#ff0000" onChange={onChange} />);
    const hex = screen.getByLabelText("Accent hex value");
    fireEvent.change(hex, { target: { value: "#12345" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does not allow clearing when allowEmpty is off", () => {
    const onChange = vi.fn();
    render(<ColorInput label="Accent" value="#ff0000" onChange={onChange} />);
    const hex = screen.getByLabelText("Accent hex value");
    fireEvent.change(hex, { target: { value: "" } });
    fireEvent.blur(hex);
    expect(onChange).not.toHaveBeenCalled();
    expect(hex).toHaveValue("#ff0000");
  });

  it("follows external value changes and falls back the swatch for a non-6-digit value", () => {
    const { rerender } = render(<ColorInput label="Accent" value="#ff0000" onChange={() => {}} fallback="#141414" />);
    rerender(<ColorInput label="Accent" value="#00ff00" onChange={() => {}} fallback="#141414" />);
    expect(screen.getByLabelText("Accent hex value")).toHaveValue("#00ff00");
    rerender(<ColorInput label="Accent" value="#abc" onChange={() => {}} fallback="#141414" />);
    expect(screen.getByLabelText("Accent color")).toHaveValue("#141414");
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
      const hex = screen.getByLabelText("Text hex value");
      fireEvent.change(hex, { target: { value: "  " } });
      fireEvent.blur(hex);
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
