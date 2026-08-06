import { describe, expect, it } from "vitest";
import {
  generateReelHandle,
  upsertReel,
  listReels,
  deleteReel,
  getReel,
  updateReelConfig,
  deriveReelStatus,
  getProductsByIds,
  syncProductReelMetafields,
} from "./reel.server";
import type { ReelConfig } from "./reel.server";

describe("reel.server", () => {
  const config: ReelConfig = {
    productIds: ["gid://shopify/Product/1"],
    interactions: { ctaLabel: "Shop now", ctaUrl: "/products/1" },
    source: { type: "upload" },
  };

  it("generates a URL-safe handle from a title", () => {
    const handle = generateReelHandle("Summer Look #1!");
    expect(handle).toMatch(/^summer-look-1-[a-z0-9-]+$/);
  });

  it("falls back to a plain prefix when the title has no safe characters", () => {
    const handle = generateReelHandle("!!!");
    expect(handle).toMatch(/^reel-[a-z0-9-]+$/);
  });

  it("upserts a reel via metaobjectUpsert and parses jsonValue fields back", async () => {
    let capturedQuery = "";
    let capturedVariables: Record<string, unknown> | undefined;
    const admin = {
      graphql: async (
        query: string,
        options?: { variables?: Record<string, unknown> },
      ) => {
        capturedQuery = query;
        capturedVariables = options?.variables;
        return {
          json: async () => ({
            data: {
              metaobjectUpsert: {
                metaobject: {
                  id: "gid://shopify/Metaobject/1",
                  handle: "summer-look-1",
                  title: { jsonValue: "Summer Look" },
                  published: { jsonValue: true },
                  config: { jsonValue: config },
                },
                userErrors: [],
              },
            },
          }),
        };
      },
    };

    const reel = await upsertReel(
      admin,
      "summer-look-1",
      "Summer Look",
      true,
      config,
    );

    expect(reel).toEqual({
      id: "gid://shopify/Metaobject/1",
      handle: "summer-look-1",
      title: "Summer Look",
      published: true,
      config,
    });
    expect(capturedQuery).toContain("metaobjectUpsert");
    expect(capturedVariables).toEqual({
      handle: { type: "$app:reel", handle: "summer-look-1" },
      metaobject: {
        fields: [
          { key: "title", value: "Summer Look" },
          { key: "published", value: "true" },
          { key: "config", value: JSON.stringify(config) },
        ],
      },
    });
  });

  it("throws with the userErrors message when upsert fails", async () => {
    const admin = {
      graphql: async () => ({
        json: async () => ({
          data: {
            metaobjectUpsert: {
              metaobject: null,
              userErrors: [
                { field: ["fields", "title"], message: "Title can't be blank" },
              ],
            },
          },
        }),
      }),
    };

    await expect(
      upsertReel(admin, "x", "", false, config),
    ).rejects.toThrow("Title can't be blank");
  });

  it("throws a meaningful error when the response has top-level GraphQL errors", async () => {
    const admin = {
      graphql: async () => ({
        json: async () => ({
          data: null,
          errors: [{ message: "Throttled" }],
        }),
      }),
    };

    await expect(
      upsertReel(admin, "x", "Title", false, config),
    ).rejects.toThrow("Throttled");
  });

  it("lists reels, parsing jsonValue fields for each node", async () => {
    const admin = {
      graphql: async () => ({
        json: async () => ({
          data: {
            metaobjects: {
              nodes: [
                {
                  id: "gid://shopify/Metaobject/1",
                  handle: "summer-look-1",
                  title: { jsonValue: "Summer Look" },
                  published: { jsonValue: true },
                  config: { jsonValue: config },
                },
              ],
            },
          },
        }),
      }),
    };

    const reels = await listReels(admin, 50);
    expect(reels).toEqual([
      {
        id: "gid://shopify/Metaobject/1",
        handle: "summer-look-1",
        title: "Summer Look",
        published: true,
        config,
      },
    ]);
  });

  it("deletes a reel without error when userErrors is empty", async () => {
    const admin = {
      graphql: async () => ({
        json: async () => ({
          data: {
            metaobjectDelete: {
              deletedId: "gid://shopify/Metaobject/1",
              userErrors: [],
            },
          },
        }),
      }),
    };

    await expect(
      deleteReel(admin, "gid://shopify/Metaobject/1"),
    ).resolves.toBeUndefined();
  });

  it("throws with the userErrors message when delete fails", async () => {
    const admin = {
      graphql: async () => ({
        json: async () => ({
          data: {
            metaobjectDelete: {
              deletedId: null,
              userErrors: [{ field: ["id"], message: "Not found" }],
            },
          },
        }),
      }),
    };

    await expect(
      deleteReel(admin, "gid://shopify/Metaobject/999"),
    ).rejects.toThrow("Not found");
  });

  it("fetches a single reel by ID via the metaobject query", async () => {
    let capturedQuery = "";
    let capturedVariables: Record<string, unknown> | undefined;
    const admin = {
      graphql: async (
        query: string,
        options?: { variables?: Record<string, unknown> },
      ) => {
        capturedQuery = query;
        capturedVariables = options?.variables;
        return {
          json: async () => ({
            data: {
              metaobject: {
                id: "gid://shopify/Metaobject/1",
                handle: "summer-look-1",
                title: { jsonValue: "Summer Look" },
                published: { jsonValue: false },
                config: { jsonValue: config },
              },
            },
          }),
        };
      },
    };

    const reel = await getReel(admin, "gid://shopify/Metaobject/1");

    expect(reel).toEqual({
      id: "gid://shopify/Metaobject/1",
      handle: "summer-look-1",
      title: "Summer Look",
      published: false,
      config,
    });
    expect(capturedQuery).toContain("metaobject(id: $id)");
    expect(capturedVariables).toEqual({ id: "gid://shopify/Metaobject/1" });
  });

  it("returns null from getReel when the metaobject doesn't exist", async () => {
    const admin = {
      graphql: async () => ({
        json: async () => ({ data: { metaobject: null } }),
      }),
    };

    const reel = await getReel(admin, "gid://shopify/Metaobject/999");
    expect(reel).toBeNull();
  });

  it("merges a partial config into the existing reel via updateReelConfig", async () => {
    let upsertVariables: Record<string, unknown> | undefined;
    const admin = {
      graphql: async (
        query: string,
        options?: { variables?: Record<string, unknown> },
      ) => {
        if (query.includes("metaobject(id: $id)")) {
          return {
            json: async () => ({
              data: {
                metaobject: {
                  id: "gid://shopify/Metaobject/1",
                  handle: "summer-look-1",
                  title: { jsonValue: "Summer Look" },
                  published: { jsonValue: false },
                  config: { jsonValue: config },
                },
              },
            }),
          };
        }

        // The upsertReel call underneath updateReelConfig
        upsertVariables = options?.variables;
        return {
          json: async () => ({
            data: {
              metaobjectUpsert: {
                metaobject: {
                  id: "gid://shopify/Metaobject/1",
                  handle: "summer-look-1",
                  title: { jsonValue: "Summer Look" },
                  published: { jsonValue: false },
                  config: {
                    jsonValue: {
                      ...config,
                      cloudflareStreamUid: "abc123",
                      durationSeconds: 12.5,
                    },
                  },
                },
                userErrors: [],
              },
            },
          }),
        };
      },
    };

    const updated = await updateReelConfig(admin, "gid://shopify/Metaobject/1", {
      cloudflareStreamUid: "abc123",
      durationSeconds: 12.5,
    });

    expect(updated.config).toEqual({
      ...config,
      cloudflareStreamUid: "abc123",
      durationSeconds: 12.5,
    });
    // Confirms the merge kept fields untouched by the partial update (productIds, interactions, source)
    const mergedFieldsSent = JSON.parse(
      (upsertVariables!.metaobject as { fields: Array<{ key: string; value: string }> })
        .fields.find((f) => f.key === "config")!.value,
    );
    expect(mergedFieldsSent).toEqual({
      ...config,
      cloudflareStreamUid: "abc123",
      durationSeconds: 12.5,
    });
  });

  it("throws from updateReelConfig when the reel doesn't exist", async () => {
    const admin = {
      graphql: async () => ({
        json: async () => ({ data: { metaobject: null } }),
      }),
    };

    await expect(
      updateReelConfig(admin, "gid://shopify/Metaobject/999", {
        cloudflareStreamUid: "abc123",
      }),
    ).rejects.toThrow("Reel not found");
  });

  describe("deriveReelStatus", () => {
    const base: ReelConfig = {
      productIds: [],
      interactions: {},
      source: { type: "upload" },
    };

    it("returns ready when hlsManifestUrl is present", () => {
      expect(
        deriveReelStatus({ ...base, cloudflareStreamUid: "abc", hlsManifestUrl: "https://x/y.m3u8" }),
      ).toBe("ready");
    });

    it("returns processing when cloudflareStreamUid is present but hlsManifestUrl is not", () => {
      expect(deriveReelStatus({ ...base, cloudflareStreamUid: "abc" })).toBe("processing");
    });

    it("returns failed when uploadFailedAt is present and no cloudflareStreamUid", () => {
      expect(deriveReelStatus({ ...base, uploadFailedAt: "2026-08-06T00:00:00.000Z" })).toBe(
        "failed",
      );
    });

    it("returns draft when nothing has happened yet", () => {
      expect(deriveReelStatus(base)).toBe("draft");
    });

    it("prefers ready over a stale failed/processing marker if hlsManifestUrl is set", () => {
      expect(
        deriveReelStatus({
          ...base,
          uploadFailedAt: "2026-08-06T00:00:00.000Z",
          cloudflareStreamUid: "abc",
          hlsManifestUrl: "https://x/y.m3u8",
        }),
      ).toBe("ready");
    });
  });

  describe("getProductsByIds", () => {
    it("fetches product titles for the given IDs", async () => {
      let capturedVariables: Record<string, unknown> | undefined;
      const admin = {
        graphql: async (
          _query: string,
          options?: { variables?: Record<string, unknown> },
        ) => {
          capturedVariables = options?.variables;
          return {
            json: async () => ({
              data: {
                nodes: [
                  { id: "gid://shopify/Product/1", title: "Blue Shirt", handle: "blue-shirt" },
                  null,
                ],
              },
            }),
          };
        },
      };

      const products = await getProductsByIds(admin, [
        "gid://shopify/Product/1",
        "gid://shopify/Product/999",
      ]);

      expect(products).toEqual([
        { id: "gid://shopify/Product/1", title: "Blue Shirt", handle: "blue-shirt" },
      ]);
      expect(capturedVariables).toEqual({
        ids: ["gid://shopify/Product/1", "gid://shopify/Product/999"],
      });
    });

    it("returns an empty array without a network call when ids is empty", async () => {
      let called = false;
      const admin = {
        graphql: async () => {
          called = true;
          return { json: async () => ({ data: { nodes: [] } }) };
        },
      };

      const products = await getProductsByIds(admin, []);
      expect(products).toEqual([]);
      expect(called).toBe(false);
    });
  });

  describe("syncProductReelMetafields", () => {
    it("adds the reel ID to a newly tagged product's existing metafield list", async () => {
      let capturedSetVariables: Record<string, unknown> | undefined;
      const admin = {
        graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
          if (query.includes("GetProductReelMetafields")) {
            return {
              json: async () => ({
                data: {
                  nodes: [
                    {
                      id: "gid://shopify/Product/1",
                      metafield: { value: JSON.stringify(["gid://shopify/Metaobject/9"]) },
                    },
                  ],
                },
              }),
            };
          }
          capturedSetVariables = options?.variables;
          return {
            json: async () => ({
              data: { metafieldsSet: { userErrors: [] } },
            }),
          };
        },
      };

      await syncProductReelMetafields(
        admin,
        "gid://shopify/Metaobject/1",
        [],
        ["gid://shopify/Product/1"],
      );

      expect(capturedSetVariables).toEqual({
        metafields: [
          {
            ownerId: "gid://shopify/Product/1",
            namespace: "$app",
            key: "reels",
            type: "list.metaobject_reference",
            value: JSON.stringify([
              "gid://shopify/Metaobject/9",
              "gid://shopify/Metaobject/1",
            ]),
          },
        ],
      });
    });

    it("removes the reel ID from an untagged product's metafield list", async () => {
      let capturedSetVariables: Record<string, unknown> | undefined;
      const admin = {
        graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
          if (query.includes("GetProductReelMetafields")) {
            return {
              json: async () => ({
                data: {
                  nodes: [
                    {
                      id: "gid://shopify/Product/1",
                      metafield: {
                        value: JSON.stringify([
                          "gid://shopify/Metaobject/1",
                          "gid://shopify/Metaobject/2",
                        ]),
                      },
                    },
                  ],
                },
              }),
            };
          }
          capturedSetVariables = options?.variables;
          return {
            json: async () => ({
              data: { metafieldsSet: { userErrors: [] } },
            }),
          };
        },
      };

      await syncProductReelMetafields(
        admin,
        "gid://shopify/Metaobject/1",
        ["gid://shopify/Product/1"],
        [],
      );

      expect(capturedSetVariables).toEqual({
        metafields: [
          {
            ownerId: "gid://shopify/Product/1",
            namespace: "$app",
            key: "reels",
            type: "list.metaobject_reference",
            value: JSON.stringify(["gid://shopify/Metaobject/2"]),
          },
        ],
      });
    });

    it("makes no GraphQL call when the product set is unchanged", async () => {
      let called = false;
      const admin = {
        graphql: async () => {
          called = true;
          return { json: async () => ({ data: {} }) };
        },
      };

      await syncProductReelMetafields(
        admin,
        "gid://shopify/Metaobject/1",
        ["gid://shopify/Product/1"],
        ["gid://shopify/Product/1"],
      );

      expect(called).toBe(false);
    });

    it("starts from an empty list when a product has no existing metafield value", async () => {
      let capturedSetVariables: Record<string, unknown> | undefined;
      const admin = {
        graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
          if (query.includes("GetProductReelMetafields")) {
            return {
              json: async () => ({
                data: {
                  nodes: [
                    { id: "gid://shopify/Product/1", metafield: null },
                  ],
                },
              }),
            };
          }
          capturedSetVariables = options?.variables;
          return {
            json: async () => ({
              data: { metafieldsSet: { userErrors: [] } },
            }),
          };
        },
      };

      await syncProductReelMetafields(
        admin,
        "gid://shopify/Metaobject/1",
        [],
        ["gid://shopify/Product/1"],
      );

      expect(capturedSetVariables).toEqual({
        metafields: [
          {
            ownerId: "gid://shopify/Product/1",
            namespace: "$app",
            key: "reels",
            type: "list.metaobject_reference",
            value: JSON.stringify(["gid://shopify/Metaobject/1"]),
          },
        ],
      });
    });
  });
});
