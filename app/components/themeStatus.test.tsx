import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { readdirSync } from "node:fs";
import { blockHandleFor, themeEditorUrl } from "./themeEditor";

const appBridge = vi.hoisted(() => ({ shopify: {} as Record<string, unknown> }));
vi.mock("@shopify/app-bridge-react", () => ({ useAppBridge: () => appBridge.shopify }));

import { EMBED_HANDLE, useThemeStatus } from "./useThemeStatus";

describe("themeEditorUrl", () => {
  it("adds a section block to the right template", () => {
    expect(themeEditorUrl("key", "PRODUCT_PAGE_REELS")).toBe(
      "shopify://admin/themes/current/editor?template=product&addAppBlockId=key/product-page-reels&target=mainSection",
    );
    expect(themeEditorUrl("key", "CAROUSEL")).toBe(
      "shopify://admin/themes/current/editor?template=index&addAppBlockId=key/stacked-carousel&target=newAppsSection",
    );
  });

  it("opens App embeds for the floating video, unknown kinds and no kind", () => {
    const embed = "shopify://admin/themes/current/editor?context=apps&template=index&activateAppId=key/shoppable-videos";
    expect(themeEditorUrl("key", "REEL_POPS")).toBe(embed);
    expect(themeEditorUrl("key", "NOPE")).toBe(embed);
    expect(themeEditorUrl("key")).toBe(embed);
  });

  it("every block handle exists in the theme extension", () => {
    const blocks = readdirSync("extensions/shoppable-video-widgets/blocks").map((f) => f.replace(/\.liquid$/, ""));
    for (const kind of ["PRODUCT_PAGE_REELS", "ADD_TO_CART_VIDEO", "CAROUSEL", "STORIES", "SINGLE_VIDEO"]) {
      expect(blocks).toContain(blockHandleFor(kind));
    }
    expect(blocks).toContain(EMBED_HANDLE);
    expect(blockHandleFor("REEL_POPS")).toBeNull();
    expect(blockHandleFor("NOPE")).toBeNull();
  });
});

describe("useThemeStatus", () => {
  it("is null when App Bridge has no extensions API", () => {
    appBridge.shopify = {};
    const { result } = renderHook(() => useThemeStatus());
    expect(result.current).toBeNull();
  });

  it("reports the embed state and placed blocks", async () => {
    appBridge.shopify = {
      app: {
        extensions: async () => [
          { type: "ui_extension", activations: [] },
          {
            type: "theme_app_extension",
            activations: [
              { handle: "shoppable-videos", status: "active" },
              { handle: "product-page-reels", status: "active" },
              { handle: "stacked-carousel", status: "inactive", activations: [{}] },
              { handle: "insta-stories", status: "inactive", activations: [] },
            ],
          },
        ],
      },
    };
    const { result } = renderHook(() => useThemeStatus());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.embedOn).toBe(true);
    expect([...result.current!.placedBlocks].sort()).toEqual(["product-page-reels", "stacked-carousel"]);
  });

  it("embed off and no theme extension info", async () => {
    appBridge.shopify = { app: { extensions: async () => [] } };
    const { result } = renderHook(() => useThemeStatus());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual({ embedOn: false, placedBlocks: new Set() });
  });

  it("stays unknown when the API fails, and ignores results after unmount", async () => {
    appBridge.shopify = { app: { extensions: () => Promise.reject(new Error("unsupported")) } };
    const failed = renderHook(() => useThemeStatus());
    await new Promise((r) => setTimeout(r, 10));
    expect(failed.result.current).toBeNull();

    let resolve: (v: unknown[]) => void = () => {};
    appBridge.shopify = { app: { extensions: () => new Promise((r) => (resolve = r)) } };
    const late = renderHook(() => useThemeStatus());
    late.unmount();
    resolve([{ type: "theme_app_extension", activations: [] }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(late.result.current).toBeNull();
  });
});
