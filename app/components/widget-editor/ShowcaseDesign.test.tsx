// The Design tab for the video-row widgets (stacked carousel, product page
// reels): sections, the desktop/mobile size switch, and what each control
// writes into the widget's style.
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShowcaseDesignTab, TemplateSchematic } from "./ShowcaseDesign";
import type { Device, PreviewHighlight } from "./WidgetPreview";
import { WIDGET_KIND_META, resolveStyle } from "../../models/widget-kinds";
import type { WidgetStyleConfig } from "../../models/widget-kinds";
import { BRAND_DEFAULTS } from "../../models/brand";

type Kind = "CAROUSEL" | "PRODUCT_PAGE_REELS";

function setup(kind: Kind, initial: WidgetStyleConfig = {}, startDevice: Device = "desktop") {
  const latest: { style: WidgetStyleConfig; device: Device; focus: PreviewHighlight | null } = {
    style: resolveStyle(kind, initial),
    device: startDevice,
    focus: null,
  };
  function Harness() {
    const [style, setStyle] = useState<WidgetStyleConfig>(latest.style);
    const [device, setDevice] = useState<Device>(startDevice);
    latest.style = style;
    latest.device = device;
    return (
      <ShowcaseDesignTab
        meta={WIDGET_KIND_META[kind]}
        style={style}
        setStyle={(patch) => setStyle((prev) => ({ ...prev, ...patch }))}
        brand={BRAND_DEFAULTS}
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
const checked = (group: string) =>
  within(screen.getByRole("radiogroup", { name: group }))
    .getAllByRole("radio")
    .find((r) => r.getAttribute("aria-checked") === "true")?.textContent;
const setRange = (input: HTMLInputElement, value: number) => {
  // Range inputs take a value + input/change event, not typing.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

// Long click-through flows; coverage instrumentation slows them down.
describe("ShowcaseDesignTab", { timeout: 20_000 }, () => {
  it("opens on Card design; one section at a time, each outlining its part of the preview", async () => {
    const latest = setup("CAROUSEL");
    expect(sectionToggle("Card design")).toHaveAttribute("aria-expanded", "true");
    expect(sectionToggle("Header")).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(sectionToggle("Header"));
    expect(sectionToggle("Header")).toHaveAttribute("aria-expanded", "true");
    expect(sectionToggle("Card design")).toHaveAttribute("aria-expanded", "false");
    expect(latest.focus).toBe("header");

    await userEvent.click(sectionToggle("Colors"));
    expect(latest.focus).toBe("section");
    await userEvent.click(sectionToggle("Layout & spacing"));
    expect(latest.focus).toBe("layout");
    await userEvent.click(sectionToggle("Card design"));
    expect(latest.focus).toBe("cards");
    await userEvent.click(sectionToggle("Card design"));
    expect(latest.focus).toBeNull();
  });

  it("closed sections summarise their current choices", async () => {
    setup("CAROUSEL", { cardTemplate: "overlay", cornerStyle: "sharp", showCardBadge: true, showPlayIcon: false, eyebrow: "Reels", heading: "See it", backgroundColor: "#161412" });
    await userEvent.click(sectionToggle("Card design"));
    expect(sectionToggle("Card design")).toHaveTextContent("Overlay · Square · Discount badge · No play button");
    expect(sectionToggle("Header")).toHaveTextContent("Reels · See it");
    expect(sectionToggle("Layout & spacing")).toHaveTextContent("Stack · Auto size");
    expect(sectionToggle("Colors")).toHaveTextContent("Background #161412");
  });

  it("card design: template, corners, shadow and per-card toggles", async () => {
    const latest = setup("PRODUCT_PAGE_REELS");
    await userEvent.click(screen.getByRole("radio", { name: "Vibrant" }));
    expect(latest.style.cardTemplate).toBe("vibrant");
    // Video titles / featured product only apply to the title template.
    expect(screen.queryByText("Video titles")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Only video title" }));
    expect(screen.getByText("Video titles")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Featured product" }));
    expect(latest.style.showProductPreview).toBe(false);
    await userEvent.click(screen.getByRole("switch", { name: "Video titles" }));
    expect(latest.style.showCaption).toBe(false);

    await userEvent.click(screen.getByRole("radio", { name: "Soft" }));
    await userEvent.click(screen.getByRole("radio", { name: "Lifted" }));
    expect(latest.style).toMatchObject({ cornerStyle: "soft", shadowPreset: "bold" });

    await userEvent.click(screen.getByRole("switch", { name: "Play button" }));
    await userEvent.click(screen.getByRole("switch", { name: "Video length" }));
    expect(latest.style).toMatchObject({ showPlayIcon: false, showDuration: false });

    expect(screen.queryByText("Badge color")).toBeNull();
    await userEvent.click(screen.getByRole("switch", { name: /Discount badge/ }));
    expect(latest.style.showCardBadge).toBe(true);
    expect(screen.getByText("Badge color")).toBeInTheDocument();
  });

  it("template choice works with arrow keys", async () => {
    const latest = setup("CAROUSEL");
    screen.getByRole("radio", { name: "Only video title" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(latest.style.cardTemplate).toBe("classic");
  });

  it("header: text, alignment and sizes", async () => {
    const latest = setup("CAROUSEL");
    await userEvent.click(sectionToggle("Header"));
    await userEvent.type(screen.getByLabelText("Eyebrow"), "Reels");
    await userEvent.clear(screen.getByLabelText("Heading"));
    await userEvent.type(screen.getByLabelText("Heading"), "See it");
    await userEvent.type(screen.getByLabelText("Subheading"), "Tap any reel");
    await userEvent.click(screen.getByRole("radio", { name: "Left" }));
    expect(latest.style).toMatchObject({ eyebrow: "Reels", heading: "See it", subheading: "Tap any reel", headerAlign: "start" });
    // Product page reels default to left, the carousel to center.
    expect(within(screen.getByRole("radiogroup", { name: "Alignment" })).getByRole("radio", { name: "Left" })).toHaveAttribute("aria-checked", "true");
    setRange(slider("Heading size"), 48);
    expect(latest.style.headingSize).toBe(48);
  });

  it("the device switch decides which size is edited; mobile values start Auto and reset", async () => {
    const latest = setup("PRODUCT_PAGE_REELS", { headingSize: 50 });
    await userEvent.click(sectionToggle("Header"));
    expect(screen.getByText("Editing sizes for desktop")).toBeInTheDocument();
    expect(slider("Heading size").value).toBe("50");

    await userEvent.click(screen.getByRole("radio", { name: "Mobile" }));
    expect(latest.device).toBe("mobile");
    expect(screen.getByText("Editing sizes for phones")).toBeInTheDocument();
    // Unset on phones: shows the scaled-down desktop value, tagged Auto.
    const phoneHeading = slider("Heading size");
    expect(phoneHeading.value).toBe("45");
    expect(within(phoneHeading.closest("div[class]")!.parentElement!).getByText("Auto")).toBeInTheDocument();

    setRange(phoneHeading, 24);
    expect(latest.style).toMatchObject({ headingSize: 50, headingSizeMobile: 24 });
    await userEvent.click(screen.getByRole("button", { name: "Reset heading size to automatic" }));
    expect(latest.style.headingSizeMobile).toBeUndefined();
    expect(latest.style.headingSize).toBe(50);
  });

  it("layout: arrangement, cards per row or stack size per device, spacing, reset all", async () => {
    const latest = setup("CAROUSEL", {}, "desktop");
    await userEvent.click(sectionToggle("Layout & spacing"));
    expect(screen.getByText(/The stack needs 3 or more videos/)).toBeInTheDocument();

    // The stack has a card size: Auto, or a preset.
    expect(checked("Card size")).toBe("Auto");
    await pick("Card size", "Large");
    expect(latest.style.triggerSize).toBe(340);
    await userEvent.click(sectionToggle("Layout & spacing"));
    expect(sectionToggle("Layout & spacing")).toHaveTextContent("Stack · Large cards");
    await userEvent.click(sectionToggle("Layout & spacing"));
    await pick("Card size", "Auto");
    expect(latest.style.triggerSize).toBeUndefined();

    setRange(slider("Space between videos"), 30);
    setRange(slider("Space above and below"), 80);
    setRange(slider("Space at the sides"), 20);
    expect(latest.style).toMatchObject({ cardGap: 30, sectionPaddingY: 80, sectionPaddingX: 20 });

    // Grid: whole cards per row, desktop and phones.
    await userEvent.click(screen.getByRole("radio", { name: "Grid" }));
    expect(latest.style.layoutMode).toBe("grid");
    expect(screen.queryByRole("radiogroup", { name: "Card size" })).toBeNull();
    await pick("Cards per row", "5");
    expect(latest.style.columns).toBe(5);

    await userEvent.click(screen.getByRole("radio", { name: "Mobile" }));
    expect(screen.queryByRole("radio", { name: "1½" })).toBeNull();
    await pick("Cards per row on phones", "1");
    expect(latest.style.columnsMobile).toBe(1);

    // A scrolling slider can show half a card more on phones.
    await userEvent.click(screen.getByRole("radio", { name: "Slider" }));
    await pick("Cards per row on phones", "1½");
    expect(latest.style.columnsMobile).toBe(1.5);
    expect(screen.getByText(/1½ cards across your page, the half card/)).toBeInTheDocument();
    await userEvent.click(sectionToggle("Layout & spacing"));
    expect(sectionToggle("Layout & spacing")).toHaveTextContent("Slider · 5 per row · 1.5 on phones");
    await userEvent.click(sectionToggle("Layout & spacing"));

    // A half value saved for a slider shows as whole columns on a grid.
    await userEvent.click(screen.getByRole("radio", { name: "Grid" }));
    expect(checked("Cards per row on phones")).toBe("1");
    await userEvent.click(screen.getByRole("radio", { name: "Stack" }));
    await pick("Card size on phones", "Small");
    expect(latest.style.triggerSizeMobile).toBe(180);

    setRange(slider("Space between videos"), 6);
    expect(latest.style.cardGapMobile).toBe(6);
    await userEvent.click(screen.getByRole("button", { name: "Reset all sizes to automatic" }));
    expect(latest.style.cardGap).toBeUndefined();
    expect(latest.style.cardGapMobile).toBeUndefined();
    expect(latest.style.sectionPaddingY).toBeUndefined();
    expect(latest.style.triggerSizeMobile).toBeUndefined();
    expect(latest.style.columnsMobile).toBeUndefined();
  });

  it("a stack card size saved from the old width slider shows as the nearest preset", async () => {
    setup("CAROUSEL", { layoutMode: "stack", triggerSize: 300 });
    await userEvent.click(sectionToggle("Layout & spacing"));
    expect(checked("Card size")).toBe("Medium");
  });

  it("product page reels: filmstrip naming, cards per row, no stack", async () => {
    const latest = setup("PRODUCT_PAGE_REELS");
    await userEvent.click(sectionToggle("Layout & spacing"));
    expect(screen.queryByRole("radio", { name: "Stack" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Filmstrip" })).toHaveAttribute("aria-checked", "true");
    expect(checked("Cards per row")).toBe("4");
    await pick("Cards per row", "3");
    expect(latest.style.columns).toBe(3);
    expect(screen.getByText(/fit 3 cards across your page\./)).toBeInTheDocument();
  });

  it("colors: accent, background, text and the badge color write hex values", async () => {
    const latest = setup("CAROUSEL", { showCardBadge: true });
    fireEvent.change(screen.getByLabelText("Badge color hex value"), { target: { value: "#123456" } });
    await userEvent.click(sectionToggle("Colors"));
    fireEvent.change(screen.getByLabelText("Accent (arrows, dots, eyebrow) hex value"), { target: { value: "#aa0000" } });
    fireEvent.change(screen.getByLabelText("Background hex value"), { target: { value: "#161412" } });
    fireEvent.change(screen.getByLabelText("Text hex value"), { target: { value: "#f3efe8" } });
    expect(latest.style).toMatchObject({ badgeColor: "#123456", accentColor: "#aa0000", backgroundColor: "#161412", textColor: "#f3efe8" });
  });

  it("quick-start looks only set what the widget supports", async () => {
    const latest = setup("CAROUSEL");
    await userEvent.click(screen.getByRole("button", { name: /Showcase/ }));
    expect(latest.style).toMatchObject({ cardTemplate: "overlay", backgroundColor: "#161412", showCardBadge: true });
  });

  it.each(["CAROUSEL", "PRODUCT_PAGE_REELS"] as const)("%s renders sensible defaults from a never-saved (empty) style", async (kind) => {
    render(
      <ShowcaseDesignTab
        meta={WIDGET_KIND_META[kind]}
        style={{}}
        setStyle={() => {}}
        brand={BRAND_DEFAULTS}
        device="mobile"
        setDevice={() => {}}
        onFocusArea={() => {}}
      />,
    );
    expect(screen.getByRole("radio", { name: "Only video title" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Rounded" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Play button" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Video length" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Video titles" })).toHaveAttribute("aria-checked", "true");
    // Phone sizes fall back to the mobile defaults.
    expect(slider("Card text size").value).toBe("12");
    await userEvent.click(sectionToggle("Header"));
    expect(screen.getByLabelText("Heading")).toHaveValue("");
    expect(slider("Heading size").value).toBe("28");
    await userEvent.click(sectionToggle("Layout & spacing"));
    expect(kind === "CAROUSEL" ? checked("Card size on phones") : checked("Cards per row on phones")).toBe(kind === "CAROUSEL" ? "Auto" : "2");
    await userEvent.click(sectionToggle("Colors"));
    expect(screen.getByLabelText("Text hex value")).toBeInTheDocument();
  });

  it("grid on desktop starts from 4 columns when none is saved", async () => {
    render(
      <ShowcaseDesignTab
        meta={WIDGET_KIND_META.PRODUCT_PAGE_REELS}
        style={{ layoutMode: "grid" }}
        setStyle={() => {}}
        brand={BRAND_DEFAULTS}
        device="desktop"
        setDevice={() => {}}
        onFocusArea={() => {}}
      />,
    );
    await userEvent.click(sectionToggle("Layout & spacing"));
    expect(checked("Cards per row")).toBe("4");
  });
});

describe("TemplateSchematic", () => {
  it.each(["title", "overlay", "classic", "modern", "vibrant"] as const)("draws %s", (template) => {
    const { container } = render(<TemplateSchematic template={template} />);
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(2);
  });
});
