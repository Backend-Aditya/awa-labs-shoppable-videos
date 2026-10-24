import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ProductMoments } from "./ProductMoments";

const POSTER = "https://customer-x.cloudflarestream.com/abc/thumbnails/thumbnail.jpg";
const products = [
  { id: "gid://shopify/Product/7", title: "Linen shirt", imageUrl: "https://cdn.test/7.jpg" },
  { id: "gid://shopify/Product/8", title: "Canvas tote", imageUrl: null },
];

function Harness({ initial = {}, onChange = vi.fn(), duration = 30 }: { initial?: Record<string, number>; onChange?: (t: Record<string, number>) => void; duration?: number }) {
  const [times, setTimes] = useState(initial);
  return (
    <ProductMoments
      products={products}
      posterUrl={POSTER}
      duration={duration}
      times={times}
      onChange={(next) => {
        setTimes(next);
        onChange(next);
      }}
    />
  );
}

const row = (title: string) => screen.getByText(title).closest("li")!;

describe("ProductMoments", () => {
  it("untimed products offer a time, spread across the video", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(within(row("Canvas tote")).getByText("Not timed")).toBeTruthy();
    fireEvent.click(within(row("Canvas tote")).getByRole("button", { name: "Set a time" }));
    expect(onChange).toHaveBeenLastCalledWith({ "8": 20 });
    fireEvent.click(within(row("Linen shirt")).getByRole("button", { name: "Set a time" }));
    expect(onChange).toHaveBeenLastCalledWith({ "8": 20, "7": 10 });
  });

  it("a timed product scrubs on a slider that shows the frame and reads out the time", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ "7": 12 }} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "When Linen shirt pops up" });
    expect(slider.getAttribute("aria-valuetext")).toBe("0:12");
    expect(slider.getAttribute("max")).toBe("29");
    const frame = row("Linen shirt").querySelector<HTMLElement>("[data-frame]")!;
    expect(frame.style.backgroundImage).toContain("thumbnail.jpg?time=12s");
    fireEvent.change(slider, { target: { value: "5" } });
    expect(onChange).toHaveBeenLastCalledWith({ "7": 5 });
    expect(within(row("Linen shirt")).getByText("0:05")).toBeTruthy();
  });

  it("removing a time puts the product back to untimed", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ "7": 12, "8": 3 }} onChange={onChange} />);
    fireEvent.click(within(row("Linen shirt")).getByRole("button", { name: "Remove time" }));
    expect(onChange).toHaveBeenLastCalledWith({ "8": 3 });
    expect(within(row("Linen shirt")).getByText("Not timed")).toBeTruthy();
  });

  it("waits for processing, and hides with no products", () => {
    const { unmount } = render(<Harness duration={0} />);
    expect(screen.getByText("You can time products once the video has finished processing.")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
    unmount();
    const { container } = render(<ProductMoments products={[]} posterUrl={POSTER} duration={30} times={{}} onChange={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});
