import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";

type BlockerFn = (args: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) => boolean;
type Blocker =
  | { state: "unblocked"; reset?: undefined; location?: undefined }
  | { state: "blocked"; reset: () => void; location: { pathname: string; search: string } };

const router = vi.hoisted(() => ({
  navigate: vi.fn(),
  blocker: { state: "unblocked" } as Blocker,
  lastPredicate: null as BlockerFn | null,
}));
const appBridge = vi.hoisted(() => ({ shopify: {} as { saveBar?: { leaveConfirmation?: () => Promise<void> } } }));

vi.mock("react-router", () => ({
  useNavigate: () => router.navigate,
  useBlocker: (predicate: BlockerFn) => {
    router.lastPredicate = predicate;
    return router.blocker;
  },
}));
vi.mock("@shopify/app-bridge-react", () => ({ useAppBridge: () => appBridge.shopify }));

import { useEditorGuards } from "./useEditorGuards";

const pressSave = (init: KeyboardEventInit = { ctrlKey: true }) => {
  const event = new KeyboardEvent("keydown", { key: "s", cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
};

beforeEach(() => {
  router.navigate.mockReset();
  router.blocker = { state: "unblocked" };
  router.lastPredicate = null;
  appBridge.shopify = {};
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useEditorGuards, Ctrl/Cmd+S", () => {
  it("saves when dirty and not saving", () => {
    const onSave = vi.fn();
    renderHook(() => useEditorGuards({ dirty: true, onSave }));
    const event = pressSave();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("works with Cmd (metaKey) and an upper-case S", () => {
    const onSave = vi.fn();
    renderHook(() => useEditorGuards({ dirty: true, onSave }));
    pressSave({ metaKey: true, key: "S" });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does nothing (but still blocks the browser's Save Page) when clean", () => {
    const onSave = vi.fn();
    renderHook(() => useEditorGuards({ dirty: false, onSave }));
    const event = pressSave();
    expect(onSave).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not double-save while a save is in flight", () => {
    const onSave = vi.fn();
    renderHook(() => useEditorGuards({ dirty: true, onSave, saving: true }));
    pressSave();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("ignores plain S and other shortcuts", () => {
    const onSave = vi.fn();
    renderHook(() => useEditorGuards({ dirty: true, onSave }));
    const plain = pressSave({ ctrlKey: false });
    pressSave({ ctrlKey: true, key: "p" });
    expect(onSave).not.toHaveBeenCalled();
    expect(plain.defaultPrevented).toBe(false);
  });

  it("always calls the latest onSave and follows dirty changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook((props: { dirty: boolean; onSave: () => void }) => useEditorGuards(props), {
      initialProps: { dirty: false, onSave: first },
    });
    pressSave();
    rerender({ dirty: true, onSave: second });
    pressSave();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes its listener on unmount", () => {
    const onSave = vi.fn();
    const { unmount } = renderHook(() => useEditorGuards({ dirty: true, onSave }));
    unmount();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("useEditorGuards, leaving with unsaved changes", () => {
  const nav = (from: string, to: string) => ({ currentLocation: { pathname: from }, nextLocation: { pathname: to } });

  it("blocks navigation to another page only while dirty", () => {
    const { rerender } = renderHook((props: { dirty: boolean }) => useEditorGuards({ ...props, onSave: () => {} }), {
      initialProps: { dirty: true },
    });
    expect(router.lastPredicate!(nav("/app/widgets/1", "/app/widgets"))).toBe(true);
    // Same path (e.g. a search-param change) is never blocked.
    expect(router.lastPredicate!(nav("/app/widgets/1", "/app/widgets/1"))).toBe(false);
    rerender({ dirty: false });
    expect(router.lastPredicate!(nav("/app/widgets/1", "/app/widgets"))).toBe(false);
  });

  it("allowNextNavigation skips the prompt until the page is clean again", () => {
    const { result, rerender } = renderHook((props: { dirty: boolean }) => useEditorGuards({ ...props, onSave: () => {} }), {
      initialProps: { dirty: true },
    });
    act(() => result.current.allowNextNavigation());
    expect(router.lastPredicate!(nav("/a", "/b"))).toBe(false);
    rerender({ dirty: false });
    rerender({ dirty: true });
    expect(router.lastPredicate!(nav("/a", "/b"))).toBe(true);
  });

  it("asks App Bridge's leave confirmation and navigates on confirm", async () => {
    const reset = vi.fn();
    const leaveConfirmation = vi.fn(() => Promise.resolve());
    appBridge.shopify = { saveBar: { leaveConfirmation } };
    router.blocker = { state: "blocked", reset, location: { pathname: "/app/reels", search: "?tab=2" } };
    renderHook(() => useEditorGuards({ dirty: true, onSave: () => {} }));
    expect(reset).toHaveBeenCalled();
    expect(leaveConfirmation).toHaveBeenCalled();
    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith("/app/reels?tab=2"));
    // Once confirmed, the follow-up navigation is not blocked again.
    expect(router.lastPredicate!(nav("/a", "/app/reels"))).toBe(false);
  });

  it("stays put when the merchant cancels App Bridge's confirmation", async () => {
    const leaveConfirmation = vi.fn(() => Promise.reject(new Error("cancel")));
    appBridge.shopify = { saveBar: { leaveConfirmation } };
    router.blocker = { state: "blocked", reset: vi.fn(), location: { pathname: "/x", search: "" } };
    renderHook(() => useEditorGuards({ dirty: true, onSave: () => {} }));
    await Promise.resolve();
    await Promise.resolve();
    expect(leaveConfirmation).toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("falls back to window.confirm outside App Bridge", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    router.blocker = { state: "blocked", reset: vi.fn(), location: { pathname: "/x", search: "" } };
    const { rerender } = renderHook(() => useEditorGuards({ dirty: true, onSave: () => {} }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(router.navigate).not.toHaveBeenCalled();

    router.blocker = { state: "blocked", reset: vi.fn(), location: { pathname: "/y", search: "" } };
    rerender();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(router.navigate).toHaveBeenCalledWith("/y");
  });
});
