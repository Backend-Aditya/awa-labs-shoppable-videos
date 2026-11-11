// The Stories Design tab: shape, ring, sizes per device, names, header,
// spacing and colors, and what each control writes into the style.
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StoriesDesignTab } from "./StoriesDesign";
import type { Device, PreviewHighlight } from "./WidgetPreview";
import { WIDGET_KIND_META, resolveStyle } from "../../models/widget-kinds";
import type { WidgetStyleConfig } from "../../models/widget-kinds";

function setup(initial: WidgetStyleConfig = {}) {
  const latest: { style: WidgetStyleConfig; device: Device; focus: PreviewHighlight | null } = {
    style: resolveStyle("STORIES", initial),
    device: "desktop",
    focus: null,
  };
  function Harness() {
    const [style, setStyle] = useState<WidgetStyleConfig>(latest.style);
    const [device, setDevice] = useState<Device>("desktop");
    latest.style = style;
    latest.device = device;
    return (
      <StoriesDesignTab
        meta={WIDGET_KIND_META.STORIES}
        style={style}
        setStyle={(patch) => setStyle((prev) => ({ ...prev, ...patch }))}
        device={device}
        setDevice={setDevice}
        onFocusArea={(area) => {
          latest.focus = area;
        }}
      />
    );
  }
  render(<Harness />);
  return latest;
}

const sectionToggle = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });
const slider = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const pick = (group: string, option: string) =>
  userEvent.click(within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: option }));
const setRange = (input: HTMLInputElement, value: number) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("StoriesDesignTab", { timeout: 20_000 }, () => {
  it("opens on Stories; one section at a time, each outlining its part of the preview", async () => {
    const latest = setup();
    expect(sectionToggle("Stories")).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(sectionToggle("Header"));
    expect(latest.focus).toBe("header");
    expect(sectionToggle("Stories")).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(sectionToggle("Layout & spacing"));
    expect(latest.focus).toBe("layout");
    await userEvent.click(sectionToggle("Colors"));
    expect(latest.focus).toBe("section");
    await userEvent.click(sectionToggle("Colors"));
    expect(latest.focus).toBeNull();
  });

  it("closed sections summarise their choices", async () => {
    setup({ storyShape: "portrait", ringStyle: "none", showCaption: false, heading: "Stories", headerAlign: "center", triggerSizeMobile: 64, backgroundColor: "#101010" });
    await userEvent.click(sectionToggle("Stories"));
    expect(sectionToggle("Stories")).toHaveTextContent("Tall cards · No ring · No names");
    expect(sectionToggle("Header")).toHaveTextContent("Stories");
    expect(sectionToggle("Layout & spacing")).toHaveTextContent("Centered · 72px · 64px on phones");
    expect(sectionToggle("Colors")).toHaveTextContent("Background #101010");
  });

  it("an empty widget summarises its defaults", async () => {
    setup();
    await userEvent.click(sectionToggle("Stories"));
    expect(sectionToggle("Stories")).toHaveTextContent("Circles · Gradient ring · Names");
    expect(sectionToggle("Header")).toHaveTextContent("No header");
    expect(sectionToggle("Layout & spacing")).toHaveTextContent("Left aligned · 72px");
    expect(sectionToggle("Colors")).toHaveTextContent("Theme background");
  });

  it("stories: shape, ring, size per device, names", async () => {
    const latest = setup();
    await pick("Shape", "Tall card");
    expect(latest.style.storyShape).toBe("portrait");
    expect(slider("Card width")).toBeInTheDocument();
    await pick("Shape", "Rounded");
    expect(latest.style.storyShape).toBe("rounded");
    expect(screen.getByText(/turn grey/)).toBeInTheDocument();
    await pick("Ring", "None");
    expect(latest.style.ringStyle).toBe("none");
    expect(screen.queryByText(/turn grey/)).toBeNull();

    setRange(slider("Story size"), 96);
    expect(latest.style.triggerSize).toBe(96);

    // Phones start from the desktop size (Auto) and reset back to it.
    await userEvent.click(screen.getByRole("radio", { name: "Mobile" }));
    expect(latest.device).toBe("mobile");
    expect(slider("Story size").value).toBe("96");
    setRange(slider("Story size"), 60);
    expect(latest.style).toMatchObject({ triggerSize: 96, triggerSizeMobile: 60 });
    await userEvent.click(screen.getByRole("button", { name: "Reset story size to automatic" }));
    expect(latest.style.triggerSizeMobile).toBeUndefined();

    setRange(slider("Name size"), 11);
    expect(latest.style.cardTextSizeMobile).toBe(11);
    await userEvent.click(screen.getByRole("switch", { name: "Names under stories" }));
    expect(latest.style.showCaption).toBe(false);
    expect(screen.queryByLabelText("Name size")).toBeNull();
  });

  it("header text and alignment, with sizes", async () => {
    const latest = setup();
    await userEvent.click(sectionToggle("Header"));
    await userEvent.type(screen.getByLabelText("Eyebrow"), "New");
    await userEvent.type(screen.getByLabelText("Heading"), "Stories");
    await userEvent.type(screen.getByLabelText("Subheading"), "Tap to watch");
    await pick("Alignment", "Center");
    expect(latest.style).toMatchObject({ eyebrow: "New", heading: "Stories", subheading: "Tap to watch", headerAlign: "center" });
    setRange(slider("Heading size"), 30);
    expect(latest.style.headingSize).toBe(30);
  });

  it("spacing per device, and reset all sizes", async () => {
    const latest = setup({ triggerSizeMobile: 60, headingSize: 30 });
    await userEvent.click(sectionToggle("Layout & spacing"));
    setRange(slider("Space between stories"), 20);
    setRange(slider("Space above and below"), 50);
    expect(latest.style).toMatchObject({ cardGap: 20, sectionPaddingY: 50 });
    await userEvent.click(screen.getByRole("button", { name: "Reset all sizes to automatic" }));
    expect(latest.style.cardGap).toBeUndefined();
    expect(latest.style.triggerSizeMobile).toBeUndefined();
    expect(latest.style.headingSize).toBeUndefined();
  });

  it("colors follow the ring: start and end for a gradient, one for solid, none without a ring", async () => {
    const latest = setup();
    await userEvent.click(sectionToggle("Colors"));
    fireEvent.change(screen.getByLabelText("Ring start hex value"), { target: { value: "#111111" } });
    fireEvent.change(screen.getByLabelText("Ring end hex value"), { target: { value: "#222222" } });
    fireEvent.change(screen.getByLabelText("Background hex value"), { target: { value: "#333333" } });
    fireEvent.change(screen.getByLabelText("Text hex value"), { target: { value: "#444444" } });
    expect(latest.style).toMatchObject({ accentColor: "#111111", accentSecondaryColor: "#222222", backgroundColor: "#333333", textColor: "#444444" });

    await userEvent.click(sectionToggle("Stories"));
    await pick("Ring", "Solid");
    await userEvent.click(sectionToggle("Colors"));
    expect(screen.getByLabelText("Ring hex value")).toBeInTheDocument();
    expect(screen.queryByLabelText("Ring end hex value")).toBeNull();

    await userEvent.click(sectionToggle("Stories"));
    await pick("Ring", "None");
    await userEvent.click(sectionToggle("Colors"));
    expect(screen.queryByLabelText("Ring hex value")).toBeNull();
  });
});
