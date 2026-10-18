import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { moveItem, SortableList } from "./SortableList";

describe("moveItem", () => {
  it("moves forwards and backwards and ignores out-of-range moves", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    const same = ["a", "b"];
    expect(moveItem(same, 1, 1)).toBe(same);
    expect(moveItem(same, 0, 5)).toBe(same);
  });
});

function Harness({ initial, onReorder }: { initial: string[]; onReorder?: (items: string[]) => void }) {
  const [items, setItems] = useState(initial);
  return (
    <SortableList
      items={items}
      getKey={(item) => item}
      getLabel={(item) => item}
      onReorder={(next) => {
        setItems(next);
        onReorder?.(next);
      }}
      renderItem={(item, index, handle) => (
        <>
          {handle}
          <span data-testid="row">{`${index + 1}:${item}`}</span>
        </>
      )}
    />
  );
}

const rows = () => screen.getAllByTestId("row").map((el) => el.textContent);
const grip = (label: string) => screen.getByRole("button", { name: new RegExp(`^Reorder ${label},`) });

describe("SortableList keyboard", () => {
  it("arrow keys move the row, focus follows it, and the move is announced", () => {
    const onReorder = vi.fn();
    render(<Harness initial={["Alpha", "Beta", "Gamma"]} onReorder={onReorder} />);

    fireEvent.keyDown(grip("Alpha"), { key: "ArrowDown" });
    expect(rows()).toEqual(["1:Beta", "2:Alpha", "3:Gamma"]);
    expect(onReorder).toHaveBeenLastCalledWith(["Beta", "Alpha", "Gamma"]);
    expect(document.activeElement).toBe(grip("Alpha"));
    expect(screen.getByText("Alpha moved to position 2 of 3.")).toBeInTheDocument();

    fireEvent.keyDown(grip("Gamma"), { key: "Home" });
    expect(rows()).toEqual(["1:Gamma", "2:Beta", "3:Alpha"]);
    fireEvent.keyDown(grip("Gamma"), { key: "End" });
    expect(rows()).toEqual(["1:Beta", "2:Alpha", "3:Gamma"]);
  });

  it("does nothing past either end or on other keys", () => {
    const onReorder = vi.fn();
    render(<Harness initial={["Alpha", "Beta"]} onReorder={onReorder} />);
    fireEvent.keyDown(grip("Alpha"), { key: "ArrowUp" });
    fireEvent.keyDown(grip("Beta"), { key: "ArrowDown" });
    fireEvent.keyDown(grip("Beta"), { key: "Enter" });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("disables the grip when there is nothing to reorder", () => {
    render(<Harness initial={["Solo"]} />);
    expect(grip("Solo")).toBeDisabled();
  });
});

describe("SortableList pointer drag", () => {
  it("drops the dragged row where the pointer ends", () => {
    const onReorder = vi.fn();
    render(<Harness initial={["Alpha", "Beta", "Gamma"]} onReorder={onReorder} />);
    // jsdom has no layout: give each row a 40px slot with 6px gaps.
    document.querySelectorAll("li").forEach((li, i) => {
      li.getBoundingClientRect = () => ({ top: i * 46, height: 40, bottom: i * 46 + 40, left: 0, right: 300, width: 300, x: 0, y: i * 46, toJSON: () => ({}) });
    });
    const handle = grip("Alpha");
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = () => {};

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 20, pointerType: "mouse" });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 120 });
    expect(document.querySelector("li[data-dragging]")).not.toBeNull();
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 120 });

    expect(onReorder).toHaveBeenCalledWith(["Beta", "Gamma", "Alpha"]);
    expect(rows()).toEqual(["1:Beta", "2:Gamma", "3:Alpha"]);
    expect(document.querySelector("li[data-dragging]")).toBeNull();
  });
});
