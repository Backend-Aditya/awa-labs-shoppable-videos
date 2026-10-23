import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  graphql: vi.fn(),
}));

vi.mock("../db.server", () => ({ default: { shop: { update: mocks.update, findUnique: vi.fn() } } }));
vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({ admin: { graphql: mocks.graphql }, session: { shop: "test.myshopify.com" } })),
  },
}));
vi.mock("../models/shop.server", () => ({
  getOrCreateShop: vi.fn(async () => ({ id: "shop-1", shopDomain: "test.myshopify.com" })),
}));

import { action } from "../routes/app.integrations";
import { TRACKING_DEFAULTS } from "../models/tracking";

const respond = (body: unknown) => ({ json: async () => body });
const post = (body: unknown) =>
  action({
    request: new Request("https://app.test/app/integrations", { method: "POST", body: JSON.stringify(body) }),
    params: {},
    context: {},
  } as never);

describe("integrations: save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.graphql
      .mockResolvedValueOnce(respond({ data: { shop: { id: "gid://shopify/Shop/1" } } }))
      .mockResolvedValueOnce(respond({ data: { metafieldsSet: { userErrors: [] } } }));
  });

  it("stores the sanitised settings and mirrors them to the $app.tracking metafield", async () => {
    const result = await post({ ga4: true, meta: "yes", clarityId: "ABC123xyz", injected: "<script>" });
    const expected = { ...TRACKING_DEFAULTS, ga4: true, clarityId: "abc123xyz" };
    expect(result).toEqual({ ok: true, error: null, tracking: expected });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "shop-1" }, data: { tracking: expected } });
    const [, { variables }] = mocks.graphql.mock.calls[1];
    expect(variables.metafields).toEqual([
      { ownerId: "gid://shopify/Shop/1", namespace: "$app", key: "tracking", type: "json", value: JSON.stringify(expected) },
    ]);
  });

  it("turns a Shopify error into an inline message", async () => {
    mocks.graphql.mockReset().mockResolvedValue(respond({ data: null, errors: [{ message: "Throttled" }] }));
    await expect(post({ ga4: true })).resolves.toEqual({ ok: false, error: "Couldn't save your integrations. Try again.", tracking: null });
  });
});
