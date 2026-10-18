import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWidget: vi.fn(),
  updateWidget: vi.fn(),
  deleteWidget: vi.fn(),
  createWidget: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({ admin: { graphql: vi.fn() }, session: { shop: "test.myshopify.com" } })),
  },
}));

vi.mock("../models/shop.server", () => ({
  getOrCreateShop: vi.fn(async () => ({ id: "shop-1", shopDomain: "test.myshopify.com" })),
}));

vi.mock("../models/widget.server", () => ({
  getWidget: mocks.getWidget,
  updateWidget: mocks.updateWidget,
  deleteWidget: mocks.deleteWidget,
  createWidget: mocks.createWidget,
  listWidgetsForShop: vi.fn(async () => []),
  saveWidgetSettings: vi.fn(),
}));

import { action } from "../routes/app.widgets.$id";

const post = (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("https://app.test/app/widgets/w1", { method: "POST", body }),
    params: { id: "w1" },
    context: {},
  } as never);
};

describe("widget route: publish intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWidget.mockResolvedValue({ id: "w1", name: "Strip", type: "PRODUCT_PAGE_REELS", published: false, config: {} });
    mocks.updateWidget.mockResolvedValue({});
  });

  it("puts the widget live through updateWidget (which keeps one live per type)", async () => {
    await expect(post({ intent: "publish", published: "true" })).resolves.toEqual({ ok: true, error: null });
    expect(mocks.updateWidget).toHaveBeenCalledWith(expect.anything(), "shop-1", "w1", { published: true });
  });

  it("switches it back to draft", async () => {
    await post({ intent: "publish", published: "false" });
    expect(mocks.updateWidget).toHaveBeenCalledWith(expect.anything(), "shop-1", "w1", { published: false });
  });

  it("turns a failure into an inline error instead of a crash", async () => {
    mocks.updateWidget.mockRejectedValue(new Error("Shopify down"));
    await expect(post({ intent: "publish", published: "true" })).resolves.toMatchObject({ ok: false });
  });

  it("404s for a widget from another shop", async () => {
    mocks.getWidget.mockResolvedValue(null);
    await expect(post({ intent: "publish", published: "true" })).rejects.toMatchObject({ status: 404 });
  });
});
