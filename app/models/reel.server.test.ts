import { describe, expect, it } from "vitest";
import {
  generateReelHandle,
  upsertReel,
  listReels,
  deleteReel,
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
    expect(handle).toMatch(/^summer-look-1-[a-z0-9]+$/);
  });

  it("falls back to a plain prefix when the title has no safe characters", () => {
    const handle = generateReelHandle("!!!");
    expect(handle).toMatch(/^reel-[a-z0-9]+$/);
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
});
